// 侧边栏（应用壳的左栏）：品牌区 + 搜索 + 树 + 底部入口。收起态渲染 52px 图标 rail。
//
// **树里有两种东西**（见 model.js）：
//   资产 = 项目（仓库登记）与项目组（看板）——两者并列，谁也不装谁；
//   收纳盒 = 纯显示层的格子（prefs.groups），把资产摆在一起，不参与数据。
// 拖拽只改显示编排（收纳盒 + 顺序）；「这条仓库属于哪个项目组」是数据，走行菜单。
//
// 拖拽编排 = 三段式落点（drag.js）；可见序 = 渲染序，键盘导航走同一份扁平序。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons.jsx';
import { PopMenu } from '../overlay.jsx';
import { useDialog, useToast } from '../ui.jsx';
import { buildTree, rKey } from './model.js';
import { canDrop, zoneOf, applyDrop, rKeyOf } from './drag.js';
import { rowMenuItems, addMenuItems, cfgMenuItems } from './row-menu.jsx';
import TaskChildren from './task-children.jsx';

export default function Sidebar({
  repos,           // 开发仓库（type != ref）
  boards,          // 项目组（看板）
  topics,          // 本机任务队列（按 cwd 匹配仓库）
  route,           // {view, key}
  onNavigate,      // (hash) => void
  waitingCount,
  prefs,
  patchPrefs,      // (patch) => void（已持久化）
  refreshRepos,    // 仓库/项目组刷新（登记、归属变更后）
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [kw, setKw] = useState('');
  const [menu, setMenu] = useState(null);      // {x,y,items}
  const [kbIndex, setKbIndex] = useState(-1);  // 键盘焦点行
  const [expanded, setExpanded] = useState(() => new Set()); // 展开子行的仓库 key（任务队列）
  const dragRef = useRef(null);                // {type,key,id,groupKey,name}
  const [dropHint, setDropHint] = useState(null); // {id, zone}
  const treeRef = useRef(null);

  const { rows, matchCount } = useMemo(
    () => buildTree(repos, boards, topics, prefs, kw),
    [repos, boards, topics, prefs, kw]
  );

  const isActive = (row) => {
    if (row.type === 'global') return route.view === 'global';
    if (row.type === 'repo') {
      // 详情页（#/repo/<key>）或它自己的工作台（#/dir/<topicKey>）都算选中
      if (route.view === 'repo' && route.key === (row.key || row.id)) return true;
      return route.view === 'dir' && !!row.topicKey && route.key === row.topicKey;
    }
    if (row.type === 'board') {
      // 项目组没有独立页面：点它 = 去仓库页筛选到这一组（成员 + 组级参考都在那儿）
      const m = /[?&]board=([^&]+)/.exec(typeof location !== 'undefined' ? location.hash || '' : '');
      return route.view === 'repos' && !!m && decodeURIComponent(m[1]) === row.id;
    }
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

  // 点击：收纳盒 = 展开/收起；项目组 = 去仓库页筛到它；**项目 = 进详情页**；
  // 全局 = 进全局池。
  //
  // 项目行以前是「展开任务子行」，于是没有队列的仓库（topicKey 空）**点了没反应**。
  // 现在行点击一律有去处：详情页拿得到仓库信息（desc / md 列表 / key / 远程 / 项目组）
  // 和它的相关任务；要看任务子行点左边那个箭头（openChildren）。
  const openRow = useCallback(
    (row) => {
      if (row.type === 'group') {
        patchPrefs((p) => ({ groupOpen: { ...(p.groupOpen || {}), [row.id]: !row.open } }));
      } else if (row.type === 'board') {
        onNavigate('#/repos?board=' + encodeURIComponent(row.id));
      } else if (row.type === 'global') {
        onNavigate('#/global');
      } else {
        onNavigate('#/repo/' + encodeURIComponent(row.key || row.id));
      }
    },
    [onNavigate, patchPrefs]
  );

  // 箭头 = 只展开/收起任务子行（没有队列的仓库没有子行，箭头也不画）
  const openChildren = useCallback(
    (e, row) => {
      e.stopPropagation();
      if (row.topicKey) toggleExpanded(row.topicKey);
    },
    [toggleExpanded]
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
  // 携带 groupId：从收纳盒里拖出来要能判断「原来在哪个盒子」（drag.js 用它决定取出）
  const onDragStart = (e, row) => {
    dragRef.current = {
      type: row.type,
      key: row.key,
      id: row.id,
      name: row.name,
      groupId: row.groupId || '',
    };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', rKeyOf(row));
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
      setDropHint({ id: rKeyOf(row), zone });
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
    // 渲染序作基准：稀疏 order 里找不到目标也能算落点（见 drag.js 注释）
    patchPrefs(applyDrop(prefs, drag, row, zone, rows.map(rKey)));
  };
  // 拖到树空白处 = 移到顶层末尾（从盒子里拖出来最顺手的落点）
  const onTreeDropTail = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDropHint(null);
    if (!drag) return;
    e.preventDefault();
    patchPrefs(applyDrop(prefs, drag, { type: 'tail', name: '（末尾）' }, 'after', rows.map(rKey)));
  };

  // ─── 行菜单（菜单内容见 row-menu.jsx）───
  const openRowMenu = (e, row) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: rowMenuItems({
        row, prefs, patchPrefs, onNavigate, boards,
        onDataChanged: refreshRepos,
        dialog,
      }),
    });
  };

  // ─── 登记仓库 / 新建项目组 / 新建收纳组 ───
  const addMenu = (e) => {
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: addMenuItems({ dialog, toast, patchPrefs, onDataChanged: refreshRepos }),
    });
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

  // 一行 = 收纳盒 / 项目组 / 项目 / 全局池。四者共用外壳，差别只在图标、徽标与点击行为。
  const rowIcon = (row) =>
    row.type === 'group' ? 'archive'
      : row.type === 'board' ? 'repo'
        : row.type === 'global' ? 'globe' : 'folder';

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
              placeholder="搜索项目 / 项目组（命中自动展开）"
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setKw(''); }}
            />
          </label>
          {kw && <span className="kwcount">{matchCount} 个匹配</span>}
          <button className="iconbtn add" title="登记项目 / 新建项目组 / 新建收纳组" aria-label="添加" onClick={addMenu}>
            <Icon name="plus" />
          </button>
        </div>
      </div>

      <div
        id="tree"
        ref={treeRef}
        tabIndex={0}
        onKeyDown={onTreeKey}
        onDragOver={(e) => { if (dragRef.current) e.preventDefault(); }}
        onDrop={onTreeDropTail}
      >
        {rows.map((row, i) => {
          const id = rKey(row);
          const expandable = row.type === 'repo' && !!row.topicKey;
          const open = row.type === 'group' ? row.open
            : row.type === 'repo' ? expanded.has(row.topicKey) : false;
          const cls = [
            'trow',
            row.type === 'group' ? 'group-box' : '',
            row.type === 'board' ? 'asset board' : '',
            row.nested ? 'child' : '',
            open ? 'open' : '',
            isActive(row) ? 'active' : '',
            row.pending > 0 ? 'pinned' : '',
            kbIndex === i ? 'kb-focus' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={row.type + ':' + (row.itemId || row.key || row.id)} className="tblock">
              <button
                className={cls}
                onClick={() => openRow(row)}
                onContextMenu={(e) => openRowMenu(e, row)}
                title={(() => {
                  const docs = (row.docs || []).length ? `\nmd：${row.docs.join('、')}` : '';
                  if (row.type === 'repo' && row.cwd) {
                    return `${row.name}\n${row.cwd}\n${row.desc || row.summary || ''}${docs}`;
                  }
                  return row.desc ? `${row.name}\n${row.desc}${docs}` : row.name + docs;
                })()}
                draggable
                onDragStart={(e) => onDragStart(e, row)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, row)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, row)}
                data-drop={dropHint?.id === id ? dropHint.zone : undefined}
              >
                <span
                  className={'tw' + (expandable ? ' clickable' : '')}
                  role={expandable ? 'button' : undefined}
                  tabIndex={-1}
                  aria-label={expandable ? '展开任务' : undefined}
                  onClick={expandable ? (e) => openChildren(e, row) : undefined}
                >
                  {(expandable || row.type === 'group') ? <Icon name="chevron" size={10} /> : null}
                </span>
                <span className="gico"><Icon name={rowIcon(row)} /></span>
                <span className="nm">
                  {row.name}
                  {row.type === 'global' && row.waiting ? <span className="wdot" title="有等待中的主题" /> : null}
                </span>
                {row.pending > 0 && <span className="cnt">{row.pending}</span>}
                {row.type === 'board' && row.count > 0 && (
                  <span className="cnt" title={`${row.count} 个成员${row.missing ? `，其中 ${row.missing} 个本地还没有` : ''}`}>
                    {row.count}
                    {row.missing ? <em className="cnt-miss">{row.missing}</em> : null}
                  </span>
                )}
                {row.type === 'repo' && row.waiting && <span className="wdot" title="agent 等待回填中" />}
                <span
                  className="more" role="button" tabIndex={-1} aria-label="行菜单"
                  onClick={(e) => openRowMenu(e, row)}
                >
                  <Icon name="dots" size={13} />
                </span>
              </button>
              {(row.type === 'global' ? isActive(row) : expandable && expanded.has(row.topicKey)) && (
                <TaskChildren row={row} onNavigate={onNavigate} />
              )}
            </div>
          );
        })}
        {!rows.length && (
          <div className="tree-empty">
            {kw ? '没有匹配的项目' : '还没有登记项目：点右上 ＋ 登记，或去「仓库管理」'}
          </div>
        )}
        <div className="droptail" aria-hidden="true" />
      </div>

      <div className="sfoot">
        {footEntry('#/overview', 'overview', '全部目录总览')}
        {footEntry('#/cloud', 'cloud', '云端总览')}
        {footEntry('#/repos', 'repo', '仓库管理')}
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
