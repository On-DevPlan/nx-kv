// 文档 GC（#114）：清掉「没有正文」的 ref。
//
// 口径（用户原话）：「没有正文的 ref 直接全部删除或者补充——无正文没意义」。
// 只认空正文：refs 行存在、ref_bodies 缺失或 trim 后为空；默认 dry-run，apply 才删。
// 删之前先清宿主 ext 里的引用（repo.doc / docLinks、board.doc / docLinks / repoDocs）——
// ext 是语义权威，留着悬空 refId 会让「项目介绍」看着有、实际读不到正文。
import { getDb } from '../../core/db/index.js';
import { scrubHosts } from './host-scrub.js';
import { removeOwnDoc } from './store.js';
import { syncRefIndex } from './ref-sync.js';

export interface GcEmptyDocsResult {
  status: string;
  dryRun: boolean;
  count: number;
  touchedHosts?: number;
  failed?: string[];
  ids: string[];
}

/** 找出没有正文的 ref（只读）。 */
export function emptyDocIds(): string[] {
  const rows: any[] = getDb().all(
    `SELECT r.id AS id
       FROM refs r LEFT JOIN ref_bodies rb ON rb.ref_id = r.id
      WHERE r.deleted_at IS NULL AND (rb.body IS NULL OR trim(rb.body) = '')
      ORDER BY r.id`
  );
  return rows.map((r) => String(r.id));
}

/**
 * GC 没有正文的 ref。
 * @param apply 缺省 false = 只报数（dry-run），true = 真删
 */
export async function gcEmptyDocs({ apply = false }: { apply?: unknown } = {}): Promise<GcEmptyDocsResult> {
  const ids = emptyDocIds();
  if (!apply) return { status: 'ok', dryRun: true, count: ids.length, ids };
  if (!ids.length) return { status: 'ok', dryRun: false, count: 0, ids: [] };

  const doomed = new Set(ids);
  // 宿主 ext 的清理口径与「删单篇文档」共用一份（#132 抽到 host-scrub.ts）
  const touchedHosts = await scrubHosts(doomed);

  let count = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await removeOwnDoc(id);
      count++;
    } catch {
      failed.push(id);
    }
  }
  await syncRefIndex().catch(() => null);
  return { status: 'ok', dryRun: false, count, touchedHosts, failed, ids };
}
