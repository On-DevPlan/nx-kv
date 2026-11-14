// 文档模块的业务逻辑：CRUD + 外部写回 + 直接 ref 的归属。
//
// 「自有文档的正文权威在 DB」——v6 起正文只存 `ref_bodies`；v8 起 ref 没有 rel，
// 身份就是 refs.id，界面与 API 一律用 `ref:<id>` 寻址。
// `repo knowledge` 在 repos 模块（它属于 repo.* 命令族），聚合逻辑在 knowledge.ts。
//
// ─── 读写口径 ──────────────────────────────────────────────────────────
//   ref:  文档库条目（自有 / 外部镜像）——可读可写可删，不落盘（外部写回来源文件）
//   path: 外部（Obsidian vault / 任意登记目录）——登记在册即可写：
//         读侧要求路径在绑定闭包内；写侧再校验一次（闭包 + .md + 非目录）。
//         删除仍不给外部：删除是可恢复性最差的操作，让它回来源做。
import * as paths from './paths.js';
import * as store from './store.js';
import { summaryFromMd } from './seed.js';
import { refTitleOf } from './brief.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, blocked, notFound } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  ensureDocRef,
  noBodyReason,
  refDocById,
  syncRefAttachments,
  upsertRefBody,
} from '../../core/attachmentdb.js';
import { refIdFor } from '../../core/attachmentdb/ids.js';
import { normalizeKey } from '../../shared/repo-key.js';
import { randomUUID } from 'node:crypto';
import type { DocKind } from '../../core/attachmentdb.js';
import { syncRefIndex } from './ref-sync.js';
import { scrubHosts } from './host-scrub.js';
import { docTitleFromMd } from '../../shared/doc-title.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

const clean = (v: unknown): string => String(v || '').trim();

const baseNameOf = (p: unknown): string =>
  String(p || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? '';

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
  /** refs.id（ref 的稳定地址） */
  refId: string;
  /** 短描述（v7）：列表主标签 */
  desc: string;
  /** 正文首行摘要（没有 `# 标题` 时的显示名兜底） */
  summary: string;
  /** 正文标题 → desc → 摘要 → locator 末段 → refId（不展示任何路径） */
  name: string;
  title: string;
  size: number;
  /** normal | legacy | external | empty（后三类不是正常文档） */
  kind: DocKind;
  hasBody: boolean;
  missing?: boolean;
  reason?: string;
}

/** docs list 的出参。 */
export interface ListDocsResult {
  docs: DocSummary[];
  count: number;
  external?: Array<{ docId: string; path: string; name: string }>;
  bound?: Array<{ path: string; owner?: string; exists: boolean; isDir: boolean }>;
}

/** 一条 ref 的归属。 */
export interface RefBindingView {
  type: string;
  repoKey: string;
  groupKey: string | null;
  position: number;
  note: string;
  tag: string;
  main: boolean;
}

/** docs get 的出参（自有/外部/missing/目录四种形态共用）。 */
export interface DocGetResult {
  docId: string;
  /** refs.id（ref 的稳定地址；面板行与模板取用指令都用它） */
  refId?: string;
  /** 外部镜像的实际位置（仅 origin=external） */
  path?: string;
  title?: string;
  summary?: string;
  /** 短描述（v7） */
  desc?: string;
  /** 这篇 ref 的归属（ref_bindings；一个 ref 可挂多处） */
  bindings?: RefBindingView[];
  body?: string;
  missing?: boolean;
  writable?: boolean;
  dir?: boolean;
  files?: string[];
  external?: boolean;
  /** 条目类别；没有正文时与 reason 一起返回 missing 语义 */
  kind?: DocKind;
  reason?: string;
}

/** doc add / update 的入参（body-file 只给 CLI）。 */
export interface DocWriteCtx {
  ref?: unknown;
  body?: unknown;
  bodyFile?: unknown;
  /** v7：短描述（可单独更新，不碰正文） */
  desc?: unknown;
}

/** doc 写回的出参。 */
export interface DocWriteResult {
  docId: string;
  refId?: string;
  path?: string;
  /** 短描述（v7） */
  desc?: string;
  bytes: number;
  summary?: string | null;
  external?: boolean;
}

// ─── 查 ────────────────────────────────────────────────────────────────

