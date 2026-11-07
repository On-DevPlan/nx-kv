// 文档模块：自有 md 树 + 外部只读绑定 + 双链索引 + 绑定管理。
//
// 「描述的权威是磁盘上的 .md 文件」——本模块只做这件事：CRUD、绑定、种子、知识聚合。
// 面板编辑（DocPanel）与组详情渲染都从这里取数；`repo knowledge` 在 repos 模块
// （它属于 repo.* 命令族），聚合逻辑在 knowledge.js。
//
// resource: 'doc' 触发 CRUD 五件断言（tests/unit/registry.test.mjs）：
//   doc.list / doc.get / doc.add / doc.update / doc.remove 必须齐备且两端可调。
import * as paths from './paths.js';
import * as store from './store.js';
import * as seed from './seed.js';
import * as refs from './refs.js';
import * as links from './links.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, blocked } from '../../core/errors.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

const clean = (v) => String(v || '').trim();

// list/get 的人读渲染共用的标题行：rel 或 path，缺省标题来自正文首个 #
function docHead(d) {
  const addr = d.rel ? d.rel : d.path || d.docId;
  const head = d.title ? `「${d.title}」` : '';
  const extra = d.summary && d.summary !== d.title ? ` · ${d.summary}` : '';
  return `${addr}${head}${extra}`;
}

// ─── 查 ────────────────────────────────────────────────────────────────

// 树索引（零副作用，不播种——agent/前端拿它当双链解析的数据源）
async function listDocs({ external } = {}) {
  const docs = [];
  for (const f of await store.listOwnDocs()) {
    const title = /^#\s+(.+)$/m.exec(f.size <= 512 * 1024 ? await safeRead(f.abs) : '');
    docs.push({
      docId: paths.ownDocId(f.rel),
      rel: f.rel,
      name: f.rel.replace(/\.md$/i, '').split('/').pop(),
      title: title ? title[1].trim() : '',
      size: f.size,
    });
  }
  const out = { docs, count: docs.length };
  if (external) {
    const { loadStore } = await reposBridge();
    const s = await loadStore();
    const closure = await store.externalClosure(s);
    const files = await store.listExternalDocs(closure);
    out.external = files.map((abs) => ({ docId: paths.extDocId(abs), path: abs, name: abs.replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '') }));
    out.bound = closure.map((c) => ({ path: c.path, owner: c.owner, exists: c.exists, isDir: c.isDir }));
  }
  return out;
}

async function safeRead(abs) {
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

// 读全文：自有（惰性播种）/ 外部（闭包内才放行）；目录绑定返回文件清单
async function getDoc({ ref } = {}) {
  if (!clean(ref)) throw badInput('请给文档标识：自有 rel:<路径>（或裸相对路径），外部 path:<绝对路径>');
  const parsed = paths.parseDocId(ref);
  if (parsed.kind === 'own') {
    let body = null;
    try {
      body = await store.readOwnDoc(parsed.rel);
    } catch {
      const seeded = await seed.ensureSeedForRel(parsed.rel);
      if (seeded === null) {
        return { docId: paths.ownDocId(parsed.rel), rel: parsed.rel, missing: true, writable: true, title: '', summary: '', body: '' };
      }
      body = seeded;
    }
    return outOwn(parsed.rel, body);
  }
  // 外部：先过绑定闭包，闭包外一律拒绝——doc.get 不能变成任意文件读入口
  const { loadStore } = await reposBridge();
  const s = await loadStore();
  const closure = await store.externalClosure(s);
  const abs = store.resolveExternal(parsed.path, closure);
  if (!abs) throw blocked(`外部路径不在绑定闭包内（先 docs bind 登记）: ${parsed.path}`);
  let st = null;
  try {
    st = await fsp.stat(abs);
  } catch {
    /* 缺失：按 missing 返回 */
  }
  if (!st) {
    return { docId: paths.extDocId(abs), path: abs, missing: true, writable: true, title: '', summary: '', body: '' };
  }
  if (st.isDirectory()) {
    const files = await store.listExternalDocs([{ path: abs, exists: true, isDir: true }], { maxDepth: 3, maxFiles: 200 });
    return { docId: paths.extDocId(abs), path: abs, dir: true, writable: false, files };
  }
  return outExternal(abs, await safeRead(abs));
}

// ─── 增 / 改 / 删 ──────────────────────────────────────────────────────
//
// 读写口径（2026-11 任务 #88「简介文档优化」）：
//   rel:  自有树（~/.nx-kv/docs/）——可读可写可删
//   path: 外部（Obsidian vault / 任意登记目录）——**登记在册即可写**：
//         读侧要求路径在绑定闭包内；写侧再校验一次（闭包 + .md + 非目录），
//         等于「文档集里的每一篇都能就地改」，同时不把 PATCH 变成任意文件写入口。
//         删除仍不给外部：删除是可恢复性最差的操作，让它回来源做。

// body-file 只给 CLI（templates 先例）：HTTP 是面板的通道，不该变成任意读本机文件的入口
async function bodyOf({ body, bodyFile }, opts) {
  const fileArg = opts && opts.transport === 'http' ? undefined : bodyFile;
  if (typeof body === 'string') return body;
  if (fileArg !== undefined) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(fileArg === '-' ? 0 : fileArg, 'utf8');
  }
  return null;
}

