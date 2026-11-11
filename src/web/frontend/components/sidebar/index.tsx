// 侧边栏（应用壳的左栏）：品牌区 + 搜索 + 树（全局池恒顶 → 看板 → 仓库）+ 底部入口。
// **全局动作集中在品牌区**（顶栏已删）：设置（齿轮气泡，含重置布局与偏好开关）。
// 布局撤销/重做已整体下线（#96）：模型管理回退普通 state，不再保留入口。
// 收起成窄轨时保留设置入口（见 panel.jsx）。
// 拖拽编排 = 三段式落点（drag.js）；可见序 = 渲染序，键盘导航走同一份扁平序。
//
// **数据源**：仓库登记 + 看板（真实数据，见 model.js）。侧边栏不持有自己的分组体系，
// 也不持有自己的目录清单——「目录」就是仓库登记里的开发仓库。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from '../icons.jsx';
import { PopMenu } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { useDialog } from '../popup/index.jsx';
import type { PopMenuItem } from '../popup/index.js';
import { buildTree } from './model.js';
import type { SideRow } from './model.js';
import { canDrop, zoneOf, applyDrop } from './drag.js';
import type { DragRow, DropZone } from './drag.js';
import { rowMenuItems, addMenuItems } from './row-menu.jsx';
import TaskChildren from './task-children.jsx';
import { ensureQueueAndGo } from './queue-nav.js';
import type { AppRoute, BoardRow, LocalTopic, Prefs, RepoRow, ShellApi } from '../../types.js';

/** Sidebar 入参（顶栏删除后这里是壳层唯一的数据入口）。 */
interface SidebarProps {
  /** 开发仓库（type != ref） */
  repos?: RepoRow[] | null;
  /** 看板 */
  boards?: BoardRow[] | null;
  /** 本机任务队列（按 cwd 匹配仓库） */
  topics?: LocalTopic[] | null;
  /** {view, key} */
  route?: Partial<AppRoute>;
  /** (hash) => void */
  onNavigate?: (hash: string) => void;
  /** 本机队列刷新（仓库无队列时「新建页」要先建队列再刷） */
  refreshLocal?: () => Promise<void>;
  waitingCount?: number;
  /** UI 偏好（order / hidden / folded） */
  prefs?: Partial<Prefs>;
  /** (patch) => void（已持久化） */
  patchPrefs?: (patch: Partial<Prefs> | ((prev: Prefs) => Partial<Prefs>)) => void;
  /** 仓库/看板刷新（登记、归属变更后） */
  refreshRepos?: () => Promise<void>;
  /** 收起成窄轨（工作区面板：改 tabset weight） */
  onCollapse?: () => void;
  /** 完全关闭（左缘只剩半圆弧把手，点把手展开） */
  onClose?: () => void;
  /** 全局动作：{resetLayout, openSettings} */
  shell?: ShellApi;
}

/** 菜单在场态：坐标 + 项。 */
interface MenuState {
  x: number;
  y: number;
  items: PopMenuItem[];
}