// 树索引（零副作用——agent/前端拿它当双链解析的数据源）
export async function listDocs({ external }: { external?: boolean } = {}): Promise<ListDocsResult> {
  const docs: DocSummary[] = [];
  for (const f of await store.listOwnDocs({ includeEmpty: true })) {
    // #168：标题口径 = 正文**首行**的 `# 标题`（与文档页/附件清单同一口径）
    const body = f.hasBody ? String(f.body ?? '') : '';
    const title = f.hasBody ? docTitleFromMd(body) : '';
    const summary = body ? summaryFromMd(body) : '';
    // 显示名一条链：正文标题 → desc → 摘要 → 外部文件名 → refId。
    // v8 没有路径名了——没有摘要兜底，旧文档会全叫「未命名文档」。
    const name = refTitleOf(
      { body, desc: f.desc, locator: f.locator, origin: f.origin },
      f.id
    );
    docs.push({
      docId: paths.ownDocId(f.id),
      refId: f.id,
      desc: f.desc,
      summary,
      name,
      title,
      size: f.size,
      kind: f.kind,
      hasBody: f.hasBody,
      ...(f.hasBody ? {} : { missing: true, reason: noBodyReason(f.kind) }),
    });
  }
  const out: ListDocsResult = { docs, count: docs.length };
  if (external) {
    const closure = await store.externalClosure();
    const files = await store.listExternalDocs(closure);
    out.external = files.map((abs) => ({ docId: paths.extDocId(abs), path: abs, name: baseNameOf(abs) }));
    out.bound = closure.map((c) => ({ path: c.path, owner: c.owner, exists: c.exists, isDir: c.isDir }));
  }
  return out;
}

/** refId 形式的地址：`ref:<id>` 或裸 `ref_<16hex>`（ref 是 DB 实体，地址就是 id）。 */
const REF_ID_INPUT = /^(?:ref:)?(ref_[0-9a-f]{16})$/i;

interface RefIdInput {
  refId: string;
  origin: string;
  locator: string;
  externalPath: string;
  desc: string;
}

/** 输入是不是 refId；是则按 refs.id 解析（不回退到路径猜测）。 */
function resolveRefIdInput(raw: unknown): RefIdInput | null {
  const s = clean(raw);
  const m = REF_ID_INPUT.exec(s);
  if (!m) return null;
  const row = refDocById(getDb(), m[1]);
  if (!row) throw notFound('文档不存在: ' + m[1]);
  // 外部镜像行：locator 是真实绝对路径，读取仍走闭包校验
  const externalPath = row.origin === 'external' && /^([A-Za-z]:[\\/]|[\\/])/.test(row.locator) ? row.locator : '';
  return { refId: row.id, origin: row.origin, locator: row.locator, externalPath, desc: row.desc };
}

/** 一个 ref 的归属清单（ref_bindings）。 */
function bindingsOfRef(refId: string): RefBindingView[] {
  if (!clean(refId)) return [];
  return getDb()
    .all(
      `SELECT type, repo_key AS repoKey, group_key AS groupKey, position, note, tag
         FROM ref_bindings WHERE ref_id = :id ORDER BY type, position`,
      { id: refId }
    )
    .map((r: any) => ({
      type: String(r.type),
      repoKey: String(r.repoKey),
      groupKey: r.groupKey == null ? null : String(r.groupKey),
      position: Number(r.position) || 0,
      note: String(r.note || ''),
      tag: String(r.tag || ''),
      main: (Number(r.position) || 0) === 0,
    }));
}