async function addDoc(ctx, opts) {
  const rel = await store.writeOwnDoc(ctx.rel, (await bodyOf(ctx, opts)) ?? '');
  const body = await store.readOwnDoc(rel);
  const summary = await seed.writeBackSummary(rel, body);
  return { docId: paths.ownDocId(rel), rel, bytes: Buffer.byteLength(body, 'utf8'), summary };
}

// 外部文档写回（面板/CLI 均可）：路径必须仍在**绑定闭包**内——闭包是唯一的授权来源，
// 否则 PATCH 就成了任意文件写入口（与 getDoc 的读侧守卫同口径）。
// 目录绑定只允许改写目录内的 .md；单文件绑定只允许那一个文件。
async function writeExternalDoc(abs, body) {
  const { loadStore } = await reposBridge();
  const s = await loadStore();
  const closure = await store.externalClosure(s);
  const hit = store.resolveExternal(abs, closure);
  if (!hit) throw blocked(`外部路径不在绑定闭包内（先 docs bind 登记）: ${abs}`);
  if (!/\.md$/i.test(abs)) throw badInput('只能写回 .md 文档: ' + abs);
  let st = null;
  try {
    st = await fsp.stat(abs);
  } catch {
    st = null;
  }
  if (st && st.isDirectory()) throw blocked('这是目录绑定，不能整体写回: ' + abs);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf8');
  const saved = await safeRead(abs);
  return { docId: paths.extDocId(abs), path: abs, bytes: Buffer.byteLength(saved, 'utf8'), external: true };
}

async function updateDoc(ctx, opts) {
  const parsed = paths.parseDocId(ctx.ref);
  const body = await bodyOf(ctx, opts);
  if (body === null) throw badInput('请给 --body <正文>（多行用 --body-file <文件> 或 - 读管道）');
  // 外部绑定：登记在册 = 我的文档集，允许就地写回来源文件（闭包内校验）
  if (parsed.kind !== 'own') return writeExternalDoc(parsed.path, body);
  // 不存在即创建（面板保存语义：脏页签保存不该因为别人先建了而失败，也不该在这里静默分叉出第二份）
  const rel = await store.writeOwnDoc(parsed.rel, body);
  const saved = await store.readOwnDoc(rel);
  const summary = await seed.writeBackSummary(rel, saved);
  return { docId: paths.ownDocId(rel), rel, bytes: Buffer.byteLength(saved, 'utf8'), summary };
}

async function removeDoc({ ref } = {}) {
  const parsed = paths.parseDocId(ref);
  if (parsed.kind !== 'own') throw blocked('外部绑定是只读引用，不能在这里删除');
  const rel = await store.removeOwnDoc(parsed.rel);
  return { docId: paths.ownDocId(rel), rel };
}

// ─── 出参整形 ──────────────────────────────────────────────────────────

function outOwn(rel, body) {
  const { summaryFromMd } = seed;
  const m = /^#\s+(.+)$/m.exec(body);
  return {
    docId: paths.ownDocId(rel),
    rel,
    title: m ? m[1].trim() : '',
    summary: summaryFromMd(body),
    body,
    writable: true,
  };
}

function outExternal(abs, body) {
  const m = /^#\s+(.+)$/m.exec(body);
  return {
    docId: paths.extDocId(abs),
    path: abs,
    title: m ? m[1].trim() : '',
    summary: seed.summaryFromMd(body),
    body,
    // 登记在册的外部文档 = 用户的文档集，允许就地写回来源文件（写侧另过闭包校验）
    writable: true,
    external: true,
  };
}

// ─── CLI 人读渲染 ──────────────────────────────────────────────────────

