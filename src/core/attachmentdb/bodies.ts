// ref 正文（ref_bodies）的读写与条目分类。
//
// v6 起 `refs` 是文档身份 + 元数据，正文唯一真相在 `ref_bodies`（1:1，CASCADE）。
// 本模块只做三件事：
//   1. 正文 CRUD（upsert / get）；
//   2. rel ↔ id 的解析（rel 是逻辑名，id 是外键目标）；
//   3. 条目分类：normal / legacy / external / empty —— 让调用方能区分
//      「正常文档」与「历史空壳 / 外部文件镜像 / 无正文」。
//
// 分类口径（docs/decisions/2026-11-12-refs-body-in-db.md §11.1）：
//   legacy/<id>       迁移时无 locator 的历史行，只有身份、没有正文；
//   external/<hash>   外部绝对路径 / URL 的镜像行，正文在库外，不进 ref_bodies；
//   empty             其它没有正文的活动行（如盘上文件已删的历史条目）；
//   normal            有正文、且不是上面两类命名空间。
import { createHash } from 'node:crypto';

/** 一条 ref 条目的读路径类别。 */
export type RelKind = 'normal' | 'legacy' | 'external' | 'empty';

/** 一条正文记录。 */
export interface RefBodyRow {
  ref_id: string;
  body: string;
  body_bytes: number;
  body_hash: string;
  updated_at: number;
}

/** 列表用的一条 ref 条目（带正文是否存在）。 */
export interface RefDocRow {
  id: string;
  rel: string;
  origin: string;
  /** 短描述（v7）：列表 / 提示词模板的快速定位标签 */
  desc: string;
  bodyBytes: number;
  hasBody: boolean;
  relKind: RelKind;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** rel + 是否有正文 → 读路径类别。 */
export function relKindOf(rel: unknown, hasBody: boolean): RelKind {
  const r = String(rel || '');
  if (r.startsWith('legacy/')) return 'legacy';
  if (r.startsWith('external/')) return 'external';
  return hasBody ? 'normal' : 'empty';
}

/** 无正文条目的原因（给人读；docs get / 交付清单共用）。 */
export function noBodyReason(kind: RelKind): string {
  if (kind === 'legacy') return '历史索引条目：只有身份与旧地址，没有正文';
  if (kind === 'external') return '外部文件镜像：正文在库外，未入库';
  if (kind === 'empty') return '条目存在但正文缺失（文件已删除或从未入库）';
  return '';
}

/** rel 是否属于「不允许当正常文档展示」的命名空间。 */
export function isShellRel(rel: unknown): boolean {
  const r = String(rel || '');
  return r.startsWith('legacy/') || r.startsWith('external/');
}

/** 按 refs.id 取正文。 */
export function getRefBody(conn: any, refId: unknown): RefBodyRow | null {
  const row = conn.get(
    'SELECT ref_id, body, body_bytes, body_hash, updated_at FROM ref_bodies WHERE ref_id = :id',
    { id: String(refId || '') }
  );
  return row ? (row as RefBodyRow) : null;
}

/** 写正文（UPSERT），返回字节数与 sha256。body_bytes 一律按 UTF-8 计。 */
export function upsertRefBody(
  conn: any,
  { refId, body, atMs = Date.now() }: { refId: string; body: unknown; atMs?: number }
): { bytes: number; hash: string } {
  const text = String(body ?? '');
  const bytes = Buffer.byteLength(text, 'utf8');
  const hash = sha256(text);
  conn.run(
    `INSERT INTO ref_bodies (ref_id, body, body_bytes, body_hash, updated_at)
     VALUES (:id, :body, :n, :hash, :at)
     ON CONFLICT(ref_id) DO UPDATE SET
       body = excluded.body,
       body_bytes = excluded.body_bytes,
       body_hash = excluded.body_hash,
       updated_at = excluded.updated_at`,
    { id: refId, body: text, n: bytes, hash, at: atMs }
  );
  return { bytes, hash };
}

/** 按 rel 找活动行的 id（rel 是逻辑名，唯一）。 */
export function refIdByRel(conn: any, rel: unknown): string | null {
  const r = String(rel || '').trim();
  if (!r) return null;
  const row = conn.get(
    'SELECT id FROM refs WHERE rel = :rel AND deleted_at IS NULL',
    { rel: r }
  );
  return row ? String(row.id) : null;
}

/**
 * 列出 ref 条目。
 * @param includeEmpty=false 只给「有正文且非 legacy/external」的正常文档
 *        （默认口径，供导出/双链/知识聚合使用）；
 *        true 连历史空壳、外部镜像、无正文行一起给（`docs list` 用，需显式标注）。
 */
export function listRefDocs(conn: any, { includeEmpty = false }: { includeEmpty?: boolean } = {}): RefDocRow[] {
  const rows: any[] = conn.all(
    `SELECT r.id, r.rel, r.origin, r."desc", r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.deleted_at IS NULL AND r.rel <> ''
      ORDER BY r.rel`
  );
  const out: RefDocRow[] = [];
  for (const row of rows) {
    const rel = String(row.rel || '');
    const hasBody = Number(row.has_body) === 1;
    const relKind = relKindOf(rel, hasBody);
    if (!includeEmpty && (!hasBody || relKind !== 'normal')) continue;
    out.push({
      id: String(row.id),
      rel,
      origin: String(row.origin || ''),
      desc: String(row.desc || ''),
      bodyBytes: Number(row.body_bytes) || 0,
      hasBody,
      relKind,
    });
  }
  return out;
}

/** 按 rel 取条目状态（含正文）；不存在返回 null。 */
export function refDocByRel(conn: any, rel: unknown): (RefDocRow & { body: string | null }) | null {
  const r = String(rel || '').trim();
  if (!r) return null;
  const row = conn.get(
    `SELECT r.id, r.rel, r.origin, r."desc", r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
            b.body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.rel = :rel AND r.deleted_at IS NULL`,
    { rel: r }
  );
  if (!row) return null;
  const hasBody = Number(row.has_body) === 1;
  return {
    id: String(row.id),
    rel: String(row.rel),
    origin: String(row.origin || ''),
    desc: String(row.desc || ''),
    bodyBytes: Number(row.body_bytes) || 0,
    hasBody,
    relKind: relKindOf(row.rel, hasBody),
    body: hasBody ? String(row.body ?? '') : null,
  };
}

/** 按 refs.id 取条目（docs get 的 refId 寻址 / 归属查询共用）。 */
export function refDocById(conn: any, id: unknown): (RefDocRow & { body: string | null; locator: string }) | null {
  const r = String(id || '').trim();
  if (!r) return null;
  const row = conn.get(
    `SELECT r.id, r.rel, r.locator, r.origin, r."desc", r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
            b.body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.id = :id AND r.deleted_at IS NULL`,
    { id: r }
  );
  if (!row) return null;
  const hasBody = Number(row.has_body) === 1;
  return {
    id: String(row.id),
    rel: String(row.rel),
    locator: String(row.locator || ''),
    origin: String(row.origin || ''),
    desc: String(row.desc || ''),
    bodyBytes: Number(row.body_bytes) || 0,
    hasBody,
    relKind: relKindOf(row.rel, hasBody),
    body: hasBody ? String(row.body ?? '') : null,
  };
}
