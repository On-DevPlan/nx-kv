// 任务面板页的**整页布局组件**（#170）：项目组页与目录（dir）任务页共用。
//
// 用户口径：「路由还是各自路由，指的 ui 样式统一，布局完全抽离出组件复用」——
// 两页的**路由与数据语义各自保留**（组页 = 多条成员 topic 的视图，目录页 = 一条
// topic 的视图），但**排布骨架必须同源**：否则两页各写一遍容器/间距/块序，
// 改一处另一处就漂（「仍然不一致」的根因）。
//
// 骨架（块序固定，间距由 rp-page 的 flex gap 统一）：
//
//   rp-page
//     ├ rp-group-head   头部：h2（图标 + 名字 + 计数 chips）+ 右对齐动作区
//     ├ intro           简介槽（组介绍 / 项目介绍）
//     ├ batch           批量条槽（多选操作；没有就不占位）
//     ├ list            任务列表槽（TaskPanel）
//     └ footer          页脚槽（翻页条）
//
// 各页只往槽里放自己的内容与动作，**不自己写布局**。
import type { ReactNode } from 'react';
import { Icon } from '../icons.jsx';

/** 头部计数 chip：两页的组装方式不同，允许纯文本或 `{text}`。 */
export type TaskPanelCount = string | { text?: string };

// 槽位一律 ReactNode 可选：默认值 `= null` 会把 prop 推断成 `null`，
// 调用方就只能 `as unknown as` 桥接（第一波在 page/dir、page/group 里正是这么写的）。
export interface TaskPanelLayoutProps {
  name: string;
  counts?: TaskPanelCount[];
  icon?: string;
  actions?: ReactNode;
  intro?: ReactNode;
  batch?: ReactNode;
  list?: ReactNode;
  footer?: ReactNode;
  extra?: ReactNode;
}

/**
 * @param {object} props
 * @param {string} props.name 页面主体名（组名 / 目录名）
 * @param {Array<{text:string}|string>} [props.counts] 头部计数 chips
 * @param {string} [props.icon] 名字前的图标（缺省 folder）
 * @param {React.ReactNode} [props.actions] 头部右侧动作区（工具区）
 * @param {React.ReactNode} [props.intro] 简介槽
 * @param {React.ReactNode} [props.batch] 批量条槽
 * @param {React.ReactNode} [props.list] 任务列表槽
 * @param {React.ReactNode} [props.footer] 页脚槽（翻页条）
 * @param {React.ReactNode} [props.extra] 额外内容（骨架之外的零散块）
 */
export default function TaskPanelLayout({
  name,
  counts = [],
  icon = 'folder',
  actions = null,
  intro = null,
  batch = null,
  list = null,
  footer = null,
  extra = null,
}: TaskPanelLayoutProps) {
  return (
    <div className="rp-page">
      <div className="rp-group-head">
        <h2>
          <Icon name={icon} size={15} /> {name}
          {counts.map((c, i) => {
            const text = typeof c === 'string' ? c : (c && c.text) || '';
            return text ? (
              <span className="rp-chip-count" key={i}>{text}</span>
            ) : null;
          })}
        </h2>
        {actions ? <div className="rp-group-acts">{actions}</div> : null}
      </div>
      {intro}
      {batch}
      {list}
      {footer}
      {extra}
    </div>
  );
}
