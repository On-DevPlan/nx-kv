// MD 工作台工具区：头部默认「时间目标勋章 | 新任务 · 提交 · 更多」。
// #78：次级动作收进「更多」；#143：与 group/dir 同套 tool-acts 编排（顺序/显隐）。
import { useEffect, useRef, useState } from 'react';
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

export function useMenu() {
  const [open, setOpen] = useState(false);
  // pos：菜单锚点屏幕坐标（portal 到 body 后按 fixed 定位，
  // 否则会掉进工具栏 overflow:hidden 里被整条裁掉）
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return { open, setOpen, pos, setPos, ref, menuRef };
}

// 菜单统一 portal 到 body：工具栏行 overflow:hidden，行内 absolute 定位会被裁
export function MenuPortal({ menu, className = '', style, children }) {
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
export function openMenuAt(menu, e, align = 'left') {
  const r = e.currentTarget.getBoundingClientRect();
  const top = r.bottom + 4;
  menu.setPos(align === 'left'
    ? { left: r.left, top }
    : { left: 'auto', right: Math.max(8, window.innerWidth - r.right), top });
  menu.setOpen((v) => !v);
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
}) {
  const actMore = useMenu();
  const { layout, setLayout } = useToolActsLayout(KIND);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    actMore.setOpen(false);
  }, [mode]);

  // 当前页可用动作：无 handler 的不渲染（草稿态会藏掉 clone/fork/delete 等）
  const specs = {
    new: onNew && { label: '新任务', run: onNew },
    submit: { label: submitLabel || '提交', run: onSubmit, primary: true },
    mode: onMode && {
      label: mode === 'edit' ? '返回实时预览' : '源码模式',
      hint: mode === 'edit' ? '当前' : '',
      run: () => onMode(mode === 'edit' ? 'split' : 'edit'),
    },
    img: onImg && { label: '插入图片', run: onImg },
    att: onAtt && { label: '添加附件', run: onAtt },
    import: onImport && mode !== 'split' && { label: '导入', run: onImport },
    draft: onDraft && mode !== 'split' && { label: '存草稿', run: onDraft },
    chain: onChain && { label: '任务链', run: onChain },
    clone: onClone && { label: '克隆任务', run: onClone },
    fork: onFork && { label: 'Fork 任务', run: onFork },
    complete: onComplete && { label: '标为完成', run: onComplete },
    'cancel-task': onCancelTask && { label: '取消任务', run: onCancelTask, danger: true },
    mark: showMark && onMark && { label: '评论', run: onMark },
    delete: onDelete && { label: '删除', run: onDelete, danger: true },
    preview: onPreview && { label: '预览提示词', run: onPreview },
    overview: onOverview && { label: '总览', run: onOverview },
    prog: onProg && { label: '进程', run: onProg },
    source: onSource && { label: '原文', run: onSource },
    shortcuts: onShortcuts && { label: '快捷键', run: onShortcuts },
  };

  const available = (id) => id === 'more' || !!specs[id];

  const barItems = layout.filter((x) => onBarOf(KIND, x) && available(x.id));
  const moreItems = layout.filter((x) => inMoreOf(KIND, x) && available(x.id));

  const runItem = (id) => {
    specs[id]?.run?.();
    actMore.setOpen(false);
  };

  const renderBarBtn = (id) => {
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
    items: moreItems.filter((x) => metaOf(KIND, x.id).menuGroup === g.id),
  })).filter((g) => g.items.length);
  const ungroupedMore = moreItems.filter((x) => !metaOf(KIND, x.id).menuGroup);

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
        {barItems.map((x) => renderBarBtn(x.id))}

        <MenuPortal menu={actMore} className="mdw-act-menu">
          {goalMenu}
          {goalMenu && <div className="mdw-fmt-menu-sep" role="separator" />}
          {groupedMore.map((g) => (
            <div className="mdw-fmt-menu-group" role="group" aria-label={g.label} key={g.id}>
              <div className="mdw-fmt-menu-cap">{g.label}</div>
              {g.items.map((x) => {
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
          {ungroupedMore.map((x) => {
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
