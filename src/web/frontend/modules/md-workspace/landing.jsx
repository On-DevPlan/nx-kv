// 目录落地页：没打开具体页面时主区显示页面列表（不全屏进编辑器）。
// 点列表行 → 该页以新页签进入工作台；「＋ 新建页」→ 新草稿页签。
import { titleFromMd } from './md-parse.js';

export default function Landing({ isGlobal, tasks = [], onNew, onOpenTask }) {
  return (
    <div className="mdw-land">
      <div className="mdw-land-acts">
        <button type="button" className="btn sm primary" onClick={onNew}>＋ 新建页</button>
        <span className="mdw-land-count">{tasks.length} 页</span>
      </div>
      <div className="mdw-land-list">
        {tasks.map((t) => (
          <button key={t.id} type="button" className="mdw-land-row" onClick={() => onOpenTask(t.id)}>
            <span className="no">#{t.id}</span>
            <span className="tx">{titleFromMd(t.text)}</span>
            <span className={'st' + (t.status === 'consumed' ? ' done' : t.from ? ' run' : '')}>
              {t.status === 'consumed' ? '完' : (t.from ? '跑' : '等')}
            </span>
          </button>
        ))}
        {!tasks.length && (
          <div className="mdw-land-empty">
            还没有页面：点「＋ 新建页」写第一篇，或让 agent 往{isGlobal ? '全局池' : '这个目录'}投递任务。
          </div>
        )}
      </div>
    </div>
  );
}
