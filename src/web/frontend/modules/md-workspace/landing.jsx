// 目录落地页 = 当前目录的**子任务表**（表格，不是列表）。
//
// 为什么是表格：一个目录下的任务要看的是「编号 / 标题 / 状态 / 什么时候建、什么时候被领走」
// ——这些是**列**，列表把它们压成一行就丢了。现在点目录行进工作台，落地页就是这张表。
// 点表行 → 该任务以新页签进入工作台；「＋ 新建页」→ 新草稿页签；
// 行尾悬停出「✕」：删除该任务（软删除，CLI restore 可恢复）——完成的任务清得掉。
import { Icon } from '../../components/icons.jsx';
import { titleFromMd } from './md-parse.js';

// 时间戳（后端给的是 'YYYY-MM-DD HH:mm:ss'）→ 只留到分钟
function shortTime(v) {
  const s = String(v || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1].slice(5)} ${m[2]}` : s.slice(0, 16);
}

export default function Landing({ isGlobal, tasks = [], onNew, onOpenTask, onDeleteTask, onTplMenu, onImport }) {
  return (
    <div className="mdw-land">
      <div className="mdw-land-acts">
        <button type="button" className="btn sm primary" onClick={onNew}>＋ 新建页</button>
        <button
          type="button"
          className="btn ghost sm"
          title="按模板新建一页（管理模板在侧边栏设置里）"
          aria-haspopup="menu"
          onClick={(e) => onTplMenu?.(e)}
        >
          模板 ▾
        </button>
        {onImport && (
          <button type="button" className="btn ghost sm" title="把一个 .md 文件导入成任务" onClick={onImport}>
            导入
          </button>
        )}
        <span className="mdw-land-count">{tasks.length} 个任务</span>
      </div>

      <div className="mdw-land-table-wrap">
        <table className="mdw-land-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '56px' }}>#</th>
              <th scope="col">任务</th>
              <th scope="col" style={{ width: '74px' }}>状态</th>
              <th scope="col" style={{ width: '116px' }}>创建</th>
              <th scope="col" style={{ width: '116px' }}>领取</th>
              <th scope="col" style={{ width: '40px' }} />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id} className="mdw-land-tr" onClick={() => onOpenTask(t.id)}>
                <td className="mono faint">#{t.id}</td>
                <td className="tx">{titleFromMd(t.text)}</td>
                <td>
                  <span className={'st' + (t.status === 'consumed' ? ' done' : t.from ? ' run' : '')}>
                    {t.status === 'consumed' ? '完' : (t.from ? '跑' : '等')}
                  </span>
                </td>
                <td className="mono faint">{shortTime(t.createdAt)}</td>
                <td className="mono faint">{t.consumedAt ? shortTime(t.consumedAt) : '—'}</td>
                <td className="act">
                  {onDeleteTask && (
                    <span
                      className="del" role="button" tabIndex={-1}
                      title="删除此任务（软删除，CLI 可恢复）"
                      aria-label={`删除 ${titleFromMd(t.text)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask(t);
                      }}
                    >
                      <Icon name="x" size={12} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!tasks.length && (
              <tr>
                <td colSpan="6">
                  <div className="mdw-land-empty">
                    还没有页面：点「＋ 新建页」写第一篇，或让 agent 往{isGlobal ? '全局池' : '这个目录'}投递任务。
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
