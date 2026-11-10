// 任务面板页的**共享外壳**（#169）：项目组页与目录（dir）任务页共用同一份结构。
//
// 为什么抽组件：两页此前各写各的容器类名（.rp-page / .rp-group-head 各写一遍），
// 背景、内距、间距靠 CSS 巧合对齐——一处改了另一处就漂（用户验收：「两个页面的
// 背景色不一致，复用组件呀」）。现在**结构与样式同源**：一个组件一份 DOM，
// 两页只传数据（名字 / 计数 chips / 工具区 / 内容）。
//
// 结构：rp-page 容器 → rp-group-head（h2：图标 + 名字 + 计数 chips；右侧动作区
// 右对齐）→ 内容。动作区由调用方传入（ToolActsBar），组件只管摆位。
import { Icon } from '../icons.jsx';

/**
 * @param {object} props
 * @param {string} props.name 页面主体名（组名 / 目录名）
 * @param {Array<{text:string}|string>} [props.counts] 头部计数 chips（字符串或 {text}）
 * @param {string} [props.icon] 名字前的图标（缺省 folder）
 * @param {React.ReactNode} [props.actions] 右侧动作区（工具区）
 * @param {React.ReactNode} props.children 页面内容
 */
export default function PageShell({ name, counts = [], icon = 'folder', actions = null, children }) {
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
      {children}
    </div>
  );
}
