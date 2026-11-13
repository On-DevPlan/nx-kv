// 文档绑定 → refs / ref_bindings 的**整表重建**。
//
// v8 口径：宿主 ext（`repo.doc` / `repo.docLinks` / `board.doc` / `board.docLinks` /
// `board.repoDocs`）是**语义权威**，每条都是 DocRef{ref}（refId）；ref_bindings
// 是索引层，供文档检索、归属查询、孤儿清单使用。本文件是索引层的唯一写入方：
// 一个事务内按 ext 重写整张表（幂等），收尾时按「有无绑定」重算 orphan。
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  clearRefBindings,
  markRefBound,
  markUnboundRefsOrphan,
  putRefBinding,
} from '../../core/attachmentdb.js';
import { reposBridge } from './repos-bridge.js';

/** 一条待写入的绑定。 */
interface DesiredBinding {
  repoKey: string;
  groupKey: string | null;
  type: 'repo' | 'group' | 'group_repo';
  refId: string;
  position: number;
  note: string;
  tag: string;
}

export interface SyncRefIndexInput {
  /** repos store（loadStore 的结果）；缺省现读 */
  store?: any;
}

export interface SyncRefIndexResult {
  bindings: number;
  /** 收尾时被打回 orphan 的 ref 数 */
  orphaned: number;
}

/** 从 store 算出完整绑定集合（纯函数；顺序 = 主篇 → docLinks → 组内描述）。 */
export function desiredBindings(s: any): DesiredBinding[] {
  const out: DesiredBinding[] = [];
  const push = (
    repoKey: string,
    groupKey: string | null,
    type: DesiredBinding['type'],
    raw: any,
    position: number,
    note = '',
    tag = ''
  ): void => {
    const refId = String((raw && raw.ref) || '').trim();
    if (!refId) return;
    out.push({
      repoKey,
      groupKey,
      type,
      refId,
      position: Number(position) || 0,
      note: String((raw && raw.note) ?? note ?? ''),
      tag: String((raw && raw.tag) ?? tag ?? ''),
    });
  };

  // ── 仓库：主篇 + 介绍文档集 ──
  for (const r of s.repos || []) {
    const key = String(r.key || '');
    if (!key || r.type === 'group') continue;
    if (r.doc) push(key, null, 'repo', r.doc, 0);
    (Array.isArray(r.docLinks) ? r.docLinks : []).forEach((l: any, i: number) => {
      push(key, null, 'repo', l, i + 1);
    });
  }

  // ── 组：组介绍 + 组级文档 + 组内成员描述（type=group_repo）──
  for (const b of s.boards || []) {
    const gk = String(b.key || '');
    if (!gk) continue;
    if (b.doc) push(gk, null, 'group', b.doc, 0);
    (Array.isArray(b.docLinks) ? b.docLinks : []).forEach((l: any, i: number) => {
      push(gk, null, 'group', l, i + 1);
    });
    for (const [repoKey, ref] of Object.entries(b.repoDocs || {})) {
      push(String(repoKey), gk, 'group_repo', ref, 0);
    }
  }
  return out;
}

/**
 * 整表重建绑定索引（幂等）。调用点：
 *   · 绑定写动作之后（docs/refs 的 setDocRef / setNoteDocRef / setDocLink / addRepoDoc / removeRepoDoc）
 *   · 直接 ref 的新建 / 解绑之后（docs/service 的 createRef / unbindRef）
 *   · 文档删除之后（docs/service 的 removeDoc）
 */
export async function syncRefIndex({ store: s }: SyncRefIndexInput = {}): Promise<SyncRefIndexResult> {
  let storeData = s;
  if (!storeData) {
    const { loadStore } = await reposBridge();
    storeData = await loadStore();
  }
  const wanted = desiredBindings(storeData);

  const db = getDb();
  return tx(
    (conn: any) => {
      clearRefBindings(conn);
      let n = 0;
      for (const b of wanted) {
        const exists = conn.get('SELECT 1 AS x FROM refs WHERE id = :id AND deleted_at IS NULL', { id: b.refId });
        if (!exists) continue;
        putRefBinding(conn, {
          repoKey: b.repoKey,
          groupKey: b.groupKey,
          refId: b.refId,
          type: b.type,
          position: b.position,
          note: b.note,
          tag: b.tag,
        });
        markRefBound(conn, b.refId);
        n += 1;
      }
      return { bindings: n, orphaned: markUnboundRefsOrphan(conn) };
    },
    { db, mode: 'IMMEDIATE' }
  );
}
