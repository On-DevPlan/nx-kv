// 绑定描述（组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库）= **参考仓库文档列表里的一篇文档**。
//
// #137：原来这套机制靠 `ref_bindings.tag = link-note:<关系 key>` 定位「这条关系的那一篇」，
// 那其实是把**分类标签**（一个没有入口、没人用的无效概念）当成了定位器。
// 现在定位回归它本来的样子：**desc 就在 ref 上**——
//   同一条关系 = 该参考仓库文档列表里 desc 等于「在组「X」里参考什么」的那一篇；
//   找不到就是还没写过；写一次即创建，再写即改同一篇。
//
// 关键口径：
//   · 描述的**短标签（desc）由系统生成**（关系 + 「参考什么」），用户可在面板里改；
//     改了就等于换了一条关系（新的短标签 → 新的一篇）——可接受的代价：
//     关系描述本来就是「一句给人看的话」，不是机器主键；
//   · 描述的**全文（body）**是用户写的内容（多行、含关键路径/搜索词），
//     长文本走 `--body-file`；
//   · 关系本身不再有专门的存储：绑定关系在 `group_refs` / `ext_linked` 上，
//     描述在文档里，两者靠「宿主 + desc」对上。
//
// 单独成文件的原因：ref.ts 已在行数门禁的上限上，绑定描述这套逻辑独立成块
// （校验关系存在 → 写文档），拆出去两边都清爽。
import * as service from './service.js';
import { loadRef, boardKeyInside, repoKeyInside } from './ref.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';

/** setLinkNote 的返回：写组级带 group、写仓库级带 repo。 */
export interface SetLinkNoteResult {
  key: string;
  name: string;
  group?: string;
  repo?: string;
  note: string;
  /** 描述落成的文档（refId / docId） */
  refId?: string;
  docId?: string;
}

/** setLinkNote 的参数。 */
export interface SetLinkNoteInput {
  id?: unknown;
  key?: unknown;
  repo?: unknown;
  board?: unknown;
  note?: unknown;
}

/** 关系描述的短标签（desc）：系统生成，形如「在组「csharp」里参考什么」。 */
export function relationDescOf(scope: { kind: 'board' | 'repo'; name: string }): string {
  return scope.kind === 'board'
    ? `在组「${scope.name}」里参考什么`
    : `在仓库「${scope.name}」里参考什么`;
}

/** 这条关系对应的描述文档（按 desc 找；没有 → 空串）。 */
export function findRelationDoc(refKey: string, scope: { kind: 'board' | 'repo'; name: string }): string {
  const desc = relationDescOf(scope);
  const row = getDb().get(
    `SELECT b.ref_id AS refId
       FROM ref_bindings b
       JOIN refs r ON r.id = b.ref_id AND r.deleted_at IS NULL
      WHERE b.type = 'repo' AND b.repo_key = :refKey AND r."desc" = :desc
      ORDER BY b.position, b.rowid
      LIMIT 1`,
    { refKey: String(refKey || ''), desc },
  );
  return row ? String(row.refId || '') : '';
}

/**
 * 绑定描述：这条绑定「参考什么」。note 留空 = 清除。
 *   --board b  写组级绑定（组 ↔ 参考仓库）的描述
 *   --repo x   写仓库级绑定（开发仓库 ↔ 参考仓库）的描述
 * 两者只能选一个（一条绑定一条描述）；目标关系不存在时显式报错。
 *
 * 关系必须真实存在——描述得挂在一条存在的关系上；描述本身落成**文档**
 * （该参考仓库文档列表里的一篇，desc 由系统生成）。
 */
export async function setLinkNote({ id, key, repo, board, note }: SetLinkNoteInput = {}): Promise<SetLinkNoteResult> {
  const ref = await loadRef(id || key);
  if (!repo && !board) throw badInput('请给 --repo <开发仓库> 或 --board <看板>');
  if (repo && board) throw badInput('--repo 与 --board 只能选一个（一条绑定一条描述）');
  const text = String(note || '').trim();

  const s = await service.loadStore();
  const r = s.repos.find((x) => x.id === ref.id)!;
  const refKey = service.deriveKey(r);

  let scope: { kind: 'board' | 'repo'; key: string; name: string };
  let relation: { group?: string; repo?: string };
  if (board) {
    const bkey = boardKeyInside(s, board);
    if (!bkey) throw notFound('看板不存在: ' + board);
    const b = s.boards.find((x) => service.storedBoardKey(x) === bkey)!;
    const link = (b.refs || []).find((l) => l.id === refKey);
    if (!link) {
      throw conflict(`「${ref.name}」未绑定到组「${b.name}」—— 先 repo bind ${ref.id} --board ${bkey}`);
    }
    scope = { kind: 'board', key: bkey, name: b.name };
    relation = { group: b.name };
  } else {
    const rkey = repoKeyInside(s, repo);
    if (!rkey) throw notFound('绑定的开发仓库不存在: ' + repo);
    const dev = s.repos.find((x) => service.deriveKey(x) === rkey)!;
    if ((dev.type || 'dev') === 'ref') {
      throw badInput(`「${dev.name}」是参考仓库 —— 仓库级绑定描述只挂在开发仓库上`);
    }
    const link = (dev.linked || []).find((l) => l && l.kind === 'ref' && String(l.id) === refKey);
    if (!link) {
      throw conflict(`「${ref.name}」未直接绑定到仓库「${dev.name}」—— 先 repo bind ${ref.id} --repo ${rkey}`);
    }
    scope = { kind: 'repo', key: rkey, name: dev.name };
    relation = { repo: dev.name };
  }

  // docs 域用**动态 import**（模块之间不静态互依，见 docs/repos-bridge 的同款约定）
  const { setDocLinkDoc } = await import('../docs/refs.js');
  const desc = relationDescOf(scope);
  const out = text
    ? await setDocLinkDoc({ repoKey: refKey, desc, body: text })
    : { refId: findRelationDoc(refKey, scope), desc, created: false };

  // 留空 = 清除：删掉那篇描述文档（正文与归属一起清）
  if (!text && out.refId) {
    const { removeDoc } = await import('../docs/service.js');
    await removeDoc({ ref: out.refId }).catch(() => null);
  }

  return {
    key: refKey,
    name: r.name,
    ...relation,
    note: text,
    refId: text ? out.refId : '',
    docId: text && out.refId ? `ref:${out.refId}` : '',
  };
}
