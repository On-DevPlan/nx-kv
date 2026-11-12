// 文档存储原语：自有文档 CRUD（DB 唯一真相）+ 外部绑定闭包。
//
// **自有文档**（v6 + DOCS_DIR 收口）：正文唯一真相在 `ref_bodies`，`refs.rel` 是逻辑名。
// `~/.nx-kv/docs/`（见 core/paths 的 mdfile 默认目录函数）**不再是文档镜像**，只是 mdfile 默认附件目录；
// 读入口只认 DB，写入口只写 DB。
// **外部绑定**：repos.json 里登记的外部绝对路径（文件或目录），只读引用——
// 「绑定闭包」= 全部外部路径的集合，外部读取只允许落在闭包内：
// 少了这道闸，`docs get path:D:\任意文件` 就成了任意文件读入口。
//
// 本文件不含业务语义（不认识 DocRef 之外的绑定模型，也不认识 action）。
import { join } from 'node:path';
import fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertOwnedRel, assertDocRel, ownDocId, extDocId } from './paths.js';
import { notFound } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  ensureDocRef,
  forgetDocRef,
  noBodyReason,
  refDocByRel,
  relKindOf,
  syncRefAttachments,
  upsertRefBody,
} from '../../core/attachmentdb.js';
import type { RelKind } from '../../core/attachmentdb.js';

/** 自有文档的一行（正文可能不在库内：历史空壳 / 外部镜像 / 无正文）。 */
export interface OwnDocRow {
  rel: string;
  size: number;
  /** 正文 md5（列表默认口径需要；没有正文时缺省） */
  md5?: string;
  body?: string;
  hasBody: boolean;
  origin: string;
  relKind: RelKind;
}

/** 介绍目录内的文档（listOwnDocsIn 产出，rel 相对自有树根）。 */
export interface OwnDocRowIn extends OwnDocRow {
  name: string;
}

/** 自有文档的读状态（docs get / 交付清单区分「无正文」用）。 */
export interface OwnDocState {
  rel: string;
  exists: boolean;
  hasBody: boolean;
  body: string | null;
  relKind: RelKind;
  origin: string;
  reason: string;
}

/** 外部绑定闭包条目（externalClosure 产出）。 */
export interface ClosureEntry {
  path: string;
  /** 登记来源（'repo/<name>' / 'board/<name>[/<repoKey>]'） */
  owner?: string;
  exists: boolean;
  isDir: boolean;
}

// 外部目录枚举的跳过名单（Obsidian vault 里也有 .obsidian / node_modules 这类噪音）
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', 'dist', 'build', '__pycache__', '.venv']);

// ─── 自有文档 CRUD（v6：DB 唯一真相，不落盘）───────────────────────────

/**
 * 自有文档列表。默认只给「有正文且非 legacy/external」的正常文档
 * （导出 / 双链 / 知识聚合的口径）；`includeEmpty: true` 连历史空壳、
 * 外部镜像、无正文行一起给（`docs list` 用，调用方必须显式标注）。
 */
export async function listOwnDocs({ includeEmpty = false }: { includeEmpty?: boolean } = {}): Promise<OwnDocRow[]> {
  const db = getDb();
  const rows: any[] = db.all(
    `SELECT r.rel, r.origin, r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
            b.body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.deleted_at IS NULL AND r.rel <> ''
      ORDER BY r.rel`
  );
  const out: OwnDocRow[] = [];
  for (const row of rows) {
    const rel = String(row.rel || '');
    const hasBody = Number(row.has_body) === 1;
    const relKind = relKindOf(rel, hasBody);
    if (!includeEmpty && (!hasBody || relKind !== 'normal')) continue;
    const body = hasBody ? String(row.body ?? '') : undefined;
    out.push({
      rel,
      size: Number(row.body_bytes) || 0,
      hasBody,
      origin: String(row.origin || ''),
      relKind,
      ...(body === undefined
        ? {}
        : { body, md5: createHash('md5').update(body, 'utf8').digest('hex') }),
    });
  }
  return out;
}

/** 自有文档是否有正文（v6 起存在性 = ref_bodies 有行）。 */
export async function ownDocExists(rel: string): Promise<boolean> {
  const norm = assertDocRel(rel);
  const row = getDb().get(
    `SELECT 1 AS x FROM refs r JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.rel = :rel AND r.deleted_at IS NULL`,
    { rel: norm }
  );
  return !!row;
}

/** 自有文档的完整读状态（区分 normal / legacy / external / empty）。 */
export async function ownDocState(rel: string): Promise<OwnDocState> {
  const norm = assertDocRel(rel);
  const row = refDocByRel(getDb(), norm);
  if (!row) {
    return {
      rel: norm, exists: false, hasBody: false, body: null,
      relKind: 'empty', origin: '', reason: '文档不存在',
    };
  }
  return {
    rel: norm,
    exists: true,
    hasBody: row.hasBody,
    body: row.body,
    relKind: row.relKind,
    origin: row.origin,
    reason: row.hasBody ? '' : noBodyReason(row.relKind),
  };
}

/** 读自有文档正文（utf8）。没有正文 / 不存在抛 notFound。 */
export async function readOwnDoc(rel: string): Promise<string> {
  const norm = assertDocRel(rel);
  const row = getDb().get(
    `SELECT b.body AS body FROM refs r JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.rel = :rel AND r.deleted_at IS NULL`,
    { rel: norm }
  );
  if (!row) throw notFound('文档不存在: ' + norm);
  return String(row.body ?? '');
}

