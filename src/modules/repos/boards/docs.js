// 组内描述（board note）：描述 = 文档，写 group/<组>/<key>.md；repoNotes 只是摘要影子。
import {
  loadStore,
  storedBoardKey,
  boardRepoKeys,
  deriveKey,
  normalizeKey,
} from '../service.js';
import { badInput, notFound, conflict } from '../../../core/errors.js';
import { findBoardIn, repoKeyIn } from './core.js';

/** 组内描述写进 group/<组>/<key>.md（覆盖正文；空文本 = 只留标题，摘要自然为空）。 */
async function writeGroupNoteDoc(info, text) {
  const { groupNoteRel } = await import('../../docs/paths.js');
  const store = await import('../../docs/store.js');
  const { writeBackSummary } = await import('../../docs/seed.js');
  const rel = groupNoteRel(info.boardName, info.key);
  const head = `# ${info.boardName} · ${info.name}`;
  const body = text ? `${head}\n\n${text}\n` : `${head}\n`;
  await store.writeOwnDoc(rel, body);
  await writeBackSummary(rel, body); // 摘要回填 repoNotes（列表读的那份影子）
  return rel;
}

/**
 * 设置组内描述：key = 仓库（id / key / 路径 / 名称 均可），board = 看板。
 * 只对**已在板内**的成员有意义——不是成员就显式报错，别静默挂到没人读的地方。
 * note 为空 = 清除。
 */
export async function setBoardRepoNote({ id, key, board, note } = {}) {
  const locator = key || id;
  if (!locator) throw badInput('缺少仓库 id 或 key');
  if (!board) throw badInput('缺少看板 id');
  const s = await loadStore();
  // 占位成员（本地未拥有）也允许写描述——描述挂在 key 上，clone 补齐后自动生效
  const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
  const b = findBoardIn(s, board);
  if (!b) throw notFound('看板不存在: ' + board);
  if (!boardRepoKeys(b, s).includes(rkey)) {
    throw conflict(`仓库「${rkey}」不在看板「${b.name}」里——组内描述只对成员有意义`);
  }
  const text = String(note || '').trim();
  const info = {
    key: rkey,
    name: (s.repos.find((x) => deriveKey(x) === rkey) || {}).name || rkey,
    board: b.id,
    boardKey: storedBoardKey(b),
    boardName: b.name,
  };
  // 描述 = 文档：写 group/<组>/<key>.md；repoNotes 只是摘要影子（由回写维护）
  await writeGroupNoteDoc(info, text);
  return { ...info, note: text };
}
