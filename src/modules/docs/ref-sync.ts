// 文档绑定 → refs / ref_bindings 的**整表重建**（#183）。
//
// 背景：文档的「归谁」有两层——
//   · ext 里的 DocRef（`repo.doc` / `repo.docLinks` / `board.doc` / `board.docLinks`
//     / `board.repoDocs`）：宿主身上挂了哪些篇，docs 域读写的就是它；
//   · 库里的 refs / ref_bindings：**索引层**，供孤儿清单、附件归属、检索用。
//
// 两层此前只在上层（ext）同步，索引层只有 bind-topics 与导入器写过一次，
// 于是「面板上明明挂着文档，库里一行绑定都没有、state 全是 orphan」——同一份
// 文档在仓库、组、组内三处各挂一遍时更是理不清。
//
// 本文件是索引层的**唯一写入方**：按 ext + 约定路径算出完整绑定集合，
// 一个事务内整表重写（幂等）。孤儿状态在收尾时按「有无绑定」重算。
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  clearRefBindings,
  ensureDocRef,
  markRefBound,
  markUnboundRefsOrphan,
  putRefBinding,
} from '../../core/attachmentdb.js';
import * as paths from './paths.js';
import * as store from './store.js';
import { reposBridge } from './repos-bridge.js';

/** 一条待写入的绑定（locator 由 DocRef 归一：自有给 rel，外部给绝对路径）。 */
interface DesiredBinding {
  repoKey: string;
  groupKey: string | null;
  type: 'repo' | 'group' | 'group_repo';
  locator: string;
  position: number;
  note: string;
}

/** syncRefIndex 的入参：调用方已有扫描结果时直接传，避免重复走盘。 */
export interface SyncRefIndexInput {
  /** docs 树里的 rel 列表（listOwnDocs 的 rel） */
  files?: string[];
  /** repos store（loadStore 的结果） */
  store?: any;
}

export interface SyncRefIndexResult {
  bindings: number;
  /** 收尾时被打回 orphan 的 ref 数 */
  orphaned: number;
}

const locatorOf = (ref: any): string => {
  if (!ref || typeof ref !== 'object') return '';
  const rel = String(ref.rel || '').trim();
  if (rel) return rel.replace(/\\/g, '/');
  const abs = String(ref.path || '').trim();
  return abs ? abs.replace(/\\/g, '/') : '';
};

/** 约定路径二选一：目录主篇优先，旧单文件回落；都不在盘上 → 空（不绑不存在的文件）。 */
function pickExisting(candidates: string[], fileSet: Set<string>): string {
  for (const rel of candidates) if (fileSet.has(rel)) return rel;
  return '';
}

/** 从 store 算出完整绑定集合（纯函数；顺序 = 主篇 → docLinks → 组内描述）。 */
export function desiredBindings(s: any, files: string[]): DesiredBinding[] {
  const fileSet = new Set((files || []).map((f) => String(f).replace(/\\/g, '/')));
  const out: DesiredBinding[] = [];
  const push = (
    repoKey: string,
    groupKey: string | null,
    type: DesiredBinding['type'],
    ref: any,
    position: number,
    note = ''
  ): void => {
    const locator = locatorOf(ref);
    if (!locator) return;
    out.push({ repoKey, groupKey, type, locator, position: Number(position) || 0, note: String(note || '') });
  };

  // ── 仓库：主篇 + 介绍文档集 ──
  for (const r of s.repos || []) {
    const key = String(r.key || '');
    if (!key || r.type === 'group') continue;
    if (r.doc) push(key, null, 'repo', r.doc, 0);
    else {
      const main = pickExisting([paths.docMainRel(paths.repoDocDirRel(key)), paths.repoDocRel(key)], fileSet);
      if (main) push(key, null, 'repo', { rel: main }, 0);
    }
    (Array.isArray(r.docLinks) ? r.docLinks : []).forEach((l: any, i: number) => {
      push(key, null, 'repo', l, i + 1, l && l.note);
    });
  }

  // ── 组：组介绍 + 组级文档 + 组内成员描述（type=group_repo）──
  for (const b of s.boards || []) {
    const gk = String(b.key || ('board/' + paths.boardSeg(b.name)) || '');
    if (!gk) continue;
    if (b.doc) push(gk, null, 'group', b.doc, 0);
    else {
      const main = pickExisting([paths.docMainRel(paths.boardDocDirRel(b.name)), paths.boardDocRel(b.name)], fileSet);
      if (main) push(gk, null, 'group', { rel: main }, 0);
    }
    (Array.isArray(b.docLinks) ? b.docLinks : []).forEach((l: any, i: number) => {
      push(gk, null, 'group', l, i + 1, l && l.note);
    });
    for (const [repoKey, ref] of Object.entries(b.repoDocs || {})) {
      push(String(repoKey), gk, 'group_repo', ref, 0, (ref as any) && (ref as any).note);
    }
    // 组内成员描述：ext 没显式登记 repoDocs 时按**约定路径**回落——
    // 与 boards/core.ts 的 noteDocRel、迁移导入器 import-json/refs.ts 同一口径。
    // 漏了这一步，整表重建会把「盘上有、只是按约定放置」的组内说明清成孤儿
    // （v6 后首次 buildIndex 就踩到：19 条 group_repo 全丢，正文还在 ref_bodies 里）。
    for (const rawKey of Array.isArray(b.repoKeys) ? b.repoKeys : []) {
      const rk = String(rawKey || '');
      if (!rk || (b.repoDocs && b.repoDocs[rk])) continue;
      const rel = pickExisting(
        [paths.docMainRel(paths.groupNoteDirRel(b.name, rk)), paths.groupNoteRel(b.name, rk)],
        fileSet
      );
      if (rel) push(rk, gk, 'group_repo', { rel }, 0);
    }
  }
  return out;
}

/**
 * 整表重建绑定索引（幂等）。调用点：
 *   · 绑定写动作之后（docs/refs 的 setDocRef / setNoteDocRef / setDocLink / addRepoDoc / removeRepoDoc）
 *   · 文档落盘/删除之后（docs/service 的 add / update / remove）
 *   · 双链索引刷新时（links.buildIndex —— 顺手把「上传就有但没登记」的本地 md 补进库）
 */
export async function syncRefIndex({ files, store: s }: SyncRefIndexInput = {}): Promise<SyncRefIndexResult> {
  let storeData = s;
  if (!storeData) {
    const { loadStore } = await reposBridge();
    storeData = await loadStore();
  }
  const rels = files || (await store.listOwnDocs()).map((f) => f.rel);
  const wanted = desiredBindings(storeData, rels);

  const db = getDb();
  return tx(
    (conn: any) => {
      clearRefBindings(conn);
      let n = 0;
      for (const b of wanted) {
        const refId = ensureDocRef(conn, { locator: b.locator });
        if (!refId) continue;
        putRefBinding(conn, {
          repoKey: b.repoKey,
          groupKey: b.groupKey,
          refId,
          type: b.type,
          position: b.position,
          note: b.note,
        });
        markRefBound(conn, refId);
        n += 1;
      }
      return { bindings: n, orphaned: markUnboundRefsOrphan(conn) };
    },
    { db, mode: 'IMMEDIATE' }
  );
}
