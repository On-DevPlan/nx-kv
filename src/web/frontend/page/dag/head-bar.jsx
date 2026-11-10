// 编排面板头部：标题、节点计数、操作提示、组模式的队列筛选、「恢复默认布局」。
import { FILTER_ALL } from './layout.js';

export default function DagHead({ title, count, linkArmed, srcLabel, groupMode, queues, filterKey, onFilter, onReset }) {
  return (
    <div className="dagp-head">
      <span className="dagp-title">{title}</span>
      <span className="dagp-count">{count} 个待领取节点</span>
      <span className="dagp-hint">
        {linkArmed
          ? `连线中：再点目标完成 #${srcLabel} → 目标（Esc 取消）`
          : groupMode
            ? '组内全量任务；跨项目连线对 get 生效；未连线走各队列默认序'
            : '点右侧 ● 再点目标 = 有向顺序；未连线 = 无先后、走默认序'}
      </span>
      {groupMode && queues.length > 0 && (
        <span className="dagp-queues">
          <button
            type="button"
            className={'dagp-queue' + (filterKey === FILTER_ALL ? ' on' : '')}
            onClick={() => onFilter(FILTER_ALL)}
          >
            全部
            <i>{queues.reduce((s, q) => s + q.total, 0)}</i>
          </button>
          {queues.map((q) => (
            <button
              key={q.key}
              type="button"
              className={'dagp-queue' + (q.key === filterKey ? ' on' : '')}
              title={`${q.name} · ${q.count}/${q.total}`}
              onClick={() => onFilter(q.key)}
            >
              {q.name}
              <i>{q.count}</i>
            </button>
          ))}
        </span>
      )}
      {/* #153：摆位记住了（拖动即存），给一条「恢复默认布局」的退路 */}
      <button type="button" className="dagp-reset" onClick={onReset} title="清掉记住的摆位，按默认分栏重排">
        恢复默认布局
      </button>
    </div>
  );
}
