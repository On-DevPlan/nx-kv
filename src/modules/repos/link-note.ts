// 绑定描述（组 ↔ 参考仓库 / 开发仓库 ↔ 参考仓库）——#134：归档成**文档**。
//
// 描述不再写在关系边上（group_refs.note / ext_linked[].note），也不再有专属弹窗：
// 它是这个参考仓库的一篇文档（ref_bindings.tag = `link-note:<关系 key>`），
// 在右侧栏的「<参考仓库名> · 文档列表」里可见可编辑。
//
// 单独成文件的原因：ref.ts 已在行数门禁的上限上，绑定描述这套逻辑独立成块
// （校验关系存在 → 写文档），拆出去两边都清爽。
import * as service from './service.js';
import { loadRef, boardKeyInside, repoKeyInside } from './ref.js';
import { badInput, notFound, conflict } from '../../core/errors.js';

/** setLinkNote 的返回：写组级带 group、写仓库级带 repo。 */
export interface SetLinkNoteResult {
  key: string;
  name: string;
  group?: string;
  repo?: string;
  note: string;
  /** #134：描述落成的文档（refId / docId）；清除时为空 */
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

/**
 * 绑定描述：这条绑定「参考什么」。note 留空 = 清除。
 *   --board b  写组级绑定（组 ↔ 参考仓库）的描述
 *   --repo x   写仓库级绑定（开发仓库 ↔ 参考仓库）的描述
 * 两者只能选一个（一条绑定一条描述）；目标关系不存在时显式报错。
 *
 * 关系必须真实存在——描述得挂在一条存在的关系上；描述本身则落成文档。
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
  const { setLinkNoteDoc } = await import('../docs/link-note.js');
  const out = await setLinkNoteDoc({ refKey, scope, text });

  // 关系边上的 note 同步写一份（**冗余副本**）：导出/导入要把它带走（备份不能丢描述），
  // 而面板与交付上下文读的是文档（真身）。文档为准，副本只服务导出。
  await service.mutateStore((d: any) => {
    const dr = d.repos.find((x: any) => service.deriveKey(x) === refKey);
    if (!dr) return;
    if (scope.kind === 'board') {
      const db = d.boards.find((x: any) => service.storedBoardKey(x) === scope.key);
      const link = db && (db.refs || []).find((l: any) => l.id === refKey);
      if (!link) return;
      if (text) link.note = text;
      else delete link.note;
      return;
    }
    const dev = d.repos.find((x: any) => service.deriveKey(x) === scope.key);
    const link = dev && (dev.linked || []).find((l: any) => l && l.kind === 'ref' && String(l.id) === refKey);
    if (!link) return;
    if (text) link.note = text;
    else delete link.note;
  });

  return {
    key: refKey,
    name: r.name,
    ...relation,
    note: text,
    refId: out.refId,
    docId: out.refId ? `ref:${out.refId}` : '',
  };
}
