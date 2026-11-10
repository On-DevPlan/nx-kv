// 共享任务面板容器（#164/#167）：rp-tasks 卡片框 + 头部（图标 + 标题 + 待领取计数
// + 可选附加件）+ 行列表 + 空态。group 与 dir 两页同构：列表分页由调用方
// （usePager + 底部 Pager）负责，本组件只画当前页的行——旧的「历史折叠段」
// 已被分页取代（#167 三轮验收：group 列表加分页）。
import { Icon } from '../icons.jsx';

/**
 * 任务面板。
 * @param {object} props
 * @param {string} [props.icon] 头部图标（缺省 list）
 * @param {string} props.title 面板标题（如「本组任务」/「任务」）
 * @param {number} [props.pendingCount] 待领取数（头部 chip；0 不显示）
 * @param {React.ReactNode} [props.headerExtra] 头部右侧附加件（如 dir 的「全选本页」）
 * @param {React.ReactNode} props.children 行列表（null 时显示 emptyText）
 * @param {string} [props.emptyText] 空态文案
 */
export default function TaskPanel({
  icon = 'list',
  title,
  pendingCount = 0,
  headerExtra = null,
  children = null,
  emptyText = '',
}) {
  return (
    <div className="rp-tasks">
      <div className="rp-tasks-h">
        <Icon name={icon} size={13} /> {title}
        {pendingCount > 0 && <span className="rp-chip-count">待领取 {pendingCount}</span>}
        {headerExtra}
      </div>
      {children}
      {!children && emptyText ? <div className="rp-proj-none muted">{emptyText}</div> : null}
    </div>
  );
}
