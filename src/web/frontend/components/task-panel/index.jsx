// 共享任务面板容器（#164）：rp-tasks 卡片框 + 头部计数 + 行列表 + 可选历史折叠段。
//
// 以组面板的「本组任务」为准抽出的外壳：group 页传 pending + history 两段；
// dir 任务页只传当前页的行（children，不拆段——分页语义由容器页负责），
// 全选入口走 headerExtra。
import { Icon } from '../icons.jsx';

/**
 * 任务面板。
 * @param {object} props
 * @param {string} [props.icon] 头部图标（缺省 list）
 * @param {string} props.title 面板标题（如「本组任务」/「任务」）
 * @param {number} [props.pendingCount] 待领取数（头部 chip，0 也显示——与组面板现状一致）
 * @param {number} [props.historyCount] 历史数（>0 才出 chip 与折叠段）
 * @param {React.ReactNode} [props.headerExtra] 头部右侧附加件（如「全选本页」）
 * @param {boolean} [props.historyOpen] 历史段展开态
 * @param {Function} [props.onToggleHistory] 折叠开关
 * @param {React.ReactNode} props.children 行列表（null 时显示 emptyText）
 * @param {string} [props.emptyText] 空态文案
 * @param {React.ReactNode} [props.history] 历史段行（展开时渲染）
 */
export default function TaskPanel({
  icon = 'list',
  title,
  pendingCount = 0,
  historyCount = 0,
  headerExtra = null,
  historyOpen = false,
  onToggleHistory,
  children = null,
  emptyText = '',
  history = null,
}) {
  return (
    <div className="rp-tasks">
      <div className="rp-tasks-h">
        <Icon name={icon} size={13} /> {title}
        <span className="rp-chip-count">{pendingCount} 待领取</span>
        {historyCount > 0 && <span className="rp-chip-count">已领取 {historyCount}</span>}
        {headerExtra}
      </div>
      {children}
      {!children && emptyText ? <div className="rp-proj-none muted">{emptyText}</div> : null}
      {historyCount > 0 && (
        <>
          <button type="button" className="rp-done-toggle" onClick={onToggleHistory}>
            <span className={'tri' + (historyOpen ? ' open' : '')}>▸</span> 已领取 {historyCount}
          </button>
          {historyOpen && history}
        </>
      )}
    </div>
  );
}
