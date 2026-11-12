// 文档模块的业务逻辑：CRUD + 外部写回。
//
// 「自有文档的正文权威在 DB」——v6 起正文只存 `ref_bodies`；mdfile 默认目录
// 只是 mdfile 默认附件目录，不再是文档来源（面板编辑与组详情都从这里取数）。
// `repo knowledge` 在 repos 模块（它属于 repo.* 命令族），聚合逻辑在 knowledge.js。
//
// ─── 读写口径（2026-11 任务 #88「简介文档优化」）───────────────────────
//   rel:  自有树（DB 里的逻辑 rel）——可读可写可删，不落盘
//   path: 外部（Obsidian vault / 任意登记目录）——**登记在册即可写**：
//         读侧要求路径在绑定闭包内；写侧再校验一次（闭包 + .md + 非目录），
//         等于「文档集里的每一篇都能就地改」，同时不把 PATCH 变成任意文件写入口。
//         删除仍不给外部：删除是可恢复性最差的操作，让它回来源做。
//         （外部路径不在 mdfile 默认目录下；后者只允许经 mdfile 附件访问。）
import * as paths from './paths.js';
import * as store from './store.js';
import * as seed from './seed.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, blocked, notFound } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { ensureDocRef, markRefBound, noBodyReason, putRefBinding, refDocById, syncRefAttachments, upsertRefBody } from '../../core/attachmentdb.js';
import { refIdFor } from '../../core/attachmentdb/ids.js';
import { randomUUID } from 'node:crypto';
import type { RelKind } from '../../core/attachmentdb.js';
import { syncRefIndex } from './ref-sync.js';
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
  /** refs.id（v7：ref 的稳定地址） */
  refId: string;
  rel: string;
  /** 短描述（v7）：列表主标签 */
  desc: string;
  name: string;
  title: string;
  size: number;
  /** v6：normal | legacy | external | empty（后三类不是正常文档） */
  relKind: RelKind;
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

/** docs get 的出参（自有/外部/missing/目录四种形态共用）。 */
export interface DocGetResult {
  docId: string;
  /** refs.id（v7：ref 的稳定地址；面板行与模板取用指令都用它） */
  refId?: string;
  rel?: string;
  path?: string;
  title?: string;
  summary?: string;
  /** 短描述（v7） */
  desc?: string;
  /** 这篇 ref 的归属（ref_bindings；一个 ref 可挂多处） */
  bindings?: Array<{ type: string; repoKey: string; groupKey: string | null; position: number }>;
  body?: string;
  missing?: boolean;
  writable?: boolean;
  dir?: boolean;
  files?: string[];
  external?: boolean;
  /** v6：条目类别；没有正文时与 reason 一起返回 missing 语义 */
  relKind?: RelKind;
  reason?: string;
}

/** doc add / update 的入参（body-file 只给 CLI）。 */
export interface DocWriteCtx {
  ref?: unknown;
  rel?: unknown;
  body?: unknown;
  bodyFile?: unknown;
  /** v7：短描述（可单独更新，不碰正文） */
  desc?: unknown;
}

/** doc 写回的出参。 */
export interface DocWriteResult {
  docId: string;
  refId?: string;
  rel?: string;
  path?: string;
  /** 短描述（v7） */
  desc?: string;
  bytes: number;
  /** 外部绑定写回不产生摘要（summary 只来自自有树 writeBackSummary） */
  summary?: string | null;
  external?: boolean;
}

// ─── 查 ────────────────────────────────────────────────────────────────

