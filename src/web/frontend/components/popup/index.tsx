// 弹窗原语（全站唯一出处）：Modal（模态卡）· useDialog（确认/输入，Promise 风格）
// · PopMenu（坐标菜单）· RowMenu（锚定下拉）· useDismiss（关闭行为钩子）。
//
// 视觉统一在 .pp-*（style.css）；此前散在各处的 .dlg / .modal（两套互斥定义）/
// .mdw-sheet / .gmenu 全部收编到这里。约定延续自 vanilla 版：无 emoji、
// 不用浏览器原生弹窗（alert/confirm/prompt 一律页内实现）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../icons.jsx';
import { useDismiss } from './dismiss.js';
import './style.css';

// ---- 模态卡：全站唯一模态外壳（迁移确认 / 成员选择 / 快捷键 / diff 查看……） ----

/** 卡宽档位：460 / 540 / 880 / 1180（宽表用 wide）。 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'wide';

/** Modal 入参。 */
export interface ModalProps {
  /** 标题（字符串或节点） */
  title?: ReactNode;
  /** 关闭回调；不给则不渲染 × 且 Esc/点外不关（配合 busy） */
  onClose?: (() => void) | null;
  /** true 时禁关（异步提交中） */
  busy?: boolean;
  /** 卡宽：460 / 540 / 880 / 1180（宽表用 wide） */
  size?: ModalSize;
  /** 底部按钮区；不给则不渲染脚条 */
  footer?: ReactNode;
  /** 追加到卡片（如 rp-mp-box 的宽覆盖） */
  className?: string;
  children?: ReactNode;
}

// 当前在场的模态栈（模块级）：只有栈顶那张响应 Esc。
const modalStack: symbol[] = [];

/**
 * @param {object} p
 * @param {React.ReactNode} p.title       标题（字符串或节点）
 * @param {Function} [p.onClose]          关闭回调；不给则不渲染 × 且 Esc/点外不关（配合 busy）
 * @param {boolean} [p.busy]              true 时禁关（异步提交中）
 * @param {'sm'|'md'|'lg'|'wide'} [p.size]  卡宽：460 / 540 / 880 / 1180（宽表用 wide）
 * @param {React.ReactNode} [p.footer]    底部按钮区；不给则不渲染脚条
 * @param {string} [p.className]          追加到卡片（如 rp-mp-box 的宽覆盖）
 */
