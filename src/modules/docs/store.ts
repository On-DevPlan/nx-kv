// 文档存储原语：自有文档 CRUD（DB 唯一真相）+ 外部绑定闭包。
//
// **自有文档**（v6 + DOCS_DIR 收口）：正文唯一真相在 `ref_bodies`，身份是 `refs.id`。
// v8 起没有 rel / 路径：读写入口一律按 refId。
// `~/.nx-kv/docs/` 不再是文档镜像，只是 mdfile 默认附件目录。
// **外部绑定**：refs.locator 是绝对路径 / URL（origin='external'），只读引用——
// 「绑定闭包」= 全部外部 locator 的集合，外部读取只允许落在闭包内：
// 少了这道闸，`docs get path:D:\任意文件` 就成了任意文件读入口。
//
// 本文件不含业务语义（不认识宿主绑定模型，也不认识 action）。
import { join } from 'node:path';
import fsp from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { extDocId, ownDocId } from './paths.js';
import { notFound } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  docKindOf,
  ensureDocRef,
  forgetDocRef,
  getRefBody,
  listRefDocs,
  noBodyReason,
  refDocById,
  syncRefAttachments,
  upsertRefBody,
} from '../../core/attachmentdb.js';
import type { DocKind } from '../../core/attachmentdb.js';

/** 自有文档的一行（正文可能不在库内：历史空壳 / 外部镜像 / 无正文）。 */
export interface OwnDocRow {
  /** refs.id（ref 的稳定地址） */
  id: string;
  /** 外部文件/URL 的实际位置；自有直接 ref 为空串 */
  locator: string;
  /** 短描述（v7）：列表 / 提示词模板的快速定位标签 */
  desc: string;
  size: number;
  /** 正文 md5（列表默认口径需要；没有正文时缺省） */
  md5?: string;
  body?: string;
  hasBody: boolean;
  origin: string;
  kind: DocKind;
}

/** 自有文档的读状态（docs get / 交付清单区分「无正文」用）。 */
export interface OwnDocState {
  /** refs.id（ref 的稳定地址） */
  id: string;
  locator: string;
  exists: boolean;
  hasBody: boolean;
  body: string | null;
  kind: DocKind;
  origin: string;
  reason: string;
  /** 短描述（v7） */
  desc: string;
}

/** 外部绑定闭包条目（externalClosure 产出）。 */
export interface ClosureEntry {
  path: string;
  /** 登记来源（refId） */
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
  const rows = listRefDocs(getDb(), { includeEmpty });
  return rows.map((r) => {
    const body = r.hasBody ? String(getRefBody(getDb(), r.id)?.body ?? '') : undefined;
    return {
      id: r.id,
      locator: r.locator,
      desc: r.desc,
      size: r.bodyBytes,
      hasBody: r.hasBody,
      origin: r.origin,
      kind: r.kind,
      ...(body === undefined
        ? {}
        : { body, md5: createHash('md5').update(body, 'utf8').digest('hex') }),
    };
  });
}

/** 自有文档是否有正文（v6 起存在性 = ref_bodies 有行）。 */
export async function ownDocExists(refId: string): Promise<boolean> {
  return !!getDb().get(
    `SELECT 1 AS x FROM refs r JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.id = :id AND r.deleted_at IS NULL`,
    { id: String(refId || '') }
  );
}

/** 自有文档的完整读状态（区分 normal / legacy / external / empty）。 */
export async function ownDocState(refId: string): Promise<OwnDocState> {
  const row = refDocById(getDb(), refId);
  if (!row) {
    return {
      id: String(refId || ''), locator: '', exists: false, hasBody: false, body: null,
      kind: 'empty', origin: '', reason: '文档不存在', desc: '',
    };
  }
  return {
    id: row.id,
    locator: row.locator,
    exists: true,
    hasBody: row.hasBody,
    body: row.body,
    kind: row.kind,
    origin: row.origin,
    reason: row.hasBody ? '' : noBodyReason(row.kind),
    desc: row.desc,
  };
}

/** 读自有文档正文（utf8）。没有正文 / 不存在抛 notFound。 */
export async function readOwnDoc(refId: string): Promise<string> {
  const row = refDocById(getDb(), refId);
  if (!row || !row.hasBody) throw notFound('文档不存在或没有正文: ' + String(refId || ''));
  return String(row.body ?? '');
}

/**
 * 写自有文档：正文进 ref_bodies（唯一真相）。磁盘不落任何副本。
 * refId 必须已存在（新建直接 ref 走 docs/ref 的 createRef）。
 */
export async function writeOwnDoc(refId: string, body: unknown): Promise<string> {
  const id = String(refId || '').trim();
  if (!refDocById(getDb(), id)) throw notFound('文档不存在: ' + id);
  const text = String(body ?? '');
  const db = getDb();
  tx(
    (conn) => {
      upsertRefBody(conn, { refId: id, body: text });
      // 正文里用到的资源立刻进 ref_attach：不论从 CLI、面板还是别的模块写入，
      // 都在这个唯一入口同步，避免「有的入口写了关系、有的没写」。
      syncRefAttachments(conn, { refId: id, text });
    },
    { db, mode: 'IMMEDIATE' }
  );
  return id;
}

/**
 * 改短描述（v7）：只动 refs."desc"，不碰正文。
 * ref 是 DB 实体，desc 是列表 / 提示词模板的快速定位标签。
 */
export async function setOwnDocDesc(refId: string, desc: unknown): Promise<string> {
  const id = String(refId || '').trim();
  const text = String(desc ?? '').trim();
  const r = getDb().run(
    'UPDATE refs SET "desc" = :desc, updated_at = :at WHERE id = :id AND deleted_at IS NULL',
    { desc: text, at: Date.now(), id }
  );
  if (!Number(r.changes)) throw notFound('文档不存在: ' + id);
  return text;
}

/** 删自有文档（DB 行）。没有正文条目抛 notFound。 */
export async function removeOwnDoc(refId: string): Promise<string> {
  const id = String(refId || '').trim();
  const db = getDb();
  // 文档删除 = refs 行删除（ref_bodies / ref_bindings / ref_attach 由 FK CASCADE 跟着走），
  // 它引用过的资源因此变成可列出的孤儿，交给 file orphans / prune 回收。
  const removed = tx((conn) => forgetDocRef(conn, id), { db, mode: 'IMMEDIATE' });
  if (!removed) throw notFound('文档不存在: ' + id);
  return id;
}

// ─── 外部绑定闭包 ──────────────────────────────────────────────────────

/**
 * 全部已登记的外部位置：refs 里 origin='external'（且 locator 非空）的行。
 * 返回 [{ path, owner, exists, isDir }]——isDir/exists 现场探测，
 * 不存在的路径保留在列表里（读取侧动态标 missing）。
 */
export async function externalClosure(_store?: unknown): Promise<ClosureEntry[]> {
  const rows: any[] = getDb().all(
    "SELECT id, locator FROM refs WHERE origin = 'external' AND locator <> '' AND deleted_at IS NULL ORDER BY locator"
  );
  const list: ClosureEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const p = String(row.locator || '').trim();
    if (!p) continue;
    const k = p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ path: p, owner: String(row.id || ''), exists: false, isDir: false });
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

export { ownDocId, docKindOf, ensureDocRef };