const renderList = (d) => {
  const lines = [`自有文档 ${d.count} 个（~/.nx-kv/docs/，env NX_KV_DOCS_DIR 可覆盖）`];
  for (const x of d.docs) lines.push(`  ${x.rel}  ${x.title || x.name}`);
  if (d.external?.length) {
    lines.push(`外部文档 ${d.external.length} 个（只读引用）:`);
    for (const x of d.external) lines.push(`  ${x.path}`);
  }
  if (!d.count && !d.external?.length) {
    lines.push('（还没有文档——描述字符串会在首次读取时播种为 md，或直接 docs seed --apply）');
  }
  return lines.join('\n');
};

const renderGet = (d) => {
  if (d.missing) return `（文档不存在: ${d.rel || d.path}）`;
  if (d.dir) return `（外部目录绑定: ${d.path}，${d.files.length} 个文档）\n  ${d.files.slice(0, 20).join('\n  ')}`;
  const head = [`【${d.title || docHead(d)}】`, `  ${d.rel || d.path}${d.external ? '  （外部 · 可写回来源）' : ''}`, ''];
  return head.join('\n') + d.body;
};

const renderWritten = (d) =>
  `已写入 ${d.rel}（${d.bytes} 字节）${d.summary ? `\n摘要已回写: ${d.summary}` : ''}`;

const renderSeed = (d) => {
  if (d.written !== undefined) return `已播种 ${d.written} 份文档:\n  ${(d.items || []).join('\n  ') || '（无）'}`;
  if (!d.count) return '没有需要播种的文档（字符串字段都为空，或约定路径已有 md）';
  return `待播种 ${d.count} 份（--apply 执行）:\n  ${d.items.map((x) => `${x.rel}  ←「${x.title}」`).join('\n  ')}`;
};

const renderRef = (d) =>
  `${d.ref ? '已绑定' : '已拆绑定（回到约定路径）'}: ${d.kind} ${d.name} → ${d.ref ? (d.ref.rel ? 'rel:' + d.ref.rel : 'path:' + d.ref.path) : '约定路径'}`;

const renderNoteRef = (d) =>
  `${d.ref ? '已绑定' : '已拆绑定'}: 「${d.boardName}」× ${d.repoKey} → ${d.ref ? (d.ref.rel ? 'rel:' + d.ref.rel : 'path:' + d.ref.path) : '约定路径'}`;

const renderLink = (d) => {
  if (d.removed !== undefined) return `已移除组绑定: ${d.removed}（剩 ${d.count} 条）`;
  const lines = [`「${d.boardName}」的组绑定（${d.count} 条）:`];
  for (const l of d.links) {
    lines.push(`  ${l.rel ? 'rel:' + l.rel : 'path:' + l.path}${l.tag ? `  [${l.tag}]` : ''}${l.note ? `  · ${l.note}` : ''}`);
  }
  return lines.join('\n');
};