export function Modal({ title, onClose, busy = false, size = 'md', footer = null, className = '', children }: ModalProps) {
  const closable = !!onClose && !busy;
  // 弹窗栈：弹窗里再开弹窗是常态（参考仓库里点「绑定…」「克隆…」），
  // Esc 只该关**最上面那层**——否则一次 Esc 把下面整层一起关掉，
  // 用户以为只是退出了绑定框，回来发现整个参考面板也没了。
  const idRef = useRef<symbol | null>(null);
  if (!idRef.current) idRef.current = Symbol('modal');
  // 本实例的栈标识（挂载即固定）：effect 里入栈/出栈与 isTop 都用它
  const id = idRef.current;
  const isTop = useCallback(() => modalStack[modalStack.length - 1] === id, [id]);
  useEffect(() => {
    modalStack.push(id);   // 挂载即入栈；父子同时在场时后挂载的在栈顶
    return () => {
      const at = modalStack.indexOf(id);
      if (at >= 0) modalStack.splice(at, 1);
    };
  }, [id]);
  const dismiss = useCallback(() => { if (isTop()) onClose?.(); }, [onClose, isTop]);
  useDismiss({ onDismiss: dismiss, enabled: closable });
  return (
    <div
      className="pp-back"
      onMouseDown={(e) => { if (closable && e.target === e.currentTarget) onClose?.(); }}
    >
      <div className={`pp-card pp-${size}${className ? ' ' + className : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="pp-head">
          <span className="pp-title">{title}</span>
          {onClose && (
            <button
              type="button"
              className="pp-x"
              aria-label="关闭"
              disabled={busy}
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        <div className="pp-body">{children}</div>
        {footer ? <div className="pp-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---- 对话框：确认 / 输入（Promise 风格，对应 vanilla 版 dialog()） ----
// 单输入回 string；双输入（tagInput）回 { value, tag }；取消/点外/Esc 一律回 null。

/** dialog() 的入参（字段按调用处出现）。 */
export interface DialogOptions {
  title?: ReactNode;
  message?: ReactNode;
  input?: boolean;
  tagInput?: boolean;
  placeholder?: string;
  value?: string;
  tagPlaceholder?: string;
  tagValue?: string;
  danger?: boolean;
  okText?: string;
}

/** 一次对话的在场状态（选项 + resolve）。 */
interface DialogState extends DialogOptions {
  resolve: (val: unknown) => void;
}

/** dialog() 的调用面：确定/取消都回 Promise（取消为 null）。 */
export type DialogFn = (opts?: DialogOptions) => Promise<unknown>;

/** useDialog 的返回面。 */
export interface DialogApi {
  dialog: DialogFn;
  node: ReactNode;
}

export function useDialog(): DialogApi {
  const [state, setState] = useState<DialogState | null>(null); // {resolve, ...opts}
  // 用 ref 读输入框，而不是 document.querySelector('.dlg-input')——
  // 后者绕开 React 直接摸 DOM，页面上有第二个同名类名时就会读错。
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tagRef = useRef<HTMLInputElement | null>(null);

  const close = useCallback((val: unknown) => {
    setState((s) => { if (s && s.resolve) s.resolve(val); return null; });
  }, []);

  const dialog = useCallback<DialogFn>((opts = {}) => new Promise((resolve) => {
    setState({ ...opts, resolve });
  }), []);

  // 双输入（input + tagInput）：确定/Enter 回 `{ value, tag }`；
  // 单输入沿用旧口径回 string——既有调用方（只给 input:true 的）完全不受影响。
  const collect = (): { value: string; tag: string } | string | null => {
    if (state?.tagInput) {
      return { value: inputRef.current?.value.trim() ?? '', tag: tagRef.current?.value.trim() ?? '' };
    }
    return inputRef.current?.value.trim() ?? null;
  };

  const node = state ? (
    <div className="pp-back pp-dlg" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <div className="pp-card pp-sm" role="dialog" aria-modal="true">
        <div className="pp-body">
          {state.title ? <div className="pp-dlg-title">{state.title}</div> : null}
          {state.message ? <div className="pp-dlg-msg">{state.message}</div> : null}
          {state.input ? (
            <input
              ref={inputRef}
              className="pp-input"
              autoFocus
              spellCheck="false"
              placeholder={state.placeholder || ''}
              defaultValue={state.value || ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') close(collect());
                if (e.key === 'Escape') close(null);
              }}
            />
          ) : null}
          {state.input && state.tagInput ? (
            <input
              ref={tagRef}
              className="pp-input"
              spellCheck="false"
              placeholder={state.tagPlaceholder || '标签（可选，如 qa）'}
              defaultValue={state.tagValue || ''}
              onKeyDown={(e) => {
                if (e.key === 'Enter') close(collect());
                if (e.key === 'Escape') close(null);
              }}
            />
          ) : null}
          <div className="pp-acts">
            <button className="btn ghost" onClick={() => close(null)}>取消</button>
            <button
              className={'btn' + (state.danger ? ' danger' : '')}
              onClick={() => close(state.input ? collect() : true)}
            >
              {state.okText || '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { dialog, node };
}

// ---- 坐标菜单（右键 / 「⋯」触发的浮层菜单） ----
// 点外可关、Esc 可关；打开时焦点进第一项、↑↓ 在项间走、
// 关闭时归还触发元素焦点（原型设计稿 §6 可访问性底线）。

/** 坐标菜单的一项（`'sep'` 是分隔线）。 */
export type PopMenuItem =
  | 'sep'
  | { label: ReactNode; icon?: string; danger?: boolean; onClick?: () => void };

/** PopMenu 入参。 */
export interface PopMenuProps {
  /** 视口坐标（调用方的定位 state 常声明成可选，缺省按 0 兜底） */
  x?: number;
  y?: number;
  /** [{label, icon?, danger?, onClick}] 或 'sep'；未标注类型的数组里 'sep' 会退化成 string，一并收 */
  items: Array<PopMenuItem | string>;
  onClose: () => void;
}

/**
 * @param {number} x/y    视口坐标
 * @param {Array} items   [{label, icon?, danger?, onClick}] 或 'sep'
 * @param {Function} onClose
 */
export function PopMenu({ x, y, items, onClose }: PopMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // DOM 边界：activeElement 声明为 Element|null，focus() 只在 HTMLElement 上有
  const returnFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    const el = ref.current;
    const first = el && el.querySelector<HTMLButtonElement>('button');
    if (first) first.focus();
    return undefined;
  }, []);

  useDismiss({
    onDismiss: onClose,
    capture: true,
    stopProp: true,
    isInside: (e) => ref.current && ref.current.contains(e.target as Node),
  });

  // Esc 只关菜单、不惊动下层（捕获阶段吃掉）；其余键盘走项间导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const btns = [...el.querySelectorAll('button')];
      // DOM 事件边界：activeElement 声明为 Element|null，这里只与按钮数组比对
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const n = btns.length;
      if (!n) return;
      const next = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      btns[next]?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => () => {
    // 归还触发元素焦点
    if (returnFocus.current && document.contains(returnFocus.current)) {
      try { returnFocus.current.focus(); } catch { /* 元素可能已 unmount */ }
    }
  }, []);

  // 视口内夹取：靠右/靠下时不溢出（坐标缺省按 0，避免 Math.min(undefined) 得 NaN）
  const style: CSSProperties = {
    left: Math.min(x ?? 0, window.innerWidth - 190),
    top: Math.min(y ?? 0, window.innerHeight - 40 - items.length * 30),
  };

  return (
    <div className="pp-menu" style={style} ref={ref} role="menu">
      {items.map((it, i) =>
        // 非对象即分隔线：调用方把 'sep' 写进未标注类型的数组时会退化成 string
        typeof it === 'string' ? (
          <div className="pp-sep" key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={'pp-menu-item' + (it.danger ? ' danger' : '')}
            onClick={() => { onClose(); if (it.onClick) it.onClick(); }}
          >
            {it.icon ? <Icon name={it.icon} /> : null}
            {it.label}
          </button>
        )
      )}
    </div>
  );
}

// ---- 锚定下拉菜单（行尾「⋯」按钮旁边弹出的那种） ----
// 点外 / Esc 关；菜单项 { label, danger?, onPick }。与 PopMenu 同一套视觉。

/** 锚定下拉菜单的一项。 */
export interface RowMenuItem {
  label: string;
  danger?: boolean;
  onPick: () => void;
}

/** RowMenu 入参（items 容许空项，内部过滤）。 */
export interface RowMenuProps {
  items?: Array<RowMenuItem | null | undefined | false>;
}

export function RowMenu({ items = [] }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useDismiss({
    onDismiss: () => setOpen(false),
    enabled: open,
    isInside: (e) => ref.current && ref.current.contains(e.target as Node),
  });

  const list = items.filter((x): x is RowMenuItem => !!x);
  if (!list.length) return null;
  return (
    <span className="rowmenu" ref={ref}>
      <button
        type="button"
        className="rowmenu-btn"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="dots" size={13} />
      </button>
      {open ? (
        <span className="pp-menu rowmenu-pop" role="menu">
          {list.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={'pp-menu-item' + (it.danger ? ' danger' : '')}
              onClick={() => { setOpen(false); it.onPick(); }}
            >
              {it.label}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}
