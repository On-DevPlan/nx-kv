// MD 工作台工具区：头部默认「时间目标勋章 | 新任务 · 提交 · 更多」。
// #78：次级动作收进「更多」；#143：与 group/dir 同套 tool-acts 编排（顺序/显隐）。
import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  Dispatch,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  SetStateAction,
} from 'react';
import { createPortal } from 'react-dom';
import { inMoreOf, metaOf, onBarOf } from '../tool-acts/modules.js';
import { useToolActsLayout } from '../tool-acts/use-layout.js';
import ToolActsLayoutPanel from '../tool-acts/layout-panel.jsx';
import '../tool-acts/style.css';

const KIND = 'task';

const MENU_GROUPS = [
  { id: 'edit', label: '编辑' },
  { id: 'task', label: '任务' },
  { id: 'view', label: '查看' },
];

/** 菜单锚点：默认钉在触钮正下方（left/top），靠右缘的按钮改锚右边线。 */
export interface MenuPos {
  x?: number;
  y?: number;
  left?: number | string;
  right?: number;
  top?: number;
}

/** useMenu 的返回面（ToolBar 自己与 MenuPortal / openMenuAt 共用）。 */
export interface MenuApi {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  pos: MenuPos;
  setPos: Dispatch<SetStateAction<MenuPos>>;
  ref: { current: HTMLDivElement | null };
  menuRef: { current: HTMLDivElement | null };
}

/** 「更多」菜单里的一项动作。 */
interface ToolSpec {
  label?: ReactNode;
  run?: (() => void) | null;
  primary?: boolean;
  hint?: string;
  danger?: boolean;
}

export function useMenu(): MenuApi {
  const [open, setOpen] = useState(false);
  // pos：菜单锚点屏幕坐标（portal 到 body 后按 fixed 定位，
  // 否则会掉进工具栏 overflow:hidden 里被整条裁掉）
  const [pos, setPos] = useState<MenuPos>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      // DOM 事件边界：mousedown 的 target 声明为 EventTarget，contains 需要 Node
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, pos, setPos, ref, menuRef };
}

