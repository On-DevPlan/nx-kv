// 归属项目（组任务）：组面板「新增任务」带 frontmatter 的草稿/任务才显示。
import { saveDoc } from '../../modules/md/doc-store.js';
import type { BoardCtx, DocFm, DocState } from './task-utils.js';
import { rememberGroupProject } from '../group/group-project-memo.js';

interface BoardSectionProps {
  boardCtx: BoardCtx | null;
  docFm: DocFm;
  /** 归属项目是否可改：草稿 / 待领取 / 草稿态 plan 都能改（已领取 / 已完成先 reopen） */
  projectEditable: boolean;
  doc: DocState;
  id: string;
  markDirty: () => void;
}

export function BoardSection({ boardCtx, docFm, projectEditable, id, markDirty }: BoardSectionProps) {
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
      {projectEditable ? (
        <select
          className="mdw-proj-pick"
          value={docFm.project || ''}
          onChange={(e) => {
            // #187：记住这次选择——下次在这个组里新建任务直接用它当默认归属
            rememberGroupProject(boardCtx.board.id, e.target.value);
            // #197：归属存成草稿的结构化字段，正文不再带 frontmatter
            saveDoc(id, { projectKey: e.target.value, boardKey: String(boardCtx.board.id) });
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