/**
 * 写自有文档：正文进 ref_bodies（唯一真相）。磁盘不落任何副本。
 * 返回归一化 rel，调用方应使用返回值。
 */
export async function writeOwnDoc(rel: string, body: unknown): Promise<string> {
  const norm = assertOwnedRel(rel);
  const text = String(body ?? '');
  const db = getDb();
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { rel: norm });
      if (!refId) return;
      upsertRefBody(conn, { refId, body: text });
      // 正文里用到的资源立刻进 ref_attach：不论从 CLI、面板还是别的模块写入，
      // 都在这个唯一入口同步，避免「有的入口写了关系、有的没写」。
      syncRefAttachments(conn, { refId, text });
    },
    { db, mode: 'IMMEDIATE' }
  );
  return norm;
}

/** 删自有文档（DB 行）。没有正文条目抛 notFound。 */
export async function removeOwnDoc(rel: string): Promise<string> {
  const norm = assertOwnedRel(rel);
  const db = getDb();
  // 文档删除 = refs 行删除（ref_bodies / ref_bindings / ref_attach 由 FK CASCADE 跟着走），
  // 它引用过的资源因此变成可列出的孤儿，交给 file orphans / prune 回收。
  const removed = tx((conn) => forgetDocRef(conn, norm), { db, mode: 'IMMEDIATE' });
  if (!removed) throw notFound('文档不存在: ' + norm);
  return norm;
}

// ─── 外部绑定闭包 ──────────────────────────────────────────────────────

/**
 * 全部已登记的外部路径（repos.json 里能扫到的每一处 DocRef）。
 * 返回 [{ path, owner, exists, isDir }]——isDir/exists 现场探测，
 * 不存在的路径保留在列表里（读取侧动态标 missing，导入侧标待初始化）。
 */
export async function externalClosure(store: any): Promise<ClosureEntry[]> {
  const list: ClosureEntry[] = [];
  const seen = new Set<string>();
  const addRef = (ref: unknown, owner: string): void => {
    const p = ref && typeof ref === 'object' ? String((ref as { path?: unknown }).path || '').trim() : '';
    if (!p) return;
    const k = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) return;
    seen.add(k);
    // exists/isDir 稍后统一现场探测，这里先占位
    list.push({ path: p, owner, exists: false, isDir: false });
  };
  for (const r of store.repos || []) addRef(r.doc, 'repo/' + (r.name || r.id));
  for (const r of store.repos || []) for (const l of Array.isArray(r.docLinks) ? r.docLinks : []) addRef(l, 'repo/' + (r.name || r.id));
  for (const b of store.boards || []) {
    addRef(b.doc, 'board/' + b.name);
    for (const l of Array.isArray(b.docLinks) ? b.docLinks : []) addRef(l, 'board/' + b.name);
    for (const [rkey, ref] of Object.entries(b.repoDocs || {})) addRef(ref, 'board/' + b.name + '/' + rkey);
  }
  for (const item of list) {
    let st: Stats | null = null;
    try {
      st = await fsp.stat(item.path);
    } catch {
      /* 缺失：保留，标记不存在 */
    }
    item.exists = !!st;
    item.isDir = st ? st.isDirectory() : false;
  }
  return list;
}

const normAbs = (p: unknown): string => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * 校验外部路径是否落在绑定闭包内（精确命中，或闭包内某目录的前缀）。
 * 命中返回实际绝对路径；闭包外返回 null——调用方一律拒绝。
 */
export function resolveExternal(absPath: string, closure: readonly ClosureEntry[]): string | null {
  const want = normAbs(absPath);
  if (!want) return null;
  for (const item of closure) {
    const base = normAbs(item.path);
    if (!base) continue;
    if (want === base) return absPath;
    if (item.isDir && want.startsWith(base + '/')) return absPath;
  }
  return null;
}

/**
 * 枚举外部文档：单文件绑定 = 文件本身；目录绑定 = 递归 .md（限深 maxDepth、总量 maxFiles）。
 * 返回绝对路径数组（保持稳定排序）。
 */
export async function listExternalDocs(
  closure: readonly ClosureEntry[],
  { maxDepth = 3, maxFiles = 200 }: { maxDepth?: number; maxFiles?: number } = {}
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string): void => {
    const k = normAbs(abs);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(abs);
  };
  for (const item of closure) {
    if (!item.exists) continue;
    if (!item.isDir) {
      if (/\.md$/i.test(item.path)) push(item.path);
      continue;
    }
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (out.length >= maxFiles || depth > maxDepth) return;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (out.length >= maxFiles) return;
        const abs = join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          await walk(abs, depth + 1);
        } else if (e.isFile() && /\.md$/i.test(e.name)) {
          push(abs);
        }
      }
    };
    await walk(item.path, 1);
  }
  return out;
}

/** 外部路径的 docId（调用方必须先用 resolveExternal 校验过闭包内） */
export function externalDocId(abs: string): string {
  return extDocId(abs);
}

export { ownDocId };

/**
 * 某个目录下的文档（介绍目录用）：[{ rel, abs, size }]，rel 相对**自有树根**。
 * 只取该目录直属与其子目录（reference/ 等）的 .md。
 */
export async function listOwnDocsIn(dirRel: string): Promise<OwnDocRowIn[]> {
  const prefix = String(dirRel || '').split('\\').join('/').replace(/\/+$/, '') + '/';
  const out: OwnDocRowIn[] = [];
  for (const d of await listOwnDocs()) {
    if (!d.rel.startsWith(prefix)) continue;
    out.push({ ...d, name: d.rel.slice(prefix.length) });
  }
  return out;
}