// 菜单统一 portal 到 body：工具栏行 overflow:hidden，行内 absolute 定位会被裁
export function MenuPortal({ menu, className = '', style, children }: {
  menu: MenuApi;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  if (!menu.open) return null;
  return createPortal(
    <div
      className={`mdw-fmt-menu${className ? ` ${className}` : ''}`}
      role="menu"
      ref={menu.menuRef}
      style={{ position: 'fixed', ...menu.pos, ...style }}
    >
      {children}
    </div>,
    document.body,
  );
}

// 触钮点击：记录锚点矩形（菜单贴其正下方），再翻转开合。
// align='right' 时锚右边线（靠视口右缘的按钮，左锚会把菜单顶出屏）
export function openMenuAt(menu: MenuApi, e: ReactMouseEvent<HTMLElement>, align: 'left' | 'right' = 'left') {
  const r = e.currentTarget.getBoundingClientRect();
  const top = r.bottom + 4;
  menu.setPos(align === 'left'
    ? { left: r.left, top }
    : { left: 'auto', right: Math.max(8, window.innerWidth - r.right), top });
  menu.setOpen((v) => !v);
}

interface ToolBarProps {
  mode?: string;
  onMode?: ((m: string) => void) | null;
  showMark?: boolean;
  submitLabel?: string;
  onNew?: (() => void) | null;
  onSubmit?: (() => void) | null;
  onChain?: (() => void) | null;
  onPreview?: (() => void) | null;
  onImg?: (() => void) | null;
  onAtt?: (() => void) | null;
  onImport?: (() => void) | null;
  onClone?: (() => void) | null;
  onFork?: (() => void) | null;
  onComplete?: (() => void) | null;
  /** #131：plan 态开关（草稿 ⇄ 待领取）；未给 handler 就不渲染 */
  onPlan?: (() => void) | null;
  /** plan 项的动态文案（转成草稿 / 转回待领取） */
  planLabel?: string;
  onCancelTask?: (() => void) | null;
  onMark?: (() => void) | null;
  onDraft?: (() => void) | null;
  onDelete?: (() => void) | null;
  onOverview?: (() => void) | null;
  onProg?: (() => void) | null;
  onSource?: (() => void) | null;
  onShortcuts?: (() => void) | null;
  goalBadge?: { label?: ReactNode; title?: string } | null;
  goalMenu?: ReactNode;
}

export default function ToolBar({
  mode,
  onMode,
  showMark,
  submitLabel,
  onNew,
  onSubmit,
  onChain,
  onPreview,
  onImg,
  onAtt,
  onImport,
  onClone,
  onFork,
  onComplete,
  onPlan,
  planLabel,
  onCancelTask,
  onMark,
  onDraft,
  onDelete,
  onOverview,
  onProg,
  onSource,
  onShortcuts,
  goalBadge,
  goalMenu,
}: ToolBarProps) {
  const actMore = useMenu();
  const { layout, setLayout } = useToolActsLayout(KIND);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    actMore.setOpen(false);
  }, [mode]);

  // 当前页可用动作：无 handler 的不渲染（草稿态会藏掉 clone/fork/delete 等）
  const specs: Record<string, ToolSpec | null | undefined> = {
    new: onNew && { label: '新任务', run: onNew },
    submit: { label: submitLabel || '提交', run: onSubmit, primary: true },
    mode: onMode && {
      label: mode === 'edit' ? '返回实时预览' : '源码模式',
      hint: mode === 'edit' ? '当前' : '',
      run: () => onMode?.(mode === 'edit' ? 'split' : 'edit'),
    },
    img: onImg && { label: '插入图片', run: onImg },
    att: onAtt && { label: '添加附件', run: onAtt },
    import: onImport && mode !== 'split' ? { label: '导入', run: onImport } : null,
    draft: onDraft && mode !== 'split' ? { label: '存草稿', run: onDraft } : null,
    chain: onChain && { label: '任务链', run: onChain },
    clone: onClone && { label: '克隆任务', run: onClone },
    fork: onFork && { label: 'Fork 任务', run: onFork },
    complete: onComplete && { label: '标为完成', run: onComplete },
    plan: onPlan && { label: planLabel || '转为草稿（plan）', run: onPlan, hint: '不进队列' },
    'cancel-task': onCancelTask && { label: '取消任务', run: onCancelTask, danger: true },
    mark: showMark && onMark ? { label: '评论', run: onMark } : null,
    delete: onDelete && { label: '删除', run: onDelete, danger: true },
    preview: onPreview && { label: '预览提示词', run: onPreview },
    overview: onOverview && { label: '总览', run: onOverview },
    prog: onProg && { label: '进程', run: onProg },
    source: onSource && { label: '原文', run: onSource },
    shortcuts: onShortcuts && { label: '快捷键', run: onShortcuts },
  };

  const available = (id: string) => id === 'more' || !!specs[id];

  const barItems = layout.filter((x: { id: string }) => onBarOf(KIND, x) && available(x.id));
  const moreItems = layout.filter((x: { id: string }) => inMoreOf(KIND, x) && available(x.id));

  const runItem = (id: string) => {
    specs[id]?.run?.();
    actMore.setOpen(false);
  };

  const renderBarBtn = (id: string): ReactNode => {
    if (id === 'more') {
      return (
        <div className="mdw-actions-more" ref={actMore.ref} key="more">
          <button
            type="button"
            className={`btn ghost sm${actMore.open ? ' on' : ''}`}
            title="更多操作"
            aria-expanded={actMore.open}
            aria-haspopup="menu"
            onClick={(e) => openMenuAt(actMore, e, 'right')}
          >
            更多
          </button>
        </div>
      );
    }
    const s = specs[id];
    if (!s) return null;
    return (
      <button
        key={id}
        type="button"
        className={s.primary ? 'btn sm primary' : 'btn ghost sm'}
        onClick={() => runItem(id)}
      >
        {s.label}
      </button>
    );
  };

  // 更多菜单：按 menuGroup 分层（#47）；无分组项直接平铺
  const groupedMore = MENU_GROUPS.map((g) => ({
    ...g,
    items: moreItems.filter((x: { id: string }) => metaOf(KIND, x.id).menuGroup === g.id),
  })).filter((g) => g.items.length);
  const ungroupedMore = moreItems.filter((x: { id: string }) => !metaOf(KIND, x.id).menuGroup);

  return (
    <div className="mdw-toolbar">
      <div className="mdw-toolbar-left">
        {/* 时间目标勋章（#78）：设了目标才出现；点击同样展开「更多」菜单去改 */}
        {goalBadge && (
          <button
            type="button"
            className="mdw-goal-badge"
            title={goalBadge.title}
            aria-haspopup="menu"
            aria-expanded={actMore.open}
            onClick={(e) => openMenuAt(actMore, e, 'right')}
          >
            {goalBadge.label}
          </button>
        )}
      </div>

      <div className="mdw-actions" role="group" aria-label="任务操作">
        {barItems.map((x: { id: string }) => renderBarBtn(x.id))}

        <MenuPortal menu={actMore} className="mdw-act-menu">
          {goalMenu}
          {goalMenu && <div className="mdw-fmt-menu-sep" role="separator" />}
          {groupedMore.map((g) => (
            <div className="mdw-fmt-menu-group" role="group" aria-label={g.label} key={g.id}>
              <div className="mdw-fmt-menu-cap">{g.label}</div>
              {g.items.map((x: { id: string }) => {
                const s = specs[x.id];
                const danger = s?.danger || metaOf(KIND, x.id).danger;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="menuitem"
                    className={'mdw-fmt-menu-item' + (danger ? ' danger' : '')}
                    onClick={() => runItem(x.id)}
                  >
                    {s?.label || metaOf(KIND, x.id).label || x.id}
                    {s?.hint ? <span className="hint">{s.hint}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {ungroupedMore.map((x: { id: string }) => {
            const s = specs[x.id];
            return (
              <button
                key={x.id}
                type="button"
                role="menuitem"
                className={'mdw-fmt-menu-item' + (s?.danger || metaOf(KIND, x.id).danger ? ' danger' : '')}
                onClick={() => runItem(x.id)}
              >
                {s?.label || metaOf(KIND, x.id).label || x.id}
              </button>
            );
          })}
          <div className="mdw-fmt-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="mdw-fmt-menu-item"
            onClick={() => {
              actMore.setOpen(false);
              setPanelOpen(true);
            }}
          >
            自定义工具栏…
          </button>
        </MenuPortal>
      </div>

      {panelOpen && createPortal(
        <div className="ta-panel-mask" onClick={() => setPanelOpen(false)}>
          <div className="ta-panel-wrap" onClick={(e) => e.stopPropagation()}>
            <ToolActsLayoutPanel
              kind={KIND}
              layout={layout}
              setLayout={setLayout}
              onClose={() => setPanelOpen(false)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
