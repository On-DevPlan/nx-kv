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
import { PopMenu, Modal } from '../popup/index.jsx';
import SearchRow from './search-row.js';
import BrandRow from './brand-row.js';
import { useToast } from '../toast/index.jsx';
import { useDialog } from '../popup/index.jsx';
import type { PopMenuItem } from '../popup/index.js';
import { api } from '../../api/client.js';
import RepoFormModal from '../../page/repos/repo-form-modal.jsx';
import { buildTree, fmtWaitLeft, fmtDeadlineClock } from './model.js';
import type { SideRow, SideTree } from './model.js';
import { canDrop, zoneOf, applyDrop } from './drag.js';
import type { DragRow, DropZone } from './drag.js';
import { rowMenuItems, addMenuItems } from './row-menu.jsx';
import { useSidebarNs } from './use-sidebar-ns.js';
import NsHeadRow from './ns-row.js';
import NsDialogs from './ns-dialogs.js';
import TaskChildren from './task-children.jsx';
import { ensureQueueAndGo } from './queue-nav.js';
import type { AppRoute, BoardRow, LocalTopic, Prefs, RepoRow, ShellApi } from '../../types.js';

/**
 * 行图标：按**行语义**取资产名（全库见 svghub 资产库）。
 * 以前组 / 仓库 / 参考仓库统统画文件夹，扫一眼分不出「这是哪类东西」；
 * 现在组=分支、开发仓库=盒子、参考仓库=带箭头的盒子，全局池=地球。
 */
