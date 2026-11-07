// MD 工作台工具区：头部只留「时间目标勋章 | 新任务 · 提交 · 更多」。
// #78：头部按钮过多——次级动作一律收进「更多」菜单（含进程/原文/快捷键）；
// MD 格式不再占头部（划选浮条 + 行首 / 命令 + Ctrl/⌘B 等快捷键已覆盖）；
// 时间目标设置同样在「更多」里，外部只以勋章回显（goalBadge，点击展开菜单）。
// #47：撤掉「阅读」模式；源码模式偶尔用，入口也收进「更多」——菜单按 编辑/任务/查看 分层。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

  useEffect(() => {
    actMore.setOpen(false);
  }, [mode]);

  // 「更多」收拢一切次级动作（#78）：头部只留 新任务 / 提交为任务。
  // #47：按「编辑 / 任务 / 查看」三层分组——同一类动作排在一起，组间有标题与分隔线，
  // 十几条平铺的菜单没人能扫完。
  const modeItem = onMode && {
    id: 'mode',
    label: mode === 'edit' ? '返回实时预览' : '源码模式',
    hint: mode === 'edit' ? '当前' : '',
    run: () => onMode(mode === 'edit' ? 'split' : 'edit'),
  };
  const menuGroups = [
    {
      id: 'edit',
      label: '编辑',
      items: [
        modeItem,
        // #76：附件入口放进「更多」，预览态也能找到
        onImg && { id: 'img', label: '插入图片', run: onImg },
        onAtt && { id: 'att', label: '添加附件', run: onAtt },
        mode !== 'split' && { id: 'import', label: '导入', run: onImport },
        mode !== 'split' && { id: 'draft', label: '存草稿', run: onDraft },
      ].filter(Boolean),
    },
    {
      id: 'task',
      label: '任务',
      items: [
        // #77：任务链进「更多」弹窗入口（置顶，别埋在删除旁边）
        onChain && { id: 'chain', label: '任务链', run: onChain },
        // 克隆（#70）：内容快速复制成新任务，不建派生链（与评论/反馈的链式派生区分）
        onClone && { id: 'clone', label: '克隆任务', run: onClone },
        showMark && { id: 'mark', label: '评论', run: onMark },
        onDelete && { id: 'delete', label: '删除', run: onDelete, danger: true },
      ].filter(Boolean),
    },
    {
      id: 'view',
      label: '查看',
      items: [
        // 预览：**看 agent 到底会收到什么**（任务 #65）。不是「预览渲染效果」，
        // 而是把交付链路（组上下文 / 收尾指令 / check 指令 / 附件 / ack / 持续 get）
        // 拼出来的原文摆出来——模板可配之后，这是唯一可信的观测口。
        onPreview && { id: 'preview', label: '预览提示词', run: onPreview },
        { id: 'overview', label: '总览', run: onOverview },
        { id: 'prog', label: '进程', run: onProg },
        onSource && { id: 'source', label: '原文', run: onSource },
        onShortcuts && { id: 'shortcuts', label: '快捷键', run: onShortcuts },
      ].filter(Boolean),
    },
  ].filter((g) => g.items.length);

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
        {onNew && (
          <button type="button" className="btn ghost sm" onClick={onNew}>新任务</button>
        )}
        <button type="button" className="btn sm primary" onClick={onSubmit}>{submitLabel}</button>
        <div className="mdw-actions-more" ref={actMore.ref}>
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
          <MenuPortal menu={actMore} className="mdw-act-menu">
            {/* 时间目标编辑区（#78）摆菜单顶部：点输入不关菜单（useMenu 判定在 menuRef 内） */}
            {goalMenu}
            {goalMenu && <div className="mdw-fmt-menu-sep" role="separator" />}
            {menuGroups.map((g) => (
              <div className="mdw-fmt-menu-group" role="group" aria-label={g.label} key={g.id}>
                <div className="mdw-fmt-menu-cap">{g.label}</div>
                {g.items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitem"
                    className={'mdw-fmt-menu-item' + (a.danger ? ' danger' : '')}
                    onClick={() => {
                      a.run?.();
                      actMore.setOpen(false);
                    }}
                  >
                    {a.label}
                    {a.hint ? <span className="hint">{a.hint}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          </MenuPortal>
        </div>
      </div>
    </div>
  );
}