export default function Sidebar({
  repos,           // 开发仓库（type != ref）
  boards,          // 看板
  topics,          // 本机任务队列（按 cwd 匹配仓库）
  route = {},      // {view, key}
  onNavigate,      // (hash) => void
  refreshLocal,    // 本机队列刷新（仓库无队列时「新建页」要先建队列再刷）
  waitingCount = 0,
  prefs = {},
  patchPrefs,      // (patch) => void（已持久化）
  refreshRepos,    // 仓库/看板刷新（登记、归属变更后）
  onCollapse,      // 收起成窄轨（工作区面板：改 tabset weight）
  onClose,         // 完全关闭（左缘只剩半圆弧把手，点把手展开）
  shell,           // 全局动作：{resetLayout, openSettings}
}: SidebarProps) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [kw, setKw] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);      // {x,y,items}
  const [kbIndex, setKbIndex] = useState(-1);  // 键盘焦点行
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()); // 展开子行的仓库 key
  const dragRef = useRef<DragRow | null>(null);                // {type,key|id,name}
  const [dropHint, setDropHint] = useState<{ id: string; zone: DropZone } | null>(null); // {key|id, zone}
  const treeRef = useRef<HTMLDivElement | null>(null);

  const { rows, matchCount } = useMemo(
    () => buildTree(repos, boards, topics, prefs, kw),
    [repos, boards, topics, prefs, kw]
  );

  const isActive = (row: SideRow) => {
    if (row.type === 'global') return route.view === 'global';
    if (row.type === 'repo') return route.view === 'dir' && route.key === row.topicKey;
    if (row.type === 'board') return route.view === 'group' && route.key === row.id;
    return false;
  };

  // 当前路由所在仓库自动展开子行（深链 / 总览跳转进来也能看到层级）
  useEffect(() => {
    const key = route.key;
    if (route.view !== 'dir' || !key) return;
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [route.view, route.key]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 点击：看板 = 进组视图（**组是叶子，成员在组面板里下拉选择**，树里不再铺子文件）；
  // 仓库 = 进目录（子任务表）；全局 = 进全局池。
  // 仓库行没有任务队列时（topicKey 为空）点行 = 先建队列再进（与「新建页」同一套）。
  const openRow = useCallback(
    (row: SideRow) => {
      if (row.type === 'board') {
        onNavigate?.('#/group/' + encodeURIComponent(String(row.id)));
      } else if (row.type === 'global') {
        onNavigate?.('#/global');
      } else if (row.topicKey) {
        onNavigate?.('#/dir/' + encodeURIComponent(row.topicKey));
      } else {
        ensureQueueAndGo({ row, onNavigate, refreshLocal, toast });
      }
    },
    [onNavigate, refreshLocal, toast]
  );

  // chevron：展开/收起（仓库 = 子任务；看板是叶子，没有展开态）
  const toggleRow = useCallback(
    (row: SideRow) => {
      if (row.type === 'global') {
        onNavigate?.('#/global');
      } else {
        toggleExpanded(row.topicKey || row.key);
      }
    },
    [onNavigate, toggleExpanded]
  );

  // ─── 键盘导航：↑↓ 在可见行间移动（序 = 渲染序），Enter 打开，Esc 退出 ───
  const onTreeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (menu) return; // 菜单开着时按键归菜单
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setKbIndex((i) => {
        if (i < 0) return e.key === 'ArrowDown' ? 0 : rows.length - 1;
        return Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setKbIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setKbIndex(rows.length - 1);
    } else if (e.key === 'Enter') {
      const row = rows[kbIndex];
      if (kbIndex >= 0 && row) openRow(row);
    } else if (e.key === 'Escape') {
      setKbIndex(-1);
    }
  };

  // ─── 拖拽编排 ───
  const onDragStart = (e: ReactDragEvent<HTMLButtonElement>, row: SideRow) => {
    dragRef.current = { type: row.type, key: row.key, id: row.id, name: row.name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.type + ':' + (row.key || row.id));
    e.currentTarget.classList.add('dragging');
  };
  const onDragEnd = (e: ReactDragEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    setDropHint(null);
    e.currentTarget?.classList?.remove('dragging');
  };
  const onDragOver = (e: ReactDragEvent<HTMLButtonElement>, row: SideRow) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    if (canDrop(dragRef.current, row, zone)) {
      e.dataTransfer.dropEffect = 'move';
      setDropHint({ id: row.key || String(row.id), zone });
    } else {
      setDropHint(null);
    }
  };
  const onDragLeave = () => setDropHint((h) => (h ? null : h));
  const onDrop = (e: ReactDragEvent<HTMLButtonElement>, row: SideRow) => {
    e.preventDefault();
    const drag = dragRef.current;
    dragRef.current = null;
    setDropHint(null);
    if (!drag) return;
    const zone = zoneOf(e, e.currentTarget);
    if (!canDrop(drag, row, zone)) return;
    patchPrefs?.(applyDrop(prefs, drag, row, zone));
  };
  const onTreeDropTail = (e: ReactDragEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropHint(null);
    if (!drag || drag.type !== 'repo') return;
    e.preventDefault();
    const key = drag.key;
    // 仓库行必然带 key（rKey 用它排序）；缺失时无法写入排序，直接放弃
    if (!key) return;
    const order = (prefs.order || []).filter((k) => k !== key);
    order.push(key);
    patchPrefs?.({ order });
  };

  // ─── 行菜单（菜单内容见 row-menu.jsx）───
  const openRowMenu = (e: ReactMouseEvent<HTMLElement>, row: SideRow) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged: refreshRepos, refreshLocal, toast, dialog }),
    });
  };

  // ─── 登记仓库 / 新建看板 ───
  const addMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    setMenu({ x: e.clientX, y: e.clientY, items: addMenuItems({ dialog, toast, onDataChanged: refreshRepos }) });
  };

  const footEntry = (hash: string, icon: string, label: string) => (
    <button
      className={'trow' + (route.view === hash.replace('#/', '') ? ' active' : '')}
      onClick={() => onNavigate?.(hash)}
    >
      <span className="gico"><Icon name={icon} /></span>
      <span className="nm">{label}</span>
    </button>
  );

  return (
    <aside id="side">
      <div className="shead">
        {/* 品牌区 = 旧顶栏的家当：logo ＋ 标题 ＋ 设置/收起/关闭 */}
        <div className="brandrow">
          <span className="nx-logo" aria-hidden>nx</span>
          <span className="nx-title">nx-kv</span>
          <span className="grow" />
          <button
            className="iconbtn" title="设置（浮动面板）" aria-label="设置"
            onClick={() => shell?.openSettings()}
          >
            <Icon name="gear" size={15} />
          </button>
          {/* 收起入口放品牌行右侧——验收反馈「左能收起但没有收起 icon」：原先埋在搜索行，不显眼 */}
          <button
            className="iconbtn collapse"
            title="收起目录（变窄轨；点窄轨可展开）"
            aria-label="收起目录"
            onClick={onCollapse}
          >
            <Icon name="back" size={15} />
          </button>
          <button
            className="iconbtn collapse"
            title="关闭目录（完全隐藏，左缘把手可展开）"
            aria-label="关闭目录"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="searchrow">
          <label className="sbox">
            <Icon name="search" />
            <input
              value={kw}
              placeholder="搜索仓库（命中自动展开）"
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setKw(''); }}
            />
          </label>
          {kw && <span className="kwcount">{matchCount} 个匹配</span>}
          <button className="iconbtn add" title="添加目录 / 新建分组" aria-label="添加目录或新建分组" onClick={addMenu}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div
        id="tree"
        ref={treeRef}
        tabIndex={0}
        onKeyDown={onTreeKey}
        onDragOver={(e) => { if (dragRef.current?.type === 'repo') e.preventDefault(); }}
        onDrop={onTreeDropTail}
      >
        {rows.map((row, i) => (
          row.type === 'board' ? (
            <button
              key={'b:' + row.id}
              className={'trow group' + (isActive(row) ? ' active' : '') + (kbIndex === i ? ' kb-focus' : '')}
              onClick={() => openRow(row)}
              onContextMenu={(e) => openRowMenu(e, row)}
              draggable
              onDragStart={(e) => onDragStart(e, row)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, row)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, row)}
              data-drop={dropHint?.id === row.id ? dropHint?.zone : undefined}
              title={`${row.name} · ${row.count} 个目录\n${row.desc || '项目组：点进去操作组下的项目'}`}
            >
              {/* 组是叶子：占位只为了与其它行对齐，不给可展开的假提示 */}
              <span className="tw" aria-hidden />
              <span className="gico"><Icon name="folder" /></span>
              <span className="nm">
                {row.name}
                {row.waiting ? <span className="wdot" title="组内有 agent 等待回填" /> : null}
              </span>
              <span className="cnt" title={`待领取 ${row.pending} · 成员 ${row.count} 个`}>
                {row.pending > 0 ? row.pending : row.count}
              </span>
              <span
                className="more" role="button" tabIndex={-1} aria-label="看板菜单"
                onClick={(e) => openRowMenu(e, row)}
              >
                <Icon name="dots" size={13} />
              </span>
            </button>
          ) : (
            <div key={row.type + ':' + row.key} className="tblock">
              <button
                className={
                  'trow' + (row.type === 'repo' && row.groupId ? ' child' : '') +
                  (row.type === 'repo' && expanded.has(row.topicKey ?? '') ? ' open' : '') +
                  (isActive(row) ? ' active' : '') +
                  (row.pending > 0 ? ' pinned' : '') +
                  (kbIndex === i ? ' kb-focus' : '')
                }
                onClick={() => openRow(row)}
                onContextMenu={(e) => openRowMenu(e, row)}
                title={row.cwd ? `${row.name}\n${row.cwd}\n${row.desc || row.summary || ''}` : row.name}
                draggable
                onDragStart={(e) => onDragStart(e, row)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, row)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, row)}
                data-drop={dropHint?.id === row.key ? dropHint?.zone : undefined}
              >
                <span
                  className="tw" role="button" tabIndex={-1} aria-label="展开子任务"
                  onClick={(e) => { e.stopPropagation(); toggleRow(row); }}
                >
                  <Icon name="chevron" size={10} />
                </span>
                <span className="gico">
                  {row.icon ? <span className="trow-icon" aria-hidden>{row.icon}</span> : <Icon name={row.type === 'global' ? 'globe' : 'folder'} />}
                </span>
                <span className="nm">
                  {row.name}
                  {row.type === 'global' && row.waiting ? <span className="wdot" title="有等待中的主题" /> : null}

                </span>
                {row.pending > 0 && <span className="cnt">{row.pending}</span>}
                {row.type === 'repo' && row.waiting && <span className="wdot" title="agent 等待回填中" />}
                <span
                  className="more" role="button" tabIndex={-1} aria-label="行菜单"
                  onClick={(e) => openRowMenu(e, row)}
                >
                  <Icon name="dots" size={13} />
                </span>
              </button>
              {/* 展开键与 openRow 同源（topicKey，空则退仓库 key）——否则无队列仓库永远展不开 */}
              {(row.type === 'global' ? isActive(row) : expanded.has(row.topicKey || row.key)) && (
                <TaskChildren row={row} onNavigate={onNavigate} refreshLocal={refreshLocal} />
              )}
            </div>
          )
        ))}
        {!rows.length && <div className="tree-empty">{kw ? '没有匹配的仓库' : '还没有登记仓库：点右上 ＋ 登记，或去「仓库管理」'}</div>}
        <div className="droptail" aria-hidden="true" />
      </div>

      <div className="sfoot">
        {footEntry('#/overview', 'overview', '全部目录总览')}
        {footEntry('#/cloud', 'cloud', '云端总览')}
        {footEntry('#/repos', 'repo', '仓库管理')}
        {waitingCount > 0 && (
          <button className="trow" onClick={() => onNavigate?.('#/overview')} title="有 agent 正在等待回填">
            <span className="gico"><Icon name="warn" /></span>
            <span className="nm">{waitingCount} 个 agent 等待回填</span>
          </button>
        )}
      </div>

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dialogNode}
    </aside>
  );
}
