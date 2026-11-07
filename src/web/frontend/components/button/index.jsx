// 统一按钮组件（#91，2026-11-07）——全局按钮规范的**组件出口**。
//
// 规范：文字按钮统一高 28px、字号 12px（CSS 层由 style.css 的 .btn 基类保证，
// 即使页面还没换成 <Button>，视觉也已是同一套尺寸）。形态三分类：
//
//   primary    主按钮：实色块。**一个页面只能出现一个**——由使用约定保证，
//              页面里第二颗想强调的按钮请降级 secondary。
//   secondary  次级按钮：浅底（.btn.ghost），表格行、工具栏里的默认形态。
//   DropdownButton 下拉按钮：文字右侧带向下箭头，hover 展开菜单。
//
// 现状（迁移口径）：全库还有 ~30 个文件用裸 `<button className="btn ...">`，
// 一次性替换 300+ 处风险过大；设置页（任务点名的重灾区）已换成本组件，
// 其余页面靠 CSS 统一尺寸，后续按页面渐进迁移。图标按钮（.iconbtn 26×26）、
// 开关（.toggle）不属于这三分类，不走本组件。
import { useState } from 'react';
import './style.css';

const VARIANT_CLASS = { primary: '', secondary: 'ghost' };

/**
 * 统一按钮。
 * @param {object} props
 * @param {'primary'|'secondary'} [props.variant='secondary'] 形态；danger 另加
 * @param {boolean} [props.danger] 破坏性操作（描边红）
 * @param {boolean} [props.small] 紧凑水平内边距（高/字号不降）
 * @param {string} [props.className] 追加 class（排在规范 class 之后）
 */
export function Button({
  variant = 'secondary',
  danger = false,
  small = false,
  className = '',
  type = 'button',
  children,
  ...rest
}) {
  const cls = ['btn'];
  const vc = VARIANT_CLASS[variant] ?? 'ghost';
  if (vc) cls.push(vc);
  if (danger) cls.push('danger');
  if (small) cls.push('small');
  if (className) cls.push(className);
  return (
    <button type={type} className={cls.join(' ')} {...rest}>
      {children}
    </button>
  );
}

/**
 * 下拉按钮：文字 + 右侧向下箭头，hover 展开菜单（纯 CSS :hover，无 portal）。
 * 菜单贴按钮右缘展开；空间不足的场景由调用方用 dropUp 翻转。
 *
 * @param {object} props
 * @param {string} props.label 按钮文字
 * @param {Array<{key:string,label:string}>} props.items 菜单项（空数组时不渲染箭头菜单，退化为普通按钮）
 * @param {(key: string) => void} props.onSelect 点选菜单项
 * @param {'primary'|'secondary'} [props.variant='secondary']
 */
export function DropdownButton({ label, items = [], onSelect, variant = 'secondary', className = '', ...rest }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={'nx-btn-dd' + (open ? ' open' : '') + (className ? ' ' + className : '')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Button variant={variant} className="nx-btn-dd-main" aria-haspopup="menu" aria-expanded={open} {...rest}>
        {label}
        <span className="nx-btn-dd-arrow" aria-hidden="true">▾</span>
      </Button>
      {items.length > 0 && open && (
        <span className="nx-btn-dd-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className="nx-btn-dd-item"
              onClick={() => { setOpen(false); onSelect && onSelect(it.key); }}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default Button;
