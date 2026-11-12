// 按归属读 ref（v7）：列表 / 提示词模板的统一读模型。
//
// ref 是 DB 实体（refs + ref_bodies + ref_bindings），没有路径概念。
// 这里只按归属查：type=repo（单仓库）/ group（组）/ group_repo（组下的仓库）。
// 主篇（position=0）才带正文——提示词只内嵌 repo 主篇，其余只给引导。
import { getDb } from '../../core/db/index.js';
import { docTitleFromMd } from '../../shared/doc-title.js';

/** 一条带归属的文档（ref_bindings JOIN refs）。 */
export interface BoundDoc {
  refId: string;
  /** 短描述（v7）：快速定位标签 */
  desc: string;
  /** 正文首行标题（没有正文时为空） */
  title: string;
  hasBody: boolean;
  origin: string;
  type: 'repo' | 'group' | 'group_repo';
  repoKey: string;
  groupKey: string | null;
  position: number;
  note: string;
  /** 只有 repo 主篇（position=0）带正文；其余保持空串 */
  body: string;
}

/**
 * 按宿主查绑定文档。
 *   repoKey  给仓库 → 该仓库自己的文档（type=repo）
 *   groupKey 给组   → 该组的组级文档（type=group）；同时给 repoKey 时，
 *                     再带上「这个仓库在该组的组内文档」（type=group_repo）
 */
export function boundDocs({ repoKey = '', groupKey = '' }: { repoKey?: string; groupKey?: string } = {}): BoundDoc[] {
  const repo = String(repoKey || '').trim();
  const group = String(groupKey || '').trim();
  if (!repo && !group) return [];
  const rows: any[] = getDb().all(
    `SELECT b.type, b.repo_key, b.group_key, b.position, b.note,
            r.id AS ref_id, r."desc", r.origin,
            CASE WHEN rb.ref_id IS NULL THEN 0 ELSE 1 END AS has_body,
            rb.body
       FROM ref_bindings b JOIN refs r ON r.id = b.ref_id
       LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
      WHERE r.deleted_at IS NULL AND (
        (:repo <> '' AND b.type = 'repo' AND b.repo_key = :repo)
        OR (:group <> '' AND b.type = 'group' AND b.repo_key = :group)
        OR (:repo <> '' AND :group <> '' AND b.type = 'group_repo' AND b.repo_key = :repo AND b.group_key = :group)
      )
      ORDER BY CASE b.type WHEN 'repo' THEN 0 WHEN 'group' THEN 1 ELSE 2 END,
               b.position, b.rowid`,
    { repo, group }
  );
  return rows.map((x: any) => {
    const type = String(x.type) as BoundDoc['type'];
    const position = Number(x.position) || 0;
    const hasBody = Number(x.has_body) === 1 || String(x.origin) === 'external';
    const rawBody = hasBody ? String(x.body ?? '') : '';
    // 正文只随 repo 主篇返回（提示词只内嵌这一篇）；其余只给标题 / desc。
    const body = type === 'repo' && position === 0 ? rawBody : '';
    return {
      refId: String(x.ref_id),
      desc: String(x.desc || ''),
      title: rawBody ? docTitleFromMd(rawBody) : '',
      hasBody,
      origin: String(x.origin || ''),
      type,
      repoKey: String(x.repo_key || ''),
      groupKey: x.group_key == null ? null : String(x.group_key),
      position,
      note: String(x.note || ''),
      body,
    };
  });
}
