// 文档模块的业务逻辑：CRUD + 外部写回。
//
// 「描述的权威是磁盘上的 .md 文件」——本模块只做这件事：CRUD、绑定、种子、知识聚合。
// 面板编辑（DocPanel）与组详情渲染都从这里取数；`repo knowledge` 在 repos 模块
// （它属于 repo.* 命令族），聚合逻辑在 knowledge.js。
//
// ─── 读写口径（2026-11 任务 #88「简介文档优化」）───────────────────────
//   rel:  自有树（~/.nx-kv/docs/）——可读可写可删
//   path: 外部（Obsidian vault / 任意登记目录）——**登记在册即可写**：
//         读侧要求路径在绑定闭包内；写侧再校验一次（闭包 + .md + 非目录），
//         等于「文档集里的每一篇都能就地改」，同时不把 PATCH 变成任意文件写入口。
//         删除仍不给外部：删除是可恢复性最差的操作，让它回来源做。
import * as paths from './paths.js';
import * as store from './store.js';
import * as seed from './seed.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, blocked } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { ensureDocRef, syncRefAttachments } from '../../core/attachmentdb.js';
import { docTitleFromMd } from '../../shared/doc-title.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

const clean = (v: unknown): string => String(v || '').trim();

async function safeRead(abs: string): Promise<string> {
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return '';
  }
}

/** docs list 条目。 */
export interface DocSummary {
  docId: string;
  rel: string;
  name: string;
  title: string;
  size: number;
}

/** docs list 的出参。 */
export interface ListDocsResult {
  docs: DocSummary[];
  count: number;
  external?: Array<{ docId: string; path: string; name: string }>;
  bound?: Array<{ path: string; owner?: string; exists: boolean; isDir: boolean }>;
}

/** docs get 的出参（自有/外部/missing/目录四种形态共用）。 */
export interface DocGetResult {
  docId: string;
  rel?: string;
  path?: string;
  title?: string;
  summary?: string;
  body?: string;
  missing?: boolean;
  writable?: boolean;
  dir?: boolean;
  files?: string[];
  external?: boolean;
}

/** doc add / update 的入参（body-file 只给 CLI）。 */
export interface DocWriteCtx {
  ref?: unknown;
  rel?: unknown;
  body?: unknown;
  bodyFile?: unknown;
}

/** doc 写回的出参。 */
export interface DocWriteResult {
  docId: string;
  rel?: string;
  path?: string;
  bytes: number;
  /** 外部绑定写回不产生摘要（summary 只来自自有树 writeBackSummary） */
  summary?: string | null;
  external?: boolean;
}

// ─── 查 ────────────────────────────────────────────────────────────────

// 树索引（零副作用，不播种——agent/前端拿它当双链解析的数据源）
export async function listDocs({ external }: { external?: boolean } = {}): Promise<ListDocsResult> {
  const docs: DocSummary[] = [];
  for (const f of await store.listOwnDocs()) {
    // #168：标题口径 = 正文**首行**的 `# 标题`（与文档页/附件清单同一口径）
    const title = docTitleFromMd(f.size <= 512 * 1024 ? await safeRead(f.abs) : '');
    docs.push({
      docId: paths.ownDocId(f.rel),
      rel: f.rel,
      name: f.rel.replace(/\.md$/i, '').split('/').pop() ?? '',
      title,
      size: f.size,
    });
  }
  const out: ListDocsResult = { docs, count: docs.length };
  if (external) {
    const { loadStore } = await reposBridge();
    const s = await loadStore();
    const closure = await store.externalClosure(s);
    const files = await store.listExternalDocs(closure);
    out.external = files.map((abs) => ({ docId: paths.extDocId(abs), path: abs, name: abs.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? '' }));
    out.bound = closure.map((c) => ({ path: c.path, owner: c.owner, exists: c.exists, isDir: c.isDir }));
  }
  return out;
}

