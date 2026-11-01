// 复合知识查询：一个仓库的完整上下文，一次取齐。
//
// 这是「get 时封装上下文」的供料口：agent 领到某个仓库的任务后，
// `nx-kv repo knowledge --md` 给出项目介绍 + 所属组介绍 + 组内描述 + 组绑定文档 +
// 参考仓库的单篇文本——文档全是磁盘真实路径，agent 拿到就能直接读盘。
//
// 读取规则：
//   - 绑定优先（DocRef），缺省走约定路径；约定路径缺失时惰性播种（字符串字段非空）
//   - 外部目录绑定只列文件清单，不进全文（agent 自己读盘——目录全文没有边界）
//   - 单文件 256KB 截断：知识是给人/模型读的，不是备份通道
import * as paths from './paths.js';
import * as store from './store.js';
import { ensureSeedForRel } from './seed.js';
import { reposBridge } from './repos-bridge.js';

const MAX_DOC_BYTES = 256 * 1024;

// 读自有文档（约定路径可惰性播种）；返回 {docId, title, body} | {missing:true}
async function readOwn(rel, { warnings, label }) {
  let body = null;
  try {
    body = await store.readOwnDoc(rel);
  } catch {
    const seeded = await ensureSeedForRel(rel);
    if (seeded === null) return { missing: true, docId: paths.ownDocId(rel) };
    body = seeded;
  }
  return docOut(paths.ownDocId(rel), body, { warnings, label });
}

// 读外部绑定（闭包校验由调用方完成——这里的 ref 全部来自 store 登记本身）
async function readExternalDoc(abs, { warnings, label }) {
  let st = null;
  try {
    st = await import('node:fs/promises').then((m) => m.stat(abs));
  } catch {
    /* 缺失走 missing */
  }
  if (!st) return { missing: true, docId: paths.extDocId(abs) };
  if (st.isDirectory()) return { dir: true, docId: paths.extDocId(abs), files: await listDirMd(abs) };
  let body;
  try {
    body = await import('node:fs/promises').then((m) => m.readFile(abs, 'utf8'));
  } catch {
    return { missing: true, docId: paths.extDocId(abs) };
  }
  return docOut(paths.extDocId(abs), body, { warnings, label });
}

async function listDirMd(dir) {
  const fsp = await import('node:fs/promises');
  const out = [];
  const walk = async (d, depth) => {
    if (depth > 3 || out.length >= 200) return;
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= 200) return;
      const abs = (await import('node:path')).join(d, e.name);
      if (e.isDirectory() && !['node_modules', '.git', '.obsidian'].includes(e.name)) await walk(abs, depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(abs);
    }
  };
  await walk(dir, 1);
  return out;
}

// 统一出参：title = 首个 # 标题；超限截断并记 warning
function docOut(docId, body, { warnings, label }) {
  const text = String(body || '');
  let out = text;
  if (Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) {
    out = Buffer.from(text, 'utf8').slice(0, MAX_DOC_BYTES).toString('utf8');
    if (warnings) warnings.push(`${label || docId} 超过 256KB —— 已截断（完整内容直接读文件: ${docId}）`);
  }
  const m = /^#\s+(.+)$/m.exec(out);
  return { docId, title: m ? m[1].trim() : '', body: out };
}

/** 单元格文档读取：DocRef（自有/外部）→ 出参；缺省 ref 走约定路径 */
async function readRef(ref, fallbackRel, opts) {
  if (!ref || ref.rel) return readOwn((ref && ref.rel) || fallbackRel, opts);
  return readExternalDoc(ref.path, opts);
}

/**
 * 仓库知识聚合。locator: id / key / 路径 / 名称（缺省 = 当前目录）。
 * md=true 时额外返回 md 文本（get 封装直接可用的单篇形态）。
 */
