// 关系描述（组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库）= **参考仓库上的一篇文档**。
//
// #134：描述不再挂在「关系」上（group_refs.note / ext_linked[].note），
// 也不再用弹窗编辑——它**完全归档**到右侧栏的文档列表：
// 这条关系对应这个参考仓库的一篇文档，定位靠 ref_bindings.tag
// （`link-note:<关系 key>`），所以同一关系恒定对应同一篇，重复写只是改内容。
//
// 为什么不用 note 列：note 是关系边上的一个字符串，改它只能靠「关系专属弹窗」，
// 于是同一条知识被拆成两处（文档库 ↔ 关系列），面板上还要多一个入口。
// 归档成文档后：只有文档库一个真相，编辑走现成的文档编辑器，
// 参考仓库的「文档列表」就是它的档案柜。
import { randomUUID } from 'node:crypto';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { upsertRefBody } from '../../core/attachmentdb.js';
import { refIdFor } from '../../core/attachmentdb/ids.js';
import { notFound } from '../../core/errors.js';
import * as store from './store.js';
import { reposBridge } from './repos-bridge.js';
import { syncRefIndex } from './ref-sync.js';

/** 关系描述的作用域：组级（组内共享）或仓库级（绑在某个开发仓库上）。 */
export interface LinkNoteScope {
  kind: 'board' | 'repo';
  /** 组 key 或开发仓库 key（关系标识） */
  key: string;
  /** 组名 / 仓库名（写进文档短标签） */
  name: string;
}

/** 定位标签前缀（ref_bindings.tag）。 */
export const LINK_NOTE_TAG_PREFIX = 'link-note:';

/** 关系 → 定位标签。 */
export function linkNoteTagOf(scope: LinkNoteScope): string {
  return LINK_NOTE_TAG_PREFIX + String(scope.key || '');
}

/** 关系 → 文档短标签（列表里一眼看出「这是哪条关系的描述」）。 */
export function linkNoteDescOf(scope: LinkNoteScope): string {
  return scope.kind === 'board'
    ? `在组「${scope.name}」里参考什么`
    : `在仓库「${scope.name}」里参考什么`;
}

/** 按关系标签找这篇文档（没有 → 空串）。 */
export function findLinkNoteDoc(refKey: string, scope: LinkNoteScope): string {
  const row = getDb().get(
    `SELECT b.ref_id AS refId FROM ref_bindings b
      WHERE b.type = 'repo' AND b.repo_key = :refKey AND b.tag = :tag`,
    { refKey: String(refKey || ''), tag: linkNoteTagOf(scope) },
  );
  return row ? String(row.refId || '') : '';
}

/** 这篇描述文档的正文（没有 → 空串）。 */
export async function linkNoteBodyOf(refKey: string, scope: LinkNoteScope): Promise<string> {
  const refId = findLinkNoteDoc(refKey, scope);
  if (!refId) return '';
  try {
    return await store.readOwnDoc(refId);
  } catch {
    return '';
  }
}

/**
 * 这条关系下**所有**参考仓库的描述正文（refKey → 正文）。
 *
 * 面板与交付上下文要显示「这个参考在本组里参考什么」时用它——描述已经不在
 * 关系边上了（在文档里），但只读展示仍要有出处。
 */
export async function linkNoteBodiesOf(scope: LinkNoteScope): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const rows = getDb().all(
    `SELECT repo_key AS repoKey, ref_id AS refId FROM ref_bindings
      WHERE type = 'repo' AND tag = :tag`,
    { tag: linkNoteTagOf(scope) },
  );
  for (const r of rows) {
    try {
      out.set(String(r.repoKey || ''), await store.readOwnDoc(String(r.refId || '')));
    } catch {
      /* 正文缺失（已删）→ 跳过 */
    }
  }
  return out;
}

/** 从宿主 ext 的文档集里摘掉这篇（再由 syncRefIndex 重算绑定索引）。 */
async function detachFromHost(refKey: string, refId: string): Promise<void> {
  const { mutateStore, deriveKey } = await reposBridge();
  await mutateStore((s: any) => {
    const r = (s.repos || []).find((x: any) => deriveKey(x) === String(refKey || ''));
    if (!r) return;
    if (Array.isArray(r.docLinks)) {
      r.docLinks = r.docLinks.filter((l: any) => !(l && l.ref === refId));
    }
    if (r.doc && r.doc.ref === refId) delete r.doc;
  });
}

/** 删掉这篇描述文档（连宿主绑定与正文一起清）。 */
export async function removeLinkNoteDoc(refKey: string, scope: LinkNoteScope): Promise<boolean> {
  const refId = findLinkNoteDoc(refKey, scope);
  if (!refId) return false;
  await detachFromHost(refKey, refId);
  try {
    await store.removeOwnDoc(refId);
  } catch {
    /* 已被删（幂等） */
  }
  await syncRefIndex();
  return true;
}

/**
 * 写关系描述：建一篇文档挂到这个参考仓库上，或改已有那篇。
 *
 * 文本留空 = 清除（删掉这篇文档）。
 */
export async function setLinkNoteDoc({ refKey, scope, text }: {
  refKey: string;
  scope: LinkNoteScope;
  text?: unknown;
}): Promise<{ refId: string; desc: string; body: string; created: boolean; removed: boolean }> {
  const key = String(refKey || '').trim();
  if (!key) throw notFound('参考仓库 key 为空');
  const body = String(text ?? '').trim();
  const desc = linkNoteDescOf(scope);
  const tag = linkNoteTagOf(scope);

  const existing = findLinkNoteDoc(key, scope);
  if (existing) {
    if (!body) {
      const removed = await removeLinkNoteDoc(key, scope);
      return { refId: '', desc, body: '', created: false, removed };
    }
    await store.writeOwnDoc(existing, body);
    await store.setOwnDocDesc(existing, desc);
    return { refId: existing, desc, body, created: false, removed: false };
  }
  if (!body) return { refId: '', desc, body: '', created: false, removed: false };

  // 新建：refs 行 + 正文（ref_bodies 是正文唯一真相）→ 挂到宿主文档集（附加篇，带 tag）
  const refId = refIdFor(randomUUID());
  const at = Date.now();
  const db = getDb();
  tx(
    (conn: any) => {
      conn.run(
        `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at, origin, body_bytes, "desc")
         VALUES (:id, 'md', '', '', 0, NULL, :at, :at, 'own', 0, :desc)`,
        { id: refId, at, desc },
      );
      upsertRefBody(conn, { refId, body, atMs: at });
    },
    { db, mode: 'IMMEDIATE' },
  );

  const { mutateStore, deriveKey } = await reposBridge();
  await mutateStore((s: any) => {
    const r = (s.repos || []).find((x: any) => deriveKey(x) === key);
    if (!r) throw notFound('参考仓库不存在: ' + key);
    if (!Array.isArray(r.docLinks)) r.docLinks = [];
    // 附加篇（不是主篇）：主篇是「项目介绍」，关系描述不抢那个位置
    r.docLinks.push({ ref: refId, tag, note: '' });
  });
  await syncRefIndex();
  return { refId, desc, body, created: true, removed: false };
}
