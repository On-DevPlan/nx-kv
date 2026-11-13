// ref 正文（ref_bodies）的读写与条目分类。
//
// v6 起 `refs` 是文档身份 + 元数据，正文唯一真相在 `ref_bodies`（1:1，CASCADE）。
// v8 起 ref 没有 rel：地址只有 `id`（DB 身份）与 `locator`（外部实际位置）。
// 本模块只做三件事：
//   1. 正文 CRUD（upsert / get）；
//   2. 按 id / locator 取条目；
//   3. 条目分类：normal / legacy / external / empty —— 让调用方能区分
//      「正常文档」与「历史空壳 / 外部文件镜像 / 无正文」。
//
// 分类口径：origin='external' 是外部镜像；没有正文的 import 行是历史索引；
// 其余没有正文的活动行是 empty；有正文且非外部 = normal。
import { createHash } from 'node:crypto';

/** 一条 ref 条目的读路径类别。 */
export type DocKind = 'normal' | 'legacy' | 'external' | 'empty';

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
  /** 外部文件 / URL 的实际位置；自有直接 ref 为空串 */
  locator: string;
  origin: string;
  /** 短描述（v7）：列表 / 提示词模板的快速定位标签 */
  desc: string;
  bodyBytes: number;
  hasBody: boolean;
  kind: DocKind;
}

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** origin + 是否有正文 → 读路径类别。 */
export function docKindOf(origin: unknown, hasBody: boolean): DocKind {
  if (String(origin || '') === 'external') return 'external';
  if (hasBody) return 'normal';
  return String(origin || '') === 'import' ? 'legacy' : 'empty';
}

/** 无正文条目的原因（给人读；docs get / 交付清单共用）。 */
export function noBodyReason(kind: DocKind): string {
  if (kind === 'legacy') return '历史索引条目：只有身份，没有正文';
  if (kind === 'external') return '外部文件镜像：正文在库外，未入库';
  if (kind === 'empty') return '条目存在但正文缺失（文件已删除或从未入库）';
  return '';
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
  // refs.body_bytes 是**正文大小的缓存列**（列表页读它，免得拖着正文跑）。
  // 它必须跟着正文一起改，否则「写完再列」看到的还是旧大小。
  conn.run('UPDATE refs SET body_bytes = :n WHERE id = :id', { id: refId, n: bytes });
  return { bytes, hash };
}

/**
 * 列出 ref 条目。
 * @param includeEmpty=false 只给「有正文且非 legacy/external」的正常文档
 *        （默认口径，供导出/双链/知识聚合使用）；
 *        true 连历史空壳、外部镜像、无正文行一起给（`docs list` 用，需显式标注）。
 */
export function listRefDocs(conn: any, { includeEmpty = false }: { includeEmpty?: boolean } = {}): RefDocRow[] {
  const rows: any[] = conn.all(
    `SELECT r.id, r.locator, r.origin, r."desc", r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.deleted_at IS NULL
      ORDER BY r.updated_at DESC, r.id`
  );
  const out: RefDocRow[] = [];
  for (const row of rows) {
    const origin = String(row.origin || '');
    const hasBody = Number(row.has_body) === 1;
    const kind = docKindOf(origin, hasBody);
    if (!includeEmpty && (!hasBody || kind !== 'normal')) continue;
    out.push({
      id: String(row.id),
      locator: String(row.locator || ''),
      origin,
      desc: String(row.desc || ''),
      bodyBytes: Number(row.body_bytes) || 0,
      hasBody,
      kind,
    });
  }
  return out;
}

/** 按 refs.id 取条目状态（含正文）；不存在返回 null。 */
export function refDocById(conn: any, id: unknown): (RefDocRow & { body: string | null }) | null {
  const r = String(id || '').trim();
  if (!r) return null;
  const row = conn.get(
    `SELECT r.id, r.locator, r.origin, r."desc", r.body_bytes,
            CASE WHEN b.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
            b.body
       FROM refs r
       LEFT JOIN ref_bodies b ON b.ref_id = r.id
      WHERE r.id = :id AND r.deleted_at IS NULL`,
    { id: r }
  );
  if (!row) return null;
  const hasBody = Number(row.has_body) === 1;
  const origin = String(row.origin || '');
  return {
    id: String(row.id),
    locator: String(row.locator || ''),
    origin,
    desc: String(row.desc || ''),
    bodyBytes: Number(row.body_bytes) || 0,
    hasBody,
    kind: docKindOf(origin, hasBody),
    body: hasBody ? String(row.body ?? '') : null,
  };
}

/** 按 locator（外部绝对路径 / URL）取条目；用于外部绑定闭包与导入核对。 */
export function refDocByLocator(conn: any, locator: unknown): (RefDocRow & { body: string | null }) | null {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return null;
  const row = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL ORDER BY id LIMIT 1',
    { loc }
  );
  return row ? refDocById(conn, row.id) : null;
}