export async function repoKnowledge(locator, { md = false } = {}) {
  const { getRepo, loadStore, deriveKey, boardKeyOf, boardMemberKeys, autoKeysByPrefix } = await reposBridge();
  let repo;
  try {
    repo = await getRepo(locator || process.cwd());
  } catch (err) {
    if (!locator && err && err.name === 'AppError') {
      throw Object.assign(err, {
        message: '当前目录不在已登记仓库内——请给 repo id / key / 路径，或先 repo add 登记',
      });
    }
    throw err;
  }
  const s = await loadStore();
  const rk = deriveKey(repo);
  const warnings = [];
  const closure = await store.externalClosure(s);

  const intro = await readRef(repo.doc, paths.repoDocRel(rk), { warnings, label: '项目介绍' });

  // 所属组：显式成员 + 前缀规则命中（与 listBoards 同一口径）
  const autoMap = autoKeysByPrefix(s);
  const boards = [];
  for (const b of s.boards) {
    const members = boardMemberKeys(b, s, autoMap);
    if (!members.includes(rk)) continue;
    const bkey = boardKeyOf(b.name);
    const bIntro = await readRef(b.doc, paths.boardDocRel(b.name), { warnings, label: `组介绍·${b.name}` });
    const noteRef = (b.repoDocs || {})[rk];
    const note = await readRef(noteRef, paths.groupNoteRel(b.name, rk), { warnings, label: `组内描述·${b.name}/${rk}` });
    // 组级附加文档：自有/单文件进全文；目录绑定只列清单
    const docLinks = [];
    const externalDirs = [];
    for (const l of Array.isArray(b.docLinks) ? b.docLinks : []) {
      if (l.rel) {
        docLinks.push({ note: l.note || '', ...(await readOwn(l.rel, { warnings, label: `组绑定·${l.rel}` })) });
        continue;
      }
      const abs = l.path && store.resolveExternal(l.path, closure);
      if (!abs) {
        if (l.path) warnings.push(`组绑定「${l.path}」不在绑定闭包内 —— 已跳过`);
        continue;
      }
      const st = await import('node:fs/promises').then((m) => m.stat(abs).catch(() => null));
      if (!st) {
        docLinks.push({ note: l.note || '', missing: true, docId: paths.extDocId(abs) });
      } else if (st.isDirectory()) {
        externalDirs.push({ path: abs, note: l.note || '', files: await listDirMd(abs) });
      } else {
        docLinks.push({ note: l.note || '', ...(await readExternalDoc(abs, { warnings, label: `组绑定·${l.path}` })) });
      }
    }
    boards.push({ name: b.name, key: bkey, intro: bIntro, note, docLinks, externalDirs });
  }

  // 参考仓库（dev 侧反向引用 {kind:'ref'}）
  const refs = [];
  for (const l of Array.isArray(repo.linked) ? repo.linked : []) {
    if (l.kind !== 'ref') continue;
    const r = s.repos.find((x) => deriveKey(x) === l.id);
    refs.push({ name: r ? r.name : l.id, remote: r ? r.remote || '' : '', note: l.note || '' });
  }

  const out = {
    repo: { key: rk, name: repo.name, path: repo.path, desc: repo.desc || '', remote: repo.remote || '', type: repo.type || 'dev' },
    intro: intro.missing ? null : intro,
    boards,
    refs,
    warnings,
  };
  if (md) out.md = renderMd(out);
  return out;
}

// 单篇 markdown：项目介绍 → 各组（介绍/组内描述/绑定文档）→ 参考仓库
function renderMd(k) {
  const lines = [];
  const heading = (t) => (lines.length ? lines.push('', t) : lines.push(t));
  heading(`# ${k.repo.name}`);
  if (k.intro && !k.intro.missing) lines.push(k.intro.body.trim());
  for (const b of k.boards) {
    heading(`## 组：${b.name}`);
    if (b.intro && !b.intro.missing) lines.push(b.intro.body.trim());
    if (b.note && !b.note.missing) lines.push(b.note.body.trim());
    for (const d of b.docLinks) {
      if (!d.missing && d.body) lines.push(d.body.trim());
    }
    for (const dir of b.externalDirs) {
      lines.push('', `外部目录「${dir.path}」（${dir.files.length} 个文档，按需读盘）:`);
      for (const f of dir.files) lines.push(`- ${f}`);
    }
  }
  if (k.refs.length) {
    heading('## 参考仓库');
    for (const r of k.refs) lines.push(`- ${r.name}${r.remote ? `（${r.remote}）` : ''}${r.note ? ` —— ${r.note.split('\n')[0]}` : ''}`);
  }
  return lines.join('\n');
}