function rowIcon(row: SideRow): string {
  if (row.type === 'board') return 'board';
  return row.repoType === 'ref' ? 'repo-ref' : 'repo';
}

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
export interface MenuState {
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
  // #193：「＋」菜单的两个入口各自的表单弹窗（对齐 repos 页，替代单输入对话框）
  const [repoFormOpen, setRepoFormOpen] = useState(false);
  const [boardForm, setBoardForm] = useState<{ name: string; desc: string } | null>(null);
  const [kbIndex, setKbIndex] = useState(-1);  // 键盘焦点行
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set()); // 展开子行的仓库 key
  const dragRef = useRef<DragRow | null>(null);                // {type,key|id,name}
  const [dropHint, setDropHint] = useState<{ id: string; zone: DropZone } | null>(null); // {key|id, zone}
  const treeRef = useRef<HTMLDivElement | null>(null);

  // 树模型：算崩了也**不能**让侧栏整块变空白（#194）——退回上一版成功的行，
  // 只在控制台留一条（不 toast：侧栏每秒都可能重算，刷屏比没提示更糟）。
  const lastTree = useRef<SideTree>({ rows: [], matchCount: 0 });
  const { rows, matchCount } = useMemo(() => {
    try {
      const t = buildTree(repos, boards, topics, prefs, kw);
      lastTree.current = t;
      return t;
    } catch (e) {
      console.error('[nx-kv] 侧栏树构建失败，沿用上一版行模型:', e);
      return lastTree.current;
    }
  }, [repos, boards, topics, prefs, kw]);
  // #167：折叠分区的条目行在渲染层跳过（model 输出是扁平序，折叠由这里收口——
  // 条目归属分区用「最近的 ns 头」判定，避免引入第二份数据）
  const hiddenByNs = useMemo(() => {
    const hiddenKeys = new Set<string>();
    let cur: string | null = null;
    let curCollapsed = false;
    for (const r of rows) {
      if (r.type === 'ns') {
        cur = r.key;
        curCollapsed = !!r.collapsed;
        continue;
      }
      if (cur && curCollapsed) hiddenKeys.add(r.type === 'board' ? 'board:' + String(r.id) : r.key);
    }
    return hiddenKeys;
  }, [rows]);

  // ─── 等待倒计时（#182）───
  // 等待标记要显示「还剩多久」，所以得有第二个时间源：只要有一行在等就每秒推进一次，
  // 一行都没等就把定时器停掉（空闲时不跑无意义的 setState）。
  const [nowMs, setNowMs] = useState(() => Date.now());
  const anyWaiting = useMemo(() => rows.some((r) => r.waiting && r.waitingDeadlineMs), [rows]);
  useEffect(() => {
    if (!anyWaiting) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyWaiting]);

  /**
   * 等待标记 = 圆点 + 倒计时（「剩 4:32」）。hover 给完整口径：
   * 谁在等 + 剩多久 + 截止钟点（倒计时看趋势，钟点看绝对时间）。
   * 放在 `.nm` **外面**——行名是 ellipsis 容器，塞进去窄栏会被截掉。
   */
  const waitTag = (row: SideRow, tip: string) => {
    if (!row.waiting) return null;
    const left = fmtWaitLeft(row.waitingDeadlineMs, nowMs);
    const clock = fmtDeadlineClock(row.waitingDeadlineMs);
    return (
      <span className="wtimer" title={clock ? `${tip} · 剩至 ${clock}` : tip}>
        <span className="wdot" aria-hidden />
        {left ? <span className="wleft">{left}</span> : null}
      </span>
    );
  };

  const isActive = (row: SideRow) => {
    if (row.type === 'repo') return route.view === 'dir' && route.key === row.topicKey;
    if (row.type === 'board') return route.view === 'group' && route.key === row.id;
    return false;
  };

  // 当前路由所在仓库 / 组自动展开子行（深链 / 总览跳转进来也能看到层级）
  useEffect(() => {
    const key = route.key;
    if (!key) return;
    const id = route.view === 'dir' ? key : route.view === 'group' ? 'board:' + key : '';
    if (!id) return;
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
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

  // #178：分区装配（操作 + 成员选择弹窗 + 候选）全部收在 use-sidebar-ns（纯显示态）
  const nsOps = useSidebarNs({ patchPrefs, toast, dialog, setMenu, repos, boards, namespaces: prefs.namespaces });
  const { nsForm, setNsForm, addFor, setAddFor, candidatesFor, manageOpen, setManageOpen, observeOpen, setObserveOpen, labelOf, setFocusNs, moveNs, removeNs, renameNs, newNsAndMove, addToNs, dropToCurrent, openNsMenu, toggleNsCollapse, moveToNs, removeFromNs } = nsOps;

  // 点击：看板 = 进组视图（成员仍在组面板里下拉选择，树里不铺成员仓库；
  // 但 chevron 可展开**本组任务**子行，与仓库行的任务子行同构）；
  // 仓库 = 进目录（子任务表）；全局 = 进全局池。
  // 仓库行没有任务队列时（topicKey 为空）点行 = 先建队列再进（与「新建页」同一套）。
  const openRow = useCallback(
    (row: SideRow) => {
      if (row.type === 'board') {
        onNavigate?.('#/group/' + encodeURIComponent(String(row.id)));
      } else if (row.topicKey) {
        onNavigate?.('#/dir/' + encodeURIComponent(row.topicKey));
      } else {
        ensureQueueAndGo({ row, onNavigate, refreshLocal, toast });
      }
    },
    [onNavigate, refreshLocal, toast]
  );

  // chevron：展开/收起（仓库 = 项目任务；组 = 本组任务，均按 topicKey / board id 记）
  const toggleRow = useCallback(
    (row: SideRow) => {
      // #251：仓库行 / 组行都可展开（按 topicKey / board id 记）；#190 全局池行已删除
      toggleExpanded(
        row.type === 'board' ? 'board:' + String(row.id || row.key) : (row.topicKey || row.key)
      );
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
      items: rowMenuItems({
        row, prefs, patchPrefs, onNavigate, boards,
        onDataChanged: refreshRepos, refreshLocal, toast, dialog,
        namespaces: prefs.namespaces, onMoveToNs: moveToNs, onRemoveFromNs: removeFromNs,
        onNewNsFor: (r) => setNsForm({ id: '', name: '', moveTo: r.type === 'board' ? 'board:' + String(r.id) : String(r.key || '') }),
      }),
    });
  };

  // ─── 登记仓库 / 新建看板（#193：对齐 repos 页——仓库走同款表单弹窗，看板带初始描述）───
  const addMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: addMenuItems({
        onAddRepo: () => setRepoFormOpen(true),
        onNewBoard: () => setBoardForm({ name: '', desc: '' }),
        onNewNs: () => setNsForm({ id: '', name: '' }),
      }),
    });
  };

  const saveBoard = async () => {
    if (!boardForm || !boardForm.name.trim()) return;
    try {
      await api('/api/boards', { method: 'POST', body: { name: boardForm.name.trim(), desc: boardForm.desc.trim() } });
      toast('已新建看板 ' + boardForm.name.trim());
      setBoardForm(null);
      await refreshRepos?.();
    } catch (err) {
      toast('新建失败: ' + (err as Error).message);
    }
  };

  // 一份清单都没读到（#194：这两份清单是侧栏树的全部原料，空 = 树只剩提示）
  const noData = !(repos || []).length && !(boards || []).length;

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
        <BrandRow
          namespaces={prefs.namespaces}
          focusNs={String((prefs as any).focusNs || '')}
          onFocusNs={setFocusNs}
          onNewNs={() => setNsForm({ id: '', name: '' })}
          onManage={() => setManageOpen(true)}
          onAddCurrent={() => {
            const list = prefs.namespaces || [];
            const cur = String((prefs as any).focusNs || '') || list[0]?.id || '';
            if (cur) setAddFor(cur);
          }}
          onDropHere={(key) => { dropToCurrent(key, String((prefs as any).focusNs || '')); toast('已加入当前命名空间'); }}
          shell={shell}
          onCollapse={onCollapse}
          onClose={onClose}
        />
        <SearchRow
          kw={kw}
          onKw={setKw}
          matchCount={matchCount}
          onAddMenu={addMenu}
          onMore={() => setObserveOpen(true)}
        />
      </div>

      <div
        id="tree"
        ref={treeRef}
        tabIndex={0}
        onKeyDown={onTreeKey}
        onDragOver={(e) => { if (dragRef.current?.type === 'repo') e.preventDefault(); }}
        onDrop={onTreeDropTail}
      >
        {rows.map((row, i) => {
          // #167：折叠分区内的条目行直接不出（计数在 ns 头上仍可见）
          const rowKey = row.type === 'board' ? 'board:' + String(row.id) : row.key;
          if ((row.type === 'repo' || row.type === 'board') && hiddenByNs.has(rowKey)) return null;
          // 组行也可展开（与仓库行同构）：expanded 里用 `board:<id>` 前缀，不与 topicKey 混
          const boardOpen = row.type === 'board' && expanded.has('board:' + String(row.id || row.key));
          return (
          row.type === 'ns' ? (
            <NsHeadRow
              row={row}
              kbFocus={kbIndex === i}
              dropHint={dropHint}
              onOpen={() => toggleNsCollapse(row.key)}
              onToggle={() => toggleNsCollapse(row.key)}
              onAdd={() => setAddFor(row.key)}
              onMenu={(e) => openNsMenu(e, row)}
              onDragStart={(e) => onDragStart(e, row)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, row)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, row)}
            />
          ) : row.type === 'board' ? (
            <div className="tblock" key={(row as any).nsId ? `${(row as any).nsId}:b:${row.id}` : 'b:' + row.id}>
              <button
                className={'trow group' + (isActive(row) ? ' active' : '') + (boardOpen ? ' open' : '') + (kbIndex === i ? ' kb-focus' : '')}
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
                <span
                  className="tw" role="button" tabIndex={-1} aria-label="展开本组任务"
                  title="展开 / 收起本组任务（只列 frontmatter.board 指向本组的任务）"
                  onClick={(e) => { e.stopPropagation(); toggleRow(row); }}
                >
                  <Icon name="chevron" size={10} />
                </span>
                <span className="gico"><Icon name="board" /></span>
                <span className="nm">{row.name}</span>
                {waitTag(row, '组内有 agent 等待回填')}
                <span className="cnt" title={`待领取 ${row.pending} · 成员 ${row.count} 个`}>
                  {row.pending > 0 ? row.pending : row.count}
                </span>
                <span className="more" role="button" tabIndex={-1} aria-label="看板菜单"
                  onClick={(e) => openRowMenu(e, row)}>
                  <Icon name="dots" size={13} />
                </span>
              </button>
              {boardOpen && (
                <TaskChildren row={row} onNavigate={onNavigate} refreshLocal={refreshLocal} />
              )}
            </div>
          ) : (
            <div key={(row as any).nsId ? `${(row as any).nsId}:${row.type}:${row.key}` : row.type + ':' + row.key} className="tblock">
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
                  {row.icon ? <span className="trow-icon" aria-hidden>{row.icon}</span> : <Icon name={rowIcon(row)} />}
                </span>
                <span className="nm">
                  {row.name}
                </span>
                {row.pending > 0 && <span className="cnt">{row.pending}</span>}
                {waitTag(row, 'agent 等待回填中')}
                <span
                  className="more" role="button" tabIndex={-1} aria-label="行菜单"
                  onClick={(e) => openRowMenu(e, row)}
                >
                  <Icon name="dots" size={13} />
                </span>
              </button>
              {/* 展开键与 openRow 同源（topicKey，空则退仓库 key）——否则无队列仓库永远展不开 */}
              {expanded.has(row.topicKey || row.key) && (
                <TaskChildren row={row} onNavigate={onNavigate} refreshLocal={refreshLocal} />
              )}
            </div>
          )
          );
        })}
        {!rows.length && (
          <div className="tree-empty">
            {kw
              ? '没有匹配的仓库'
              : noData ? (
                // 行模型为空时的**唯一**线索：原先是句静态提示，数据读不到时用户只看到一片空白
                // （#194）。给一个可点的重试——仓库/看板两份清单任一失败都还能自愈。
                <button className="trow" title="重新读取仓库与看板清单" onClick={() => refreshRepos?.()}>
                  <span className="gico"><Icon name="repo" /></span>
                  <span className="nm">清单没读到 · 点这里重试</span>
                </button>
              ) : (
                // #174：有数据但一行都出不来 = 当前视图（分区 / 运行中）里没有条目，给出路
                '当前视图没有条目：顶上切回「全部分区」，或把仓库拖进一个分区'
              )}
          </div>
        )}
        <div className="droptail" aria-hidden="true" />
      </div>

      <div className="sfoot">
        {footEntry('#/templates', 'list', '任务模板')}
        {footEntry('#/repos', 'repo', '仓库管理')}
      </div>

      {menu && <PopMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {/* #193：登记仓库 = repos 页同款表单（路径探测 / key 归一 / 名称与描述齐备） */}
      {repoFormOpen ? (
        <RepoFormModal
          editing={null}
          repos={(repos || []) as unknown as Parameters<typeof RepoFormModal>[0]['repos']}
          onClose={() => setRepoFormOpen(false)}
          onSaved={() => refreshRepos?.()}
        />
      ) : null}
      {/* #193：新建看板 = 分组管理同款字段（名称 + 初始描述） */}
      {boardForm ? (
        <Modal title="新建看板（项目组）" onClose={() => setBoardForm(null)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="sb-board-name">名称</label>
              <input
                id="sb-board-name"
                value={boardForm.name}
                spellCheck="false"
                placeholder="看板名，如 前端 / nx 家族"
                onChange={(e) => setBoardForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="sb-board-desc">初始描述</label>
              <textarea
                id="sb-board-desc"
                rows={3}
                spellCheck="false"
                placeholder={'新建时给的介绍正文（之后在组介绍文档里继续维护）。'}
                value={boardForm.desc}
                onChange={(e) => setBoardForm((f) => (f ? { ...f, desc: e.target.value } : f))}
              />
            </div>
            <div className="form-acts">
              <button type="button" className="btn ghost" onClick={() => setBoardForm(null)}>取消</button>
              <button type="button" className="btn" disabled={!boardForm.name.trim()} onClick={saveBoard}>新建看板</button>
            </div>
          </div>
        </Modal>
      ) : null}
      <NsDialogs
        form={nsForm}
        onFormClose={() => setNsForm(null)}
        onSave={(id, name, moveKey) => {
          if (id === '@@edit') { if (nsForm && name.trim()) setNsForm({ ...nsForm, name }); return; }
          if (id) renameNs(id, name); else newNsAndMove(name, moveKey);
        }}
        addFor={addFor}
        addNsName={(prefs.namespaces || []).find((n) => n.id === addFor)?.name || ''}
        addCandidates={addFor ? candidatesFor(addFor) : []}
        onAddClose={() => setAddFor(null)}
        onAdd={(keys) => { if (addFor) addToNs(addFor, keys); toast(`已添加 ${keys.length} 项到命名空间`); }}
        manageOpen={manageOpen}
        namespaces={prefs.namespaces || []}
        focusNs={String((prefs as any).focusNs || '')}
        onManageClose={() => setManageOpen(false)}
        onRenameNs={(id, name) => renameNs(id, name)}
        onMoveNs={(id, d) => moveNs(id, d)}
        onRemoveNs={(id) => removeNs(id)}
        onNewNs={() => setNsForm({ id: '', name: '' })}
        onFocusNs={(id) => setFocusNs(id)}
        observeOpen={observeOpen}
        onObserveClose={() => setObserveOpen(false)}
        labelOf={labelOf}
      />
      {dialogNode}
    </aside>
  );
}