// 读全文：自有（惰性播种）/ 外部（闭包内才放行）；目录绑定返回文件清单
export async function getDoc({ ref }: { ref?: unknown } = {}): Promise<DocGetResult> {
  if (!clean(ref)) throw badInput('请给文档标识：自有 rel:<路径>（或裸相对路径），外部 path:<绝对路径>');
  const parsed = paths.parseDocId(ref);
  if (parsed.kind === 'own') {
    let body: string | null = null;
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
  let st: Awaited<ReturnType<typeof fsp.stat>> | null = null;
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

// body-file 只给 CLI（templates 先例）：HTTP 是面板的通道，不该变成任意读本机文件的入口
async function bodyOf({ body, bodyFile }: DocWriteCtx, opts?: { transport?: string } | null): Promise<string | null> {
  const fileArg = opts && opts.transport === 'http' ? undefined : bodyFile;
  if (typeof body === 'string') return body;
  if (fileArg !== undefined) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(fileArg === '-' ? 0 : (fileArg as string | number), 'utf8');
  }
  return null;
}

export async function addDoc(ctx: DocWriteCtx, opts?: { transport?: string } | null): Promise<DocWriteResult> {
  const rel = await store.writeOwnDoc(ctx.rel as string, (await bodyOf(ctx, opts)) ?? '');
  const body = await store.readOwnDoc(rel);
  const summary = await seed.writeBackSummary(rel, body);
  return { docId: paths.ownDocId(rel), rel, bytes: Buffer.byteLength(body, 'utf8'), summary };
}

// 外部文档写回（面板/CLI 均可）：路径必须仍在**绑定闭包**内——闭包是唯一的授权来源，
// 否则 PATCH 就成了任意文件写入口（与 getDoc 的读侧守卫同口径）。
// 目录绑定只允许改写目录内的 .md；单文件绑定只允许那一个文件。
async function writeExternalDoc(abs: string, body: string): Promise<DocWriteResult> {
  const { loadStore } = await reposBridge();
  const s = await loadStore();
  const closure = await store.externalClosure(s);
  const hit = store.resolveExternal(abs, closure);
  if (!hit) throw blocked(`外部路径不在绑定闭包内（先 docs bind 登记）: ${abs}`);
  if (!/\.md$/i.test(abs)) throw badInput('只能写回 .md 文档: ' + abs);
  let st: Awaited<ReturnType<typeof fsp.stat>> | null = null;
  try {
    st = await fsp.stat(abs);
  } catch {
    st = null;
  }
  if (st && st.isDirectory()) throw blocked('这是目录绑定，不能整体写回: ' + abs);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf8');
  const saved = await safeRead(abs);
  // 外部文档同样是「文档库的一行」：正文里的 fileId / nxkv 链接也落 ref_attach。
  // 与自有树同一事务口径（ensureDocRef 幂等；refs 只装 .md）。
  const db = getDb();
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { locator: abs });
      syncRefAttachments(conn, { refId, text: saved });
    },
    { db, mode: 'IMMEDIATE' }
  );
  return { docId: paths.extDocId(abs), path: abs, bytes: Buffer.byteLength(saved, 'utf8'), external: true };
}

export async function updateDoc(ctx: DocWriteCtx, opts?: { transport?: string } | null): Promise<DocWriteResult> {
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

export async function removeDoc({ ref }: { ref?: unknown } = {}): Promise<{ docId: string; rel: string }> {
  const parsed = paths.parseDocId(ref);
  if (parsed.kind !== 'own') throw blocked('外部绑定是只读引用，不能在这里删除');
  const rel = await store.removeOwnDoc(parsed.rel);
  return { docId: paths.ownDocId(rel), rel };
}

// ─── 出参整形 ──────────────────────────────────────────────────────────

function outOwn(rel: string, body: string): DocGetResult {
  const { summaryFromMd } = seed;
  // #168：标题 = 正文**首行**的 `# 标题`（不是「任意位置的首个 # 行」——
  // 那样正文中间插一行 ## 就会改标题；也不是「首个非空行」——那会让正文
  // 第一行顶替标题）。与前端 shared/doc-title.js 同一口径。
  return {
    docId: paths.ownDocId(rel),
    rel,
    title: docTitleFromMd(body),
    summary: summaryFromMd(body),
    body,
    writable: true,
  };
}

function outExternal(abs: string, body: string): DocGetResult {
  return {
    docId: paths.extDocId(abs),
    path: abs,
    // #168：与自有树同一口径——标题 = 正文首行的 `# 标题`
    title: docTitleFromMd(body),
    summary: seed.summaryFromMd(body),
    body,
    // 登记在册的外部文档 = 用户的文档集，允许就地写回来源文件（写侧另过闭包校验）
    writable: true,
    external: true,
  };
}