// 读全文：ref 只按 refId；外部目录里的裸文件用 path:<绝对路径>（不是 ref，不进文档库）
export async function getDoc({ ref }: { ref?: unknown } = {}): Promise<DocGetResult> {
  if (!clean(ref)) throw badInput('请给文档标识：ref:<refId> / path:<外部绝对路径>');
  const hit = resolveRefIdInput(ref);
  const rawPath = hit
    ? hit.externalPath
    : (String(ref).startsWith('path:') ? String(ref).slice(5).trim() : '');
  if (!hit && !rawPath) throw notFound('文档不存在: ' + clean(ref));
  if (!rawPath) {
    const state = await store.ownDocState(hit!.refId);
    if (state.hasBody) {
      return {
        ...outOwn(hit!.refId, state.body ?? '', state.kind),
        desc: state.desc,
        bindings: bindingsOfRef(hit!.refId),
      };
    }
    return {
      docId: paths.ownDocId(hit!.refId),
      refId: state.id,
      desc: state.desc,
      bindings: bindingsOfRef(hit!.refId),
      missing: true,
      writable: false,
      title: '',
      summary: '',
      body: '',
      kind: state.kind,
      reason: state.reason,
    };
  }

  // 外部：ref 的 locator 或外部目录里的裸文件，先过绑定闭包
  const abs = store.resolveExternal(rawPath, await store.externalClosure());
  if (!abs) throw blocked(`外部路径不在绑定闭包内（先 docs bind 登记）: ${rawPath}`);
  const meta = hit
    ? { refId: hit.refId, desc: hit.desc, bindings: bindingsOfRef(hit.refId), docId: paths.ownDocId(hit.refId) }
    : { docId: paths.extDocId(abs) };
  let st: Awaited<ReturnType<typeof fsp.stat>> | null = null;
  try {
    st = await fsp.stat(abs);
  } catch {
    /* 缺失：按 missing 返回 */
  }
  if (!st) {
    return { ...meta, path: abs, missing: true, writable: true, title: '', summary: '', body: '' };
  }
  if (st.isDirectory()) {
    const files = await store.listExternalDocs([{ path: abs, exists: true, isDir: true }], { maxDepth: 3, maxFiles: 200 });
    return { ...meta, path: abs, dir: true, writable: false, files };
  }
  return { ...outExternal(abs, await safeRead(abs)), ...meta };
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

/** 写一篇已存在的 ref（新建走 createRef）。 */
export async function addDoc(ctx: DocWriteCtx, opts?: { transport?: string } | null): Promise<DocWriteResult> {
  return updateDoc(ctx, opts);
}

// 外部文档写回（面板/CLI 均可）：路径必须仍在**绑定闭包**内——闭包是唯一的授权来源，
// 否则 PATCH 就成了任意文件写入口（与 getDoc 的读侧守卫同口径）。
async function writeExternalDoc(abs: string, body: string, refId = ''): Promise<DocWriteResult> {
  const hit = store.resolveExternal(abs, await store.externalClosure());
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
  const db = getDb();
  tx(
    (conn) => {
      const id = refId || ensureDocRef(conn, { locator: abs });
      if (id) syncRefAttachments(conn, { refId: id, text: saved });
    },
    { db, mode: 'IMMEDIATE' }
  );
  return { docId: refId ? paths.ownDocId(refId) : '', refId, path: abs, bytes: Buffer.byteLength(saved, 'utf8'), external: true };
}

export async function updateDoc(ctx: DocWriteCtx, opts?: { transport?: string } | null): Promise<DocWriteResult> {
  const hit = resolveRefIdInput(ctx.ref);
  if (!hit) throw badInput('请给 --ref <refId>');
  const body = await bodyOf(ctx, opts);
  const desc = ctx.desc === undefined ? null : String(ctx.desc ?? '').trim();
  if (body === null && desc === null) {
    throw badInput('请给 --body <正文>（多行用 --body-file <文件> 或 - 读管道）或 --desc <描述>');
  }
  // 外部 ref：登记在册 = 我的文档集，允许就地写回 locator 指向的文件（闭包内校验）
  if (hit.externalPath) {
    const out = body === null
      ? { docId: paths.ownDocId(hit.refId), path: hit.externalPath, bytes: 0, external: true }
      : await writeExternalDoc(hit.externalPath, body, hit.refId);
    if (desc !== null) {
      await store.setOwnDocDesc(hit.refId, desc);
      return { ...out, refId: hit.refId, desc };
    }
    return { ...out, refId: hit.refId };
  }
  // 自有 ref
  if (body === null) {
    const saved = await store.setOwnDocDesc(hit.refId, desc);
    const state = await store.ownDocState(hit.refId);
    return {
      docId: paths.ownDocId(hit.refId),
      refId: hit.refId,
      desc: saved,
      bytes: state.body ? Buffer.byteLength(state.body, 'utf8') : 0,
    };
  }
  const refId = await store.writeOwnDoc(hit.refId, body);
  const saved = await store.readOwnDoc(refId);
  const finalDesc = desc !== null ? await store.setOwnDocDesc(refId, desc) : (await store.ownDocState(refId)).desc;
  return {
    docId: paths.ownDocId(refId),
    refId,
    desc: finalDesc,
    bytes: Buffer.byteLength(saved, 'utf8'),
    summary: summaryFromMd(saved),
  };
}

export async function removeDoc({ ref }: { ref?: unknown } = {}): Promise<{ docId: string; refId: string }> {
  const hit = resolveRefIdInput(ref);
  if (!hit) throw badInput('请给 refId（ref_…）');
  if (hit.externalPath) throw blocked('外部绑定是只读引用，不能在这里删除');
  const refId = await store.removeOwnDoc(hit.refId);
  // #132：删了文档就把宿主 ext 里指着它的引用摘掉——否则「项目介绍」看着有、
  // 实际读不到正文（参考仓库尤其明显：它们的主篇/补充篇也走同一套 ext）。
  await scrubHosts(new Set([refId]));
  await syncRefIndex().catch(() => null);
  return { docId: paths.ownDocId(refId), refId };
}

// ─── 直接 ref（v7）：desc + 归属，不涉及任何文件 / 路径 ────────────────

/**
 * 组定位（id / 冻结 key / 派生 key / 名称）——#119。
 *
 * 组的身份是**冻结 key**（新建时按当时的名字算，之后改名不漂）。历史数据的 key
 * 有的是 `group/<name>`、有的是 `board/<name>`；而 boardKeyOf(name) 永远给
 * `board/<name>`。createRef 以前只比 id / 派生 key / 名字，于是拿 `group/nx` 这种
 * 冻结 key 来建组文档就会「组不存在」——先比 b.key 再比派生值。
 */
function findBoardLoose(s: any, locator: unknown, keyOf: (name: unknown) => string): any {
  const raw = String(locator || '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase();
  return (
    s.boards.find((b: any) => String(b.id || '') === raw) ||
    s.boards.find((b: any) => String(b.key || '') === raw) ||
    s.boards.find((b: any) => String(b.key || '').toLowerCase() === low) ||
    // 没有冻结 key 的旧看板才回落到派生 key（board/<name>）
    s.boards.find((b: any) => String(b.key || '') === '' && keyOf(b.name) === raw) ||
    s.boards.find((b: any) => String(b.name || '').toLowerCase() === low) ||
    null
  );
}

/** ref 的宿主类型（ref_bindings.type）。 */
export type RefOwnerType = 'repo' | 'group' | 'group_repo';

/** createRef 的入参。 */
export interface CreateRefInput {
  desc?: unknown;
  owner?: unknown;
  /** 仓库 locator（id / key / 名称） */
  repo?: unknown;
  /** 组 locator（id / key / 名称） */
  group?: unknown;
}

/** createRef 的出参。 */
export interface CreateRefResult {
  refId: string;
  docId: string;
  desc: string;
  bindings: RefBindingView[];
}

/**
 * 新建一个直接 ref：`refs` 行 + 空正文 + 一条归属。
 *
 * 口径（v8）：ref 是 DB 实体，身份就是 refs.id；没有 rel / 路径 / 文件名。
 * 归属同时写进宿主 ext（doc/docLinks/repoDocs）与 ref_bindings 索引。
 */
export async function createRef({ desc, owner = 'repo', repo: repoLocator, group: groupLocator }: CreateRefInput = {}): Promise<CreateRefResult> {
  const type = String(owner || 'repo') as RefOwnerType;
  if (!['repo', 'group', 'group_repo'].includes(type)) {
    throw badInput('归属类型只能是 repo / group / group_repo: ' + String(owner));
  }
  const { mutateStore, deriveKey, boardKeyOf } = await reposBridge();
  const descText = clean(desc);
  const id = refIdFor(randomUUID());
  const at = Date.now();
  const db = getDb();
  tx(
    (conn: any) => {
      conn.run(
        `INSERT INTO refs (id, type, locator, origin, state, version, deleted_at, created_at, updated_at, "desc")
         VALUES (:id, 'md', '', 'own', '', 0, NULL, :at, :at, :desc)`,
        { id, at, desc: descText }
      );
      // 空正文也落行：新建的是可编辑文档，不是「无正文」空壳。
      upsertRefBody(conn, { refId: id, body: '', atMs: at });
    },
    { db, mode: 'IMMEDIATE' }
  );
  await mutateStore((s: any) => {
    if (type === 'group_repo') {
      const board = findBoardLoose(s, groupLocator, boardKeyOf);
      if (!board) throw notFound('组不存在: ' + clean(groupLocator));
      const repo = s.repos.find((r: any) => r.id === clean(repoLocator)
        || deriveKey(r) === clean(repoLocator)
        || String(r.name).toLowerCase() === clean(repoLocator).toLowerCase());
      // 占位成员（本地未登记）也允许建组内描述：key 直接按输入归一
      const repoKey = repo ? deriveKey(repo) : normalizeKey(repoLocator || '');
      if (!repoKey) throw notFound('仓库不存在: ' + clean(repoLocator));
      if (!board.repoDocs) board.repoDocs = {};
      board.repoDocs[repoKey] = { ref: id };
      return;
    }
    if (type === 'group') {
      const board = findBoardLoose(s, groupLocator, boardKeyOf);
      if (!board) throw notFound('组不存在: ' + clean(groupLocator));
      if (!board.doc) board.doc = { ref: id };
      else {
        if (!Array.isArray(board.docLinks)) board.docLinks = [];
        board.docLinks.push({ ref: id });
      }
      return;
    }
    const repo = s.repos.find((r: any) => r.id === clean(repoLocator)
      || deriveKey(r) === clean(repoLocator)
      || String(r.name).toLowerCase() === clean(repoLocator).toLowerCase());
    if (!repo) throw notFound('仓库不存在: ' + clean(repoLocator));
    if (!repo.doc) repo.doc = { ref: id };
    else {
      if (!Array.isArray(repo.docLinks)) repo.docLinks = [];
      repo.docLinks.push({ ref: id });
    }
  });
  await syncRefIndex().catch(() => null);
  return { refId: id, docId: 'ref:' + id, desc: descText, bindings: bindingsOfRef(id) };
}

/** unbindRef 的入参：按行精确解绑。 */
export interface UnbindRefInput {
  ref?: unknown;
  type?: unknown;
  repo?: unknown;
  group?: unknown;
}

/**
 * 解绑一条 ref 的归属（不删 ref、不删正文）：同时摘宿主 ext 与索引。
 */
export async function unbindRef({ ref, type, repo, group }: UnbindRefInput = {}): Promise<{ refId: string; removed: number; orphan: boolean }> {
  const hit = resolveRefIdInput(ref);
  if (!hit) throw badInput('请给 refId（ref_…）');
  const t = String(type || '');
  if (!['repo', 'group', 'group_repo'].includes(t)) throw badInput('归属类型只能是 repo / group / group_repo');
  const repoKey = clean(repo);
  if (!repoKey) throw badInput('缺少归属宿主（repo 或 group key）');
  const { mutateStore } = await reposBridge();
  const removed = await mutateStore((s: any) => {
    if (t === 'group_repo') {
      const board = s.boards.find((b: any) => b.key === clean(group));
      const cur = board && board.repoDocs ? board.repoDocs[repoKey] : null;
      if (!cur || cur.ref !== hit.refId) return 0;
      delete board.repoDocs[repoKey];
      return 1;
    }
    const host = t === 'group'
      ? s.boards.find((b: any) => b.key === repoKey)
      : s.repos.find((r: any) => r.key === repoKey);
    if (!host) return 0;
    let n = 0;
    if (host.doc && host.doc.ref === hit.refId) {
      if (t === 'repo' || t === 'group') {
        const next = Array.isArray(host.docLinks) ? host.docLinks.shift() : null;
        if (next) host.doc = next;
        else delete host.doc;
      }
      n += 1;
    }
    if (Array.isArray(host.docLinks)) {
      const at = host.docLinks.findIndex((x: any) => x && x.ref === hit.refId);
      if (at >= 0) { host.docLinks.splice(at, 1); n += 1; }
    }
    return n;
  });
  await syncRefIndex().catch(() => null);
  const left = getDb().get('SELECT 1 AS x FROM ref_bindings WHERE ref_id = :id', { id: hit.refId });
  return { refId: hit.refId, removed, orphan: !left };
}

// ─── 出参整形 ──────────────────────────────────────────────────────────

function outOwn(refId: string, body: string, kind: DocKind = 'normal'): DocGetResult {
  // #168：标题 = 正文**首行**的 `# 标题`（不是「任意位置的首个 # 行」——
  // 那样正文中间插一行 ## 就会改标题；也不是「首个非空行」——那会让正文
  // 第一行顶替标题）。与前端 shared/doc-title.js 同一口径。
  return {
    docId: paths.ownDocId(refId),
    refId,
    title: docTitleFromMd(body),
    summary: summaryFromMd(body),
    body,
    writable: true,
    kind,
  };
}

function outExternal(abs: string, body: string): DocGetResult {
  return {
    docId: paths.extDocId(abs),
    path: abs,
    // #168：与自有文档同一口径——标题 = 正文首行的 `# 标题`
    title: docTitleFromMd(body),
    summary: summaryFromMd(body),
    body,
    // 登记在册的外部文档 = 用户的文档集，允许就地写回来源文件（写侧另过闭包校验）
    writable: true,
    external: true,
    kind: 'external',
  };
}
