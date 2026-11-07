// 文档编辑器页头（DocPanel 与「查看详情」弹窗共用一份）。
//
// 布局与任务页一致（#88）：`[路径/面包屑] [标题·路径]` 一行、`[更多 · 保存]` 右对齐，
// 下面是编辑器本体。差异只在数据面，不在排版——两处各写一份必然会漂。
//
// 「更多」按 编辑 / 文档 / 查看 三层分组（沿用任务页 ToolBar 口径）：
//   · 查看 → 文字列表：与「进程」同一个右侧边栏位，列本项目/项目组的全部文章
//     （refs 面板；弹窗里点它先关弹窗再开侧栏，否则侧栏被模态遮罩压住）
import { MenuPortal, openMenuAt, useMenu } from '../md/tool-bar.jsx';

/**
 * @param {object} p
 * @param {string} [p.crumb]        面包屑区（弹窗里放「返回列表」；页签里由 DocPanel 自己渲染 RouteBreadcrumb）
 * @param {string} p.title          标题
 * @param {string} p.pathLabel      路径/归属行
 * @param {boolean} p.dirty         未保存
 * @param {boolean} p.writable      可写（false 时不给「保存」与编辑类菜单）
 * @param {() => void} p.onSave
 * @param {Array<{label: string, items: Array}>} p.menuGroups 额外菜单分组
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
}) {
  const more = useMenu();

  const groups = menuGroups.filter((g) => g && g.items && g.items.length);

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
          {writable && groups.length > 0 && (
            <div className="docp-more" ref={more.ref}>
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
              <MenuPortal menu={more} className="mdw-act-menu">
                {groups.map((g) => (
                  <div className="mdw-fmt-menu-group" role="group" aria-label={g.label} key={g.id || g.label}>
                    <div className="mdw-fmt-menu-cap">{g.label}</div>
                    {g.items.map((a) => (
                      <button
                        key={a.id || a.label}
                        type="button"
                        role="menuitem"
                        className={'mdw-fmt-menu-item' + (a.danger ? ' danger' : '')}
                        onClick={() => {
                          more.setOpen(false);
                          a.run?.();
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
          )}
          {writable && (
            <button
              type="button"
              className="btn sm primary docp-save"
              disabled={saving || !dirty}
              onClick={onSave}
            >
              {saving ? '保存中…' : onSaveLabel}
            </button>
          )}
          {!writable && <span className="docp-tag ext">只读</span>}
        </div>
      </div>
    </div>
  );
}

/** 菜单分组小工具：过滤掉 false/null 项（与 ToolBar 同一写法） */
export function groupOf(id, label, items) {
  return { id, label, items: items.filter(Boolean) };
}
