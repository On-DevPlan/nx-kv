// 文档编辑器页头。**只有一处使用：maincontent 里的 DocPanel**（#88 修正后弹窗不再内嵌编辑器）。
//
// 布局与任务页一致：`[面包屑] [标题·路径]` 一行、`[更多 · 保存]` 右对齐，
// 下面是编辑器本体。
//
// 「更多」按 编辑 / 文档 / 查看 三层分组（沿用任务页 ToolBar 口径）；
// #143：与 task/group/dir 同套 tool-acts 编排（顺序/显隐）。
import { useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MenuPortal, openMenuAt, useMenu } from '../md/tool-bar.jsx';
import { inMoreOf, metaOf, onBarOf } from '../tool-acts/modules.js';
import { useToolActsLayout } from '../tool-acts/use-layout.js';
import ToolActsLayoutPanel from '../tool-acts/layout-panel.jsx';
import '../tool-acts/style.css';

const KIND = 'doc';

const MENU_GROUPS = [
  { id: 'edit', label: '编辑' },
  { id: 'doc', label: '文档' },
  { id: 'view', label: '查看' },
];

/** 菜单里的一项动作（调用方在 menuGroups 里递进来）。 */
export interface DocMenuItem {
  id: string;
  label?: string;
  hint?: string;
  run?: () => void;
  primary?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

/** 菜单分组（按 id 并入编排）。 */
export interface DocMenuGroup {
  id: string;
  label: string;
  items: Array<DocMenuItem | null | undefined | false | ''>;
}

/** DocHead 入参。 */
export interface DocHeadProps {
  /** 面包屑区（DocPanel 传 <RouteBreadcrumb />） */
  crumb?: ReactNode;
  /** 标题 */
  title?: string;
  /** 路径/归属行 */
  pathLabel?: string;
  /** 未保存 */
  dirty?: boolean;
  /** 可写（false 时不给「保存」与编辑类菜单） */
  writable?: boolean;
  onSave?: (() => void) | null;
  onSaveLabel?: string;
  /** 额外菜单分组（按 id 并入编排） */
  menuGroups?: DocMenuGroup[] | null;
  saving?: boolean;
  /** 外部文档（页头给「外部 · 可写回」提示） */
  external?: boolean;
  /** 标题行里追加的控件（模式切换等） */
  afterTitle?: ReactNode;
}

/**
 * @param {object} p
 * @param {string} [p.crumb]        面包屑区（DocPanel 传 <RouteBreadcrumb />）
 * @param {string} p.title          标题
 * @param {string} p.pathLabel      路径/归属行
 * @param {boolean} p.dirty         未保存
 * @param {boolean} p.writable      可写（false 时不给「保存」与编辑类菜单）
 * @param {() => void} p.onSave
 * @param {Array<{label: string, items: Array}>} p.menuGroups 额外菜单分组（按 id 并入编排）
 * @param {boolean} [p.saving]
 * @param {boolean} [p.external]    外部文档（页头给「外部 · 可写回」提示）
 * @param {React.ReactNode} [p.afterTitle] 标题行里追加的控件（模式切换等）
 */
export default function DocHead({
  crumb = null,
  title,
  pathLabel = '',
  dirty = false,
  writable = false,
  onSave = null,
  onSaveLabel = '保存',
  menuGroups = [],
  saving = false,
  external = false,
  afterTitle = null,
}: DocHeadProps) {
  const more = useMenu();
  const { layout, setLayout } = useToolActsLayout(KIND);
  const [panelOpen, setPanelOpen] = useState(false);

  // 把调用方 menuGroups 摊成 id → spec（动态 label/hint/run）
  const specs: Record<string, DocMenuItem | null | undefined> = {};
  for (const g of menuGroups || []) {
    for (const a of g?.items || []) {
      if (!a || !a.id) continue;
      specs[a.id] = a;
    }
  }
  specs.save = onSave && {
    id: 'save',
    label: saving ? '保存中…' : onSaveLabel,
    run: onSave,
    primary: true,
    disabled: saving || !dirty,
  };

  const available = (id: string) => id === 'more' || !!specs[id];

  const barItems = layout.filter((x) => onBarOf(KIND, x) && available(x.id));
  const moreItems = layout.filter((x) => inMoreOf(KIND, x) && available(x.id));

  const runItem = (id: string) => {
    const s = specs[id];
    if (s) s.run?.();
    more.setOpen(false);
  };

  const renderBarBtn = (id: string) => {
    if (id === 'more') {
      return (
        <div className="docp-more" ref={more.ref} key="more">
          <button
            type="button"
            className={`btn ghost sm${more.open ? ' on' : ''}`}
            title="更多操作"
            aria-haspopup="menu"
            aria-expanded={more.open}
            onClick={(e) => openMenuAt(more, e, 'right')}
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
        className={s.primary || id === 'save' ? 'btn sm primary docp-save' : 'btn ghost sm'}
        disabled={!!s.disabled}
        onClick={() => runItem(id)}
      >
        {s.label || metaOf(KIND, id).label || id}
      </button>
    );
  };

  const groupedMore = MENU_GROUPS.map((g) => ({
    ...g,
    items: moreItems.filter((x) => metaOf(KIND, x.id).menuGroup === g.id),
  })).filter((g) => g.items.length);
  const ungroupedMore = moreItems.filter((x) => !metaOf(KIND, x.id).menuGroup);

  if (!writable) {
    return (
      <div className="mdw-top docp-top">
        {crumb}
        <div className="mdw-head">
          <div className="mdw-title">{title || '文档'}</div>
          <div className="mdw-path">
            {pathLabel}
            {dirty ? ' · 未保存' : ''}
            {external ? ' · 外部' : ''}
          </div>
          <span className="grow" />
          {afterTitle}
          <div className="docp-actions">
            <span className="docp-tag ext">只读</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mdw-top docp-top">
      {crumb}
      <div className="mdw-head">
        <div className="mdw-title">{title || '文档'}</div>
        <div className="mdw-path">
          {pathLabel}
          {dirty ? ' · 未保存' : ''}
          {external ? ' · 外部' : ''}
        </div>
        <span className="grow" />
        {afterTitle}
        <div className="docp-actions">
          {barItems.map((x) => renderBarBtn(x.id))}

          <MenuPortal menu={more} className="mdw-act-menu">
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
                more.setOpen(false);
                setPanelOpen(true);
              }}
            >
              自定义工具栏…
            </button>
          </MenuPortal>
        </div>
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

/** 菜单分组小工具：过滤掉 false/null 项（与 ToolBar 同一写法） */
export function groupOf(id: string, label: string, items: Array<DocMenuItem | null | undefined | false | ''>): DocMenuGroup {
  return { id, label, items: items.filter(Boolean) };
}
