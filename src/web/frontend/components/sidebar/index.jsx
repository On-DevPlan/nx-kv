// 侧边栏（应用壳的左栏）：品牌区 + 搜索 + 树（全局池恒顶 → 看板 → 仓库）+ 底部入口。
// 收起态渲染为 52px 图标 rail（悬停气泡、徽标仍在）。
// 拖拽编排 = 三段式落点（drag.js）；可见序 = 渲染序，键盘导航走同一份扁平序。
//
// **数据源**：仓库登记 + 看板（真实数据，见 model.js）。侧边栏不持有自己的分组体系，
// 也不持有自己的目录清单——「目录」就是仓库登记里的开发仓库。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { PopMenu } from '../overlay.jsx';
import { useDialog, useToast } from '../ui.jsx';
import { buildTree } from './model.js';
import { canDrop, zoneOf, applyDrop } from './drag.js';
import { rowMenuItems, addMenuItems, cfgMenuItems } from './row-menu.jsx';
import TaskChildren from './task-children.jsx';

export default function Sidebar({
  repos,           // 开发仓库（type != ref）
  boards,          // 看板
  topics,          // 本机任务队列（按 cwd 匹配仓库）
  route,           // {view, key}
  onNavigate,      // (hash) => void
  boot,
  waitingCount,
  prefs,
  patchPrefs,      // (patch) => void（已持久化）
  refreshRepos,    // 仓库/看板刷新（登记、归属变更后）
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [kw, setKw] = useState('');
  const [menu, setMenu] = useState(null);      // {x,y,items}
  const [kbIndex, setKbIndex] = useState(-1);  // 键盘焦点行
  const [expanded, setExpanded] = useState(() => new Set()); // 展开子行的仓库 key
  const dragRef = useRef(null);                // {type,key|id,name}
  const [dropHint, setDropHint] = useState(null); // {key|id, zone}
  const treeRef = useRef(null);

  const { rows, matchCount } = useMemo(
    () => buildTree(repos, boards, topics, prefs, kw),
    [repos, boards, topics, prefs, kw]
  );

  const isActive = (row) => {
    if (row.type === 'global') return route.view === 'global';
    if (row.type === 'repo') return route.view === 'dir' && route.key === row.topicKey;
    return false;
  };

  // 当前路由所在仓库自动展开子行（深链 / 总览跳转进来也能看到层级）
  useEffect(() => {
    if (route.view !== 'dir' || !route.key) return;
    setExpanded((prev) => {
      if (prev.has(route.key)) return prev;
      const next = new Set(prev);
      next.add(route.key);
      return next;
    });
  }, [route.view, route.key]);

  const toggleExpanded = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 点击：看板 = 展开/收起成员；仓库 = 展开/收起子行（任务）；全局 = 进全局池。
  // 仓库行没有任务队列时（topicKey 为空）点击不导航——没有可打开的工作台。
  const openRow = useCallback(
    (row) => {
      if (row.type === 'board') {
        patchPrefs((p) => ({ groupOpen: { ...(p.groupOpen || {}), [row.id]: !row.open } }));
      } else if (row.type === 'global') {
        onNavigate('#/global');
      } else {
        toggleExpanded(row.topicKey || row.key);
      }
    },
    [onNavigate, patchPrefs, toggleExpanded]
  );

  // ─── 键盘导航：↑↓ 在可见行间移动（序 = 渲染序），Enter 打开，Esc 退出 ───
  const onTreeKey = (e) => {
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
      if (kbIndex >= 0 && rows[kbIndex]) openRow(rows[kbIndex]);
    } else if (e.key === 'Escape') {
      setKbIndex(-1);
    }
  };

  // ─── 拖拽编排 ───
  const onDragStart = (e, row) => {
    dragRef.current = { type: row.type, key: row.key, id: row.id, name: row.name };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.type + ':' + (row.key || row.id));
    e.currentTarget.classList.add('dragging');
  };
  const onDragEnd = (e) => {
    dragRef.current = null;
    setDropHint(null);
    e.currentTarget?.classList?.remove('dragging');
  };
  const onDragOver = (e, row) => {
    if (!dragRef.current) return;
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    if (canDrop(dragRef.current, row, zone)) {
      e.dataTransfer.dropEffect = 'move';
      setDropHint({ id: row.key || row.id, zone });
    } else {
      setDropHint(null);
    }
  };
  const onDragLeave = () => setDropHint((h) => (h ? null : h));
  const onDrop = (e, row) => {
    e.preventDefault();
    const drag = dragRef.current;
    dragRef.current = null;
    setDropHint(null);
    if (!drag) return;
    const zone = zoneOf(e, e.currentTarget);
    if (!canDrop(drag, row, zone)) return;
    patchPrefs(applyDrop(prefs, drag, row, zone));
  };
  const onTreeDropTail = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropHint(null);
    if (!drag || drag.type !== 'repo') return;
    e.preventDefault();
    const key = drag.key;
    const order = (prefs.order || []).filter((k) => k !== key);
    order.push(key);
    patchPrefs({ order });
  };

  // ─── 行菜单（菜单内容见 row-menu.jsx）───
  const openRowMenu = (e, row) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: rowMenuItems({ row, prefs, patchPrefs, onNavigate, boards, onDataChanged: refreshRepos }),
    });
  };

  // ─── 登记仓库 / 新建看板 ───
  const addMenu = (e) => {
    setMenu({ x: e.clientX, y: e.clientY, items: addMenuItems({ dialog, toast, onDataChanged: refreshRepos }) });
  };

  // ─── 设置气泡 ───
  const cfgMenu = (e) => {
    setMenu({ x: e.clientX, y: e.clientY, items: cfgMenuItems({ prefs, patchPrefs, onNavigate }) });
  };

  const footEntry = (hash, icon, label) => (
    <button
      className={'trow' + (route.view === hash.replace('#/', '') ? ' active' : '')}
      onClick={() => onNavigate(hash)}
    >
      <span className="gico"><Icon name={icon} /></span>
      <span className="nm">{label}</span>
    </button>
  );

  return (
    <aside id="side" className={prefs.folded ? 'folded' : ''}>
      <div className="shead">
        <div className="brandrow">
          <span className="logo">nx</span>
          <span className="t">nx-kv</span>
          <span className="v">面板 v2</span>
          <span className="grow" />
          <button className="iconbtn" title="侧边栏设置" aria-label="侧边栏设置" onClick={cfgMenu}>
            <Icon name="gear" size={15} />
          </button>
          <button
            className="iconbtn"
            title="收起侧边栏"
            aria-label="收起侧边栏"
            onClick={() => patchPrefs({ folded: true })}
          >
            <Icon name="back" size={15} />
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
              className={'trow group' + (row.open ? ' open' : '') + (kbIndex === i ? ' kb-focus' : '')}
              onClick={() => openRow(row)}
              onContextMenu={(e) => openRowMenu(e, row)}
              draggable
              onDragStart={(e) => onDragStart(e, row)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onDragOver(e, row)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, row)}
              data-drop={dropHint?.id === row.id ? dropHint.zone : undefined}
              title={row.desc || row.name}
            >
              <span className="tw"><Icon name="chevron" size={10} /></span>
              <span className="gico"><Icon name="folder" /></span>
              <span className="nm">{row.name}</span>
              <span className="cnt">{row.count}</span>
              <span
                className="more" role="button" tabIndex={-1} aria-label="看板菜单"
                onClick={(e) => openRowMenu(e, { ...row, open: row.open })}
              >
                <Icon name="dots" size={13} />
              </span>
            </button>
          ) : (
            <div key={row.type + ':' + row.key} className="tblock">
              <button
                className={
                  'trow' + (row.type === 'repo' && row.groupId ? ' child' : '') +
                  (row.type === 'repo' && expanded.has(row.topicKey) ? ' open' : '') +
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
                data-drop={dropHint?.id === row.key ? dropHint.zone : undefined}
              >
                <span className="tw"><Icon name="chevron" size={10} /></span>
                <span className="gico"><Icon name={row.type === 'global' ? 'globe' : 'folder'} /></span>
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
              {(row.type === 'global' ? isActive(row) : expanded.has(row.topicKey)) && (
                <TaskChildren row={row} onNavigate={onNavigate} />
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
        <button className={'trow' + (route.view === 'auth' ? ' active' : '')} onClick={() => onNavigate('#/auth')} title={boot?.configPath || ''}>
          <span className="gico"><Icon name={boot?.loggedIn ? 'check' : 'lock'} /></span>
          <span className="nm">{boot?.loggedIn ? '已登录' : '未登录 · 设置'}</span>
        </button>
        {waitingCount > 0 && (
          <button className="trow" onClick={() => onNavigate('#/overview')} title="有 agent 正在等待回填">
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