export default {
  id: 'docs',
  title: '文档（自有 md 树：项目/组介绍、组内描述、双链、外部只读绑定）',
  order: 12,
  // 面板入口在组详情页与工作区 doc 页签（DocPanel），不占独立视图

  resource: 'doc',

  actions: [
    {
      id: 'doc.list',
      cli: ['docs', 'list'],
      http: ['GET', '/api/docs'],
      summary: '文档树索引（自有 + 可选外部；零副作用，双链解析的数据源）',
      flags: {
        external: { type: 'boolean', hint: '附带外部绑定闭包内的文档与绑定清单' },
      },
      run: (ctx) => listDocs(ctx),
      render: renderList,
    },
    {
      id: 'doc.get',
      cli: ['docs', 'get'],
      http: ['GET', '/api/docs/item'],
      summary: '读文档全文：rel:<路径>（或裸相对路径）= 自有；path:<绝对路径> = 外部（须在绑定闭包内）；约定路径缺失时惰性播种',
      args: ['ref'],
      run: (ctx) => getDoc(ctx),
      render: renderGet,
    },
    {
      id: 'doc.add',
      cli: ['docs', 'add'],
      http: ['POST', '/api/docs/item'],
      summary: '新建自有文档（--body 给 Markdown 正文；--body-file <文件> / - 读管道；已存在则报冲突）',
      args: ['rel'],
      flags: {
        body: { type: 'string', hint: 'Markdown 正文' },
        bodyFile: { type: 'string', hint: '从文件读正文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
      },
      run: (ctx, opts) =>
        addDoc(
          { rel: ctx.rel, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
          opts
        ),
      render: renderWritten,
    },
    {
      id: 'doc.update',
      cli: ['docs', 'set'],
      http: ['PATCH', '/api/docs/item'],
      summary: '写文档正文（面板保存走这里；自有走 own 树、外部走绑定闭包内原文件；写盘后摘要回写 desc / 组内 note）',
      args: ['ref'],
      flags: {
        body: { type: 'string', hint: 'Markdown 全文' },
        bodyFile: { type: 'string', hint: '从文件读全文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
      },
      run: (ctx, opts) =>
        updateDoc(
          { ref: ctx.ref, body: ctx.body, bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']) },
          opts
        ),
      render: renderWritten,
    },
    {
      id: 'doc.remove',
      cli: ['docs', 'remove'],
      http: ['DELETE', '/api/docs/item'],
      summary: '删除自有文档（外部绑定不可删）',
      args: ['ref'],
      run: (ctx) => removeDoc(ctx),
      render: (d) => `已删除: ${d.rel}`,
    },

    {
      id: 'docs.seed',
      cli: ['docs', 'seed'],
      http: ['POST', '/api/docs/seed'],
      summary: '把仓库 desc / 看板 desc / 组内 note 字符串播种成约定路径的 md（缺省预览，--apply 执行；幂等）',
      flags: {
        apply: { type: 'boolean', hint: '执行播种（缺省只预览）' },
      },
      run: (ctx) => (ctx.apply ? seed.seedApply() : seed.seedPlan()),
      render: renderSeed,
    },
    {
      id: 'docs.bind',
      cli: ['docs', 'bind'],
      http: ['POST', '/api/docs/bind'],
      summary: '绑定项目/组介绍的文档覆盖（--repo 或 --board 二选一 + --rel <自有路径> | --path <外部文件/目录>；--reset 拆回约定路径）',
      flags: {
        repo: { type: 'string', hint: '仓库（id / key / 路径 / 名称）' },
        board: { type: 'string', hint: '看板（id / key / 名称）' },
        rel: { type: 'string', hint: '自有树内路径（如 repo/github.com/me/x.md）' },
        path: { type: 'string', hint: '外部文件/目录绝对路径（如 Obsidian vault；只读，不进 zip）' },
        reset: { type: 'boolean', hint: '拆掉覆盖，回到约定路径' },
      },
      run: (ctx) => refs.setDocRef(ctx),
      render: renderRef,
    },
    {
      id: 'docs.notebind',
      cli: ['docs', 'note-bind'],
      http: ['POST', '/api/docs/note-bind'],
      summary: '绑定组内仓库描述的文档覆盖（--board <看板> --repo <仓库> + --rel/--path/--reset；仓库须为该组成员）',
      args: ['board'],
      flags: {
        repo: { type: 'string', required: true, hint: '仓库（id / key / 路径 / 名称）' },
        rel: { type: 'string', hint: '自有树内路径' },
        path: { type: 'string', hint: '外部文件/目录绝对路径（只读）' },
        reset: { type: 'boolean', hint: '拆掉覆盖，回到约定路径' },
      },
      run: (ctx) => refs.setNoteDocRef(ctx),
      render: renderNoteRef,
    },
    {
      id: 'docs.link',
      cli: ['docs', 'link'],
      http: ['POST', '/api/docs/link'],
      summary: '维护组的附加文档列表（--doc <自有路径|绝对路径> + --note/--tag；--remove <序号> 移除；--before <序号> 插位；同 doc 重复添加 = 更新）',
      args: ['board'],
      flags: {
        doc: { type: 'string', hint: '自有树路径 = 自有文档；盘符/绝对路径 = 外部只读引用' },
        note: { type: 'string', hint: '条目说明' },
        tag: { type: 'string', hint: '分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）' },
        remove: { type: 'number', hint: '移除第 N 条（1 起）' },
        before: { type: 'number', hint: '插到第 N 条之前（缺省追加到末尾）' },
      },
      run: (ctx) => refs.setDocLink(ctx),
      render: renderLink,
    },
    {
      id: 'docs.index',
      cli: ['docs', 'index'],
      http: ['GET', '/api/docs/index'],
      summary: '双链索引（docId + 文件名；前端点击 [[..]] 前拉一次；解析规则见 core/wikilink.js）',
      run: async () => ({ index: await links.buildIndex() }),
      render: (d) => d.index.map((x) => `  ${x.name}  →  ${x.docId}`).join('\n') || '（空）',
    },
  ],
};
