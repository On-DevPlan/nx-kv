// 组内描述（board note）：描述 = 文档，绑定在 ref_bindings(type=group_repo)；
// repoNotes 只是列表用的一句话摘要（保存时同步）。
import {
  loadStore,
  storedBoardKey,
  boardRepoKeys,
  deriveKey,
  mutateStore,
  normalizeKey,
} from '../service.js';
import { badInput, notFound, conflict } from '../../../core/errors.js';
import { findBoardIn, repoKeyIn } from './core.js';
import type { BoardEntry, Store } from '../repo/rows.js';

/** setBoardRepoNote 的返回。 */
export interface SetBoardRepoNoteResult {
  key: string;
  name: string;
  board: string;
  boardKey: string;
  boardName: string;
  note: string;
  refId: string;
}

/** setBoardRepoNote 的参数。 */
export interface SetBoardRepoNoteInput {
  id?: unknown;
  key?: unknown;
  board?: unknown;
  note?: unknown;
}

/**
 * 设置组内描述：key = 仓库（id / key / 路径 / 名称 均可），board = 看板。
 * 只对**已在板内**的成员有意义——不是成员就显式报错，别静默挂到没人读的地方。
 * note 为空 = 清除（解绑文档）。
 */
export async function setBoardRepoNote({ id, key, board, note }: SetBoardRepoNoteInput = {}): Promise<SetBoardRepoNoteResult> {
  const locator = key || id;
  if (!locator) throw badInput('缺少仓库 id 或 key');
  if (!board) throw badInput('缺少看板 id');
  const s: Store = await loadStore();
  // 占位成员（本地未拥有）也允许写描述——描述挂在 key 上，clone 补齐后自动生效
  const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
  const b: BoardEntry | null = findBoardIn(s, board);
  if (!b) throw notFound('看板不存在: ' + board);
  if (!boardRepoKeys(b, s).includes(rkey)) {
    throw conflict(`仓库「${rkey}」不在看板「${b.name}」里——组内描述只对成员有意义`);
  }
  const text = String(note || '').trim();
  const found = s.repos.find((x) => deriveKey(x) === rkey);
  const name = (found && found.name) || rkey;
  const info = {
    key: rkey,
    name,
    board: b.id,
    boardKey: storedBoardKey(b),
    boardName: b.name,
  };

  const { createRef, updateDoc } = await import('../../docs/service.js');
  const { unbindRef } = await import('../../docs/service.js');
  const body = text ? `# ${b.name} · ${name}\n\n${text}\n` : '';
  let refId = String((b.repoDocs || {})[rkey]?.ref || '');
  if (!text) {
    if (refId) {
      await unbindRef({ ref: refId, type: 'group_repo', repo: rkey, group: storedBoardKey(b) });
    }
    await mutateStore((draft) => {
      const target = findBoardIn(draft, board);
      if (target) {
        if (target.repoNotes) delete target.repoNotes[rkey];
        if (target.repoDocs) delete target.repoDocs[rkey];
      }
    });
    return { ...info, note: '', refId: '' };
  }

  if (!refId) {
    const created = await createRef({ owner: 'group_repo', repo: rkey, group: b.id });
    refId = created.refId;
  }
  await updateDoc({ ref: 'ref:' + refId, body });
  await mutateStore((draft) => {
    const target = findBoardIn(draft, board);
    if (!target) return;
    if (!target.repoNotes) target.repoNotes = {};
    target.repoNotes[rkey] = text.slice(0, 120);
  });
  return { ...info, note: text, refId };
}