// 树索引（零副作用，不播种——agent/前端拿它当双链解析的数据源）
export async function listDocs({ external }: { external?: boolean } = {}): Promise<ListDocsResult> {
  const docs: DocSummary[] = [];
  // includeEmpty：历史空壳 / 外部镜像 / 无正文行也要出现在清单里，但必须显式标注，
  // 不能让它们看起来像正常文档（v6 验收项）。
  for (const f of await store.listOwnDocs({ includeEmpty: true })) {
    // #168：标题口径 = 正文**首行**的 `# 标题`（与文档页/附件清单同一口径）
    const title = f.hasBody ? docTitleFromMd(f.body ?? '') : '';
    docs.push({
      docId: paths.ownDocId(f.rel),
      refId: f.id,
      rel: f.rel,
      desc: f.desc,
      name: f.rel.replace(/\.md$/i, '').split('/').pop() ?? '',
      title,
      size: f.size,
      relKind: f.relKind,
      hasBody: f.hasBody,
      ...(f.hasBody ? {} : { missing: true, reason: noBodyReason(f.relKind) }),
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

/** refId 形式的地址：`ref:<id>` 或裸 `ref_<16hex>`（ref 是 DB 实体，地址就是 id）。 */
const REF_ID_INPUT = /^(?:ref:)?(ref_[0-9a-f]{16})$/i;

interface RefIdInput {
  refId: string;
  rel: string;
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
  return { refId: row.id, rel: row.rel, externalPath, desc: row.desc };
}

/** 一个 ref 的归属清单（ref_bindings）。 */
function bindingsOfRef(refId: string): NonNullable<DocGetResult['bindings']> {
  if (!clean(refId)) return [];
  return getDb()
    .all(
      `SELECT type, repo_key AS repoKey, group_key AS groupKey, position
         FROM ref_bindings WHERE ref_id = :id ORDER BY type, position`,
      { id: refId }
    )
    .map((r: any) => ({
      type: String(r.type),
      repoKey: String(r.repoKey),
      groupKey: r.groupKey == null ? null : String(r.groupKey),
      position: Number(r.position) || 0,
    }));
}

// 读全文：自有（惰性播种）/ 外部（闭包内才放行）；目录绑定返回文件清单
export async function getDoc({ ref }: { ref?: unknown } = {}): Promise<DocGetResult> {
  if (!clean(ref)) throw badInput('请给文档标识：ref:<refId> / rel:<路径> / path:<绝对路径>');
  const hit = resolveRefIdInput(ref);
  const parsed = hit
    ? (hit.externalPath ? { kind: 'external' as const, path: hit.externalPath } : { kind: 'own' as const, rel: hit.rel })
    : (paths.parseDocId(ref) as { kind: 'own'; rel: string } | { kind: 'external'; path: string });
  const meta = hit ? { refId: hit.refId, desc: hit.desc, bindings: bindingsOfRef(hit.refId) } : {};
  if (parsed.kind === 'own') {
    const state = await store.ownDocState(parsed.rel);
    if (state.exists && state.hasBody) {
      return {
        ...outOwn(parsed.rel, state.body ?? '', state.relKind),
        refId: state.id,
        desc: state.desc,
        bindings: bindingsOfRef(state.id),
      };
    }
    // v6：有行但没有正文（历史空壳 / 外部镜像 / 正文缺失）→ 显式 missing + 原因，
    // 不返回空文档成功态，也不把壳行播种成新文档。
    if (state.exists) {
      return {
        docId: paths.ownDocId(parsed.rel),
        refId: state.id,
        rel: parsed.rel,
        desc: state.desc,
        bindings: bindingsOfRef(state.id),
        missing: true,
        writable: false,
        title: '',
        summary: '',
        body: '',
        relKind: state.relKind,
        reason: state.reason,
      };
    }
    const seeded = await seed.ensureSeedForRel(parsed.rel);
    if (seeded === null) {
      return {
        docId: paths.ownDocId(parsed.rel), rel: parsed.rel, missing: true, writable: true,
        title: '', summary: '', body: '', relKind: 'empty', reason: '文档不存在',
      };
    }
    const after = await store.ownDocState(parsed.rel);
    return {
      ...outOwn(parsed.rel, seeded, 'normal'),
      ...(after.exists ? { refId: after.id, desc: after.desc, bindings: bindingsOfRef(after.id) } : {}),
    };
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
    return { docId: paths.extDocId(abs), ...meta, path: abs, missing: true, writable: true, title: '', summary: '', body: '' };
  }
  if (st.isDirectory()) {
    const files = await store.listExternalDocs([{ path: abs, exists: true, isDir: true }], { maxDepth: 3, maxFiles: 200 });
    return { docId: paths.extDocId(abs), ...meta, path: abs, dir: true, writable: false, files };
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

export async function addDoc(ctx: DocWriteCtx, opts?: { transport?: string } | null): Promise<DocWriteResult> {
  const rel = await store.writeOwnDoc(ctx.rel as string, (await bodyOf(ctx, opts)) ?? '');
  if (ctx.desc !== undefined) await store.setOwnDocDesc(rel, ctx.desc);
  const body = await store.readOwnDoc(rel);
  const summary = await seed.writeBackSummary(rel, body);
  // 落盘即登记：新文件可能正好是某宿主的约定主篇（repo/<key>/index.md 等），
  // 绑定索引跟着重建一次，别等下次双链索引才出现（#183）。
  await syncRefIndex().catch(() => null);
  const state = await store.ownDocState(rel);
  return { docId: paths.ownDocId(rel), refId: state.id, rel, desc: state.desc, bytes: Buffer.byteLength(body, 'utf8'), summary };
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
  const hit = resolveRefIdInput(ctx.ref);
  const parsed = hit
    ? (hit.externalPath ? { kind: 'external' as const, path: hit.externalPath } : { kind: 'own' as const, rel: hit.rel })
    : (paths.parseDocId(ctx.ref) as { kind: 'own'; rel: string } | { kind: 'external'; path: string });
  const body = await bodyOf(ctx, opts);
  const desc = ctx.desc === undefined ? null : String(ctx.desc ?? '').trim();
  if (body === null && desc === null) {
    throw badInput('请给 --body <正文>（多行用 --body-file <文件> 或 - 读管道）或 --desc <描述>');
  }
  // 外部绑定：登记在册 = 我的文档集，允许就地写回来源文件（闭包内校验）
  if (parsed.kind !== 'own') {
    const out = body === null
      ? { docId: paths.extDocId(parsed.path), path: parsed.path, bytes: 0, external: true }
      : await writeExternalDoc(parsed.path, body);
    if (desc !== null && hit) await store.setOwnDocDesc(hit.rel, desc);
    return { ...out, ...(hit ? { refId: hit.refId, desc: desc ?? undefined } : {}) };
  }
  if (body === null) {
    // 只改描述：不读、不写正文
    const saved = await store.setOwnDocDesc(parsed.rel, desc);
    const state = await store.ownDocState(parsed.rel);
    return { docId: paths.ownDocId(parsed.rel), refId: state.id, rel: parsed.rel, desc: saved, bytes: state.body ? Buffer.byteLength(state.body, 'utf8') : 0 };
  }
  // 不存在即创建（面板保存语义：脏页签保存不该因为别人先建了而失败，也不该在这里静默分叉出第二份）
  const rel = await store.writeOwnDoc(parsed.rel, body);
  const saved = await store.readOwnDoc(rel);
  const summary = await seed.writeBackSummary(rel, saved);
  const state = await store.ownDocState(rel);
  // desc 的优先级：显式并入参 > 已有的手写值（为空时才用摘要补，避免覆盖用户描述）
  if (desc !== null) await store.setOwnDocDesc(rel, desc);
  else if (!state.desc && summary) await store.setOwnDocDesc(rel, summary);
  const finalState = await store.ownDocState(rel);
  // 保存语义是「不存在即创建」——新出现的约定主篇要立刻进绑定索引（#183）
  await syncRefIndex().catch(() => null);
  return {
    docId: paths.ownDocId(rel),
    refId: finalState.id,
    rel,
    desc: finalState.desc,
    bytes: Buffer.byteLength(saved, 'utf8'),
    summary,
  };
}

export async function removeDoc({ ref }: { ref?: unknown } = {}): Promise<{ docId: string; rel: string }> {
  const hit = resolveRefIdInput(ref);
  const parsed = hit
    ? (hit.externalPath ? { kind: 'external' as const, path: hit.externalPath } : { kind: 'own' as const, rel: hit.rel })
    : (paths.parseDocId(ref) as { kind: 'own'; rel: string } | { kind: 'external'; path: string });
  if (parsed.kind !== 'own') throw blocked('外部绑定是只读引用，不能在这里删除');
  const rel = await store.removeOwnDoc(parsed.rel);
  // 文件没了 → 约定主篇可能整体消失，绑定要跟着重算（#183）
  await syncRefIndex().catch(() => null);
  return { docId: paths.ownDocId(rel), rel };
}

// ─── 直接 ref（v7）：desc + 归属，不涉及任何文件 / 路径 ────────────────

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
  bindings: NonNullable<DocGetResult['bindings']>;
}

/**
 * 新建一个直接 ref：`refs` 行 + 空正文 + 一条归属绑定。
 *
 * 口径（v7 / 任务 #97）：ref 是 DB 实体，没有路径 / 文件名 / 扩展名；
 * 身份就是 `refs.id`，`rel = id` 只作唯一键，任何界面都不展示。
 * 默认归属由调用方按「在哪儿点的新建」决定：单 repo / 组 / 组下的 repo。
 */
export async function createRef({ desc, owner = 'repo', repo: repoLocator, group: groupLocator }: CreateRefInput = {}): Promise<CreateRefResult> {
  const type = String(owner || 'repo') as RefOwnerType;
  if (!['repo', 'group', 'group_repo'].includes(type)) {
    throw badInput('归属类型只能是 repo / group / group_repo: ' + String(owner));
  }
  const { loadStore, deriveKey, boardKeyOf } = await reposBridge();
  const s = await loadStore();
  const board = groupLocator
    ? s.boards.find((b: any) => b.id === clean(groupLocator) || boardKeyOf(b.name) === clean(groupLocator) || String(b.name).toLowerCase() === clean(groupLocator).toLowerCase())
    : null;
  if ((type === 'group' || type === 'group_repo') && !board) {
    throw notFound('组不存在: ' + clean(groupLocator));
  }
  const repo = repoLocator
    ? s.repos.find((r: any) => r.id === clean(repoLocator) || deriveKey(r) === clean(repoLocator) || String(r.name).toLowerCase() === clean(repoLocator).toLowerCase())
    : null;
  if ((type === 'repo' || type === 'group_repo') && !repo) {
    throw notFound('仓库不存在: ' + clean(repoLocator));
  }
  const repoKey = type === 'group' ? String(boardKeyOf(board!.name)) : String(deriveKey(repo));
  const groupKey = type === 'group_repo' ? String(boardKeyOf(board!.name)) : null;
  const descText = clean(desc);
  const id = refIdFor(randomUUID());
  const at = Date.now();
  const db = getDb();
  tx(
    (conn: any) => {
      conn.run(
        `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at, "desc")
         VALUES (:id, 'md', :rel, '', 'own', '', 0, NULL, :at, :at, :desc)`,
        { id, rel: id, at, desc: descText }
      );
      // 空正文也落行：新建的是可编辑文档，不是「无正文」空壳。
      upsertRefBody(conn, { refId: id, body: '', atMs: at });
      const gk = groupKey == null ? null : groupKey;
      const pos = type === 'group_repo'
        ? 0
        : Number(
            conn.get(
              `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ref_bindings
                WHERE repo_key = :repo AND group_key IS NULL AND type = :type`,
              { repo: repoKey, type }
            )?.p ?? 0
          );
      putRefBinding(conn, { repoKey, groupKey: gk, refId: id, type, position: pos, atMs: at });
      markRefBound(conn, id);
    },
    { db, mode: 'IMMEDIATE' }
  );
  return { refId: id, docId: 'ref:' + id, desc: descText, bindings: bindingsOfRef(id) };
}

/** unbindRef 的入参：按行精确解绑（直接 ref 专用）。 */
export interface UnbindRefInput {
  ref?: unknown;
  type?: unknown;
  repo?: unknown;
  group?: unknown;
}

/**
 * 解绑一条**直接 ref** 的归属（不删 ref、不删正文）。
 * 派生绑定（ext 推出的老文档）不在这里处理——摘除仍走宿主的文档集接口。
 */
export async function unbindRef({ ref, type, repo, group }: UnbindRefInput = {}): Promise<{ refId: string; removed: number; orphan: boolean }> {
  const hit = resolveRefIdInput(ref);
  if (!hit) throw badInput('请给 refId（ref_…）');
  const row = getDb().get('SELECT id, rel FROM refs WHERE id = :id AND deleted_at IS NULL', { id: hit.refId });
  if (!row || String(row.rel) !== String(row.id)) throw blocked('只能解绑直接 ref: ' + hit.refId);
  const t = String(type || '');
  if (!['repo', 'group', 'group_repo'].includes(t)) throw badInput('归属类型只能是 repo / group / group_repo');
  const repoKey = clean(repo);
  if (!repoKey) throw badInput('缺少归属宿主（repo 或 group key）');
  const db = getDb();
  const removed = tx(
    (conn: any) => {
      const r = conn.run(
        `DELETE FROM ref_bindings
          WHERE ref_id = :ref AND type = :type AND repo_key = :repo
            AND COALESCE(group_key, '') = COALESCE(:group, '')`,
        { ref: hit.refId, type: t, repo: repoKey, group: clean(group) || null }
      );
      return Number(r.changes) || 0;
    },
    { db, mode: 'IMMEDIATE' }
  );
  const left = getDb().get('SELECT 1 AS x FROM ref_bindings WHERE ref_id = :id', { id: hit.refId });
  if (!left) getDb().run("UPDATE refs SET state = 'orphan', updated_at = :at WHERE id = :id", { at: Date.now(), id: hit.refId });
  return { refId: hit.refId, removed, orphan: !left };
}

// ─── 出参整形 ──────────────────────────────────────────────────────────

function outOwn(rel: string, body: string, relKind: RelKind = 'normal'): DocGetResult {
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
    relKind,
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
