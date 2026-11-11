// 归属项目（组任务）：组面板「新增任务」带 frontmatter 的草稿/任务才显示。
import { saveDoc } from '../../modules/md/doc-store.js';
import { withFrontmatter } from '../../modules/md/md-parse.js';
import type { BoardCtx, DocFm, DocState } from './task-utils.js';

interface BoardSectionProps {
  boardCtx: BoardCtx | null;
  docFm: DocFm;
  goalEditable: boolean;
  doc: DocState;
  id: string;
  markDirty: () => void;
}

export function BoardSection({ boardCtx, docFm, goalEditable, doc, id, markDirty }: BoardSectionProps) {
  if (!boardCtx) return null;
  const picked = boardCtx.members.find((m) => m.key === docFm.project);

  return (
    <div className="mdw-goal">
      <span
        className="mdw-goal-lab"
        title="归属项目（限本组成员）：决定提交进哪个项目的队列；由组面板「新增任务」创建时自动携带本组语义"
      >
        归属项目
      </span>
      {goalEditable ? (
        <select
          className="mdw-proj-pick"
          value={docFm.project || ''}
          onChange={(e) => {
            saveDoc(id, {
              body: withFrontmatter(doc.body, { ...docFm, board: boardCtx.board.id, project: e.target.value }),
            });
            markDirty();
          }}
        >
          {boardCtx.members.map((m) => (
            <option key={m.key} value={m.key}>{m.name}</option>
          ))}
        </select>
      ) : (
        <span className="mdw-proj-ro" title="归属项目（在本组创建时写入，随任务走）">
          {picked?.name || docFm.project || '—'}
        </span>
      )}
    </div>
  );
}
