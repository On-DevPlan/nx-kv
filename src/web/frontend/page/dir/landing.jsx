// 目录落地页 = 简介 + 子任务表。
// 简介由统一组件 Introduction 负责（与项目组同构：显示 / 编辑 / 补 ref）。
//
// 任务表：显示序**未完成优先**、长度**分页**（队列长了翻页，不一次渲染全部）。
// 分页与计数由容器（page/dir/index.jsx）算好传进来——本页只负责画。
// 编排（#40）：待领取行可**拖动排序**（落点前/后，走 localtask reorder）、
// 行尾「⋮」菜单开**编排编辑器**（闸门 / 上下游依赖）；已领取行是固定历史，不可拖。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useRef, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import Pager from '../../components/pager.jsx';
import { RowMenu } from '../../components/popup/index.jsx';
import { titleFromMd } from '../../modules/md/md-parse.js';

function shortTime(v) {
  const s = String(v || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return m ? `${m[1].slice(5)} ${m[2]}` : s.slice(0, 16);
}

export default function Landing({
  isGlobal,
  topic,
  repo = null,
  model = null,
  tasks = [],
  taskCount = 0,
  pendingCount = 0,
  page = 0,
  pageCount = 1,
  onPage,
  onNew,
  onOpenTask,
  onDeleteTask,
  onReopenTask,
  onTplMenu,
  onImport,
  onProg,
  onMoveTask,      // (t, targetId, 'before'|'after') 拖动排序落盘
  onOpenDag,       // (t) 打开编排编辑器
  onOpenFlow,      // () 打开可视化编排面板（绿色超链入口）
  onToggleGate,    // (t) 闸门快捷开关
  downstreamOf,    // { [gateTaskId]: number[] } 闸门挡住的后续任务 id
}) {
  const name = isGlobal ? '全局池' : (topic?.name || '目录');
  const path = isGlobal ? '共享池（无固定目录）' : (topic?.cwd || '—');
  const status = String(topic?.summary || '').trim();

  // 拖动排序（HTML5 DnD）：只在待领取行之间换位，落点 = 上半行之前 / 下半行之后。
  // 拖拽态走 **ref**（同步可读）——dragstart/dragover 在真实拖拽里也只隔几毫秒，
  // state 那一拍渲染延迟会让 onDragOver 读到旧值直接 return（与侧栏 drag.js 同一教训）。
  const dragRef = useRef(null);               // { id }
  const [dragId, setDragId] = useState(null); // 仅视觉：正在拖的行
  const [dropAt, setDropAt] = useState(null); // 仅视觉：{ id, zone }
  const movable = (t) => t.status !== 'consumed' && !t.migratedTo && !t.deletedAt;
  const zoneOf = (e, tr) => {
    const r = tr.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e, t) => {
    dragRef.current = { id: Number(t.id) };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + t.id);
    setDragId(Number(t.id));
  };
  const onDragOver = (e, t) => {
    if (!dragRef.current || !movable(t) || Number(t.id) === dragRef.current.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropAt({ id: Number(t.id), zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e) => {
    // 行内 td 之间移动也会触发 dragleave：只有真正离开整行才清指示
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = (e, t) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || !movable(t) || Number(t.id) === drag.id) return;
    onMoveTask && onMoveTask({ id: drag.id }, t.id, zone);
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
  };

  return (
    <div className="mdw-land">
      <RouteBreadcrumb />
      <div className="mdw-land-head">
        <div className="mdw-land-name">{name}</div>
        <div className="mdw-land-path mono" title={path}>{path}</div>
        {status ? (
          <div className="mdw-land-status-line" title={status}>
            <span className="mdw-land-lab">现状</span>
            <span className="mdw-land-status">{status}</span>
          </div>
        ) : null}
      </div>

      {!isGlobal && repo ? <Introduction kind="repo" owner={repo} model={model} /> : null}

      <div className="mdw-land-acts">
        <button type="button" className="btn sm primary" onClick={onNew}>＋ 新建页</button>
        <button
          type="button"
          className="btn ghost sm"
          title="按模板新建一页（末尾「管理模板…」打开任务模板面板）"
          aria-haspopup="menu"
          onClick={(e) => onTplMenu?.(e)}
        >
          模板 ▾
        </button>
        {onImport && (
          <button type="button" className="btn ghost sm" title="把一个 .md 文件导入成任务" onClick={onImport}>
            导入
          </button>
        )}
        {onProg && (
          <button
            type="button"
            className="btn ghost sm"
            title="打开这个目录的进程面板（可拖到任意一边、可浮出）"
            onClick={onProg}
          >
            进程
          </button>
        )}
        <span className="mdw-land-count">
          {pendingCount > 0 && <b className="mdw-land-pending">{pendingCount} 待领取</b>}
          {' '}
          {taskCount} 个任务
        </span>
        {onOpenFlow && (
          <span
            className="dag-link mdw-land-orch"
            role="button"
            tabIndex={-1}
            title="打开可视化编排面板：拖拽排序、连线建立依赖、设闸门、加时间目标"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFlow();
            }}
          >
            编排
          </span>
        )}
      </div>

      <div className="mdw-land-table-wrap">
        <table className="mdw-land-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '56px' }}>#</th>
              <th scope="col">任务</th>
              <th scope="col" style={{ width: '74px' }}>状态</th>
              <th scope="col" style={{ width: '116px' }}>创建</th>
              <th scope="col" style={{ width: '116px' }}>领取</th>
              <th scope="col" style={{ width: '56px' }} />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const movableRow = movable(t);
              const downs = (downstreamOf && downstreamOf[t.id]) || [];
              return (
                <tr
                  key={t.id}
                  className={
                    'mdw-land-tr'
                    + (dragId === Number(t.id) ? ' dragging' : '')
                    + (dropAt && dropAt.id === Number(t.id) ? ' drop-' + dropAt.zone : '')
                  }
                  draggable={movableRow}
                  onDragStart={(e) => movableRow && onDragStart(e, t)}
                  onDragOver={(e) => onDragOver(e, t)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, t)}
                  onDragEnd={onDragEnd}
                  onClick={() => onOpenTask(t.id)}
                >
                  <td className="mono faint" title={movableRow ? '拖动整行可调整队列顺序' : undefined}>#{t.id}</td>
                  <td className="tx">
                    <div className="mdw-tg-row">
                      <span className="mdw-tg-title">{titleFromMd(t.text)}</span>
                      {t.timegoal?.duration ? (
                        <span
                          className="mdw-tg"
                          title={`时间目标 ${t.timegoal.duration}（领取即计时，未到点不许标完成）${t.timegoal.prompt ? `\n附加要求：${t.timegoal.prompt}` : ''}`}
                        >
                          ⏱ {t.timegoal.duration}
                        </span>
                      ) : null}
                      {t.blocksFollowing ? (
                        <span
                          className="mdw-tg"
                          title={
                            downs.length
                              ? `闸门：未完成前挡住 ${downs.length} 个后续任务（#${downs.join(', #')}）`
                              : '闸门：未完成前挡住队列里排在后面的待领取任务'
                          }
                        >
                          闸门{downs.length ? `×${downs.length}` : ''}
                        </span>
                      ) : null}
                      {t.status !== 'consumed' && t.ready === false ? (
                        <span
                          className="mdw-tg"
                          title={t.blockBy?.length ? `等待依赖完成：#${t.blockBy.join(', #')}` : '被前方闸门挡住'}
                        >
                          锁定
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span className={'st' + (t.status === 'consumed' ? ' done' : t.from ? ' run' : '')}>
                      {t.status === 'consumed' ? '完' : (t.from ? '跑' : '等')}
                    </span>
                  </td>
                  <td className="mono faint">{shortTime(t.createdAt)}</td>
                  <td className="mono faint">{t.consumedAt ? shortTime(t.consumedAt) : '—'}</td>
                  <td className="act">
                    <span className="act-ops">
                      {movableRow && (onOpenDag || onToggleGate) && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <RowMenu
                            items={[
                              { label: '编排依赖…', onPick: () => onOpenDag && onOpenDag(t) },
                              {
                                label: t.blocksFollowing ? '取消闸门（不再挡后续）' : '设为闸门（挡住后续）',
                                onPick: () => onToggleGate && onToggleGate(t),
                              },
                            ]}
                          />
                        </span>
                      )}
                      {onReopenTask && (t.status === 'consumed' || t.completedAt) && (
                        <span
                          className="op" role="button" tabIndex={-1}
                          title={t.completedAt ? '重做（验收反馈）：任务回到待领取，agent 可再次领取' : '反馈修改：任务回到待领取，agent 可再次领取'}
                          aria-label={`重开 ${titleFromMd(t.text)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onReopenTask(t);
                          }}
                        >
                          <Icon name="refresh" size={12} />
                        </span>
                      )}
                      {onDeleteTask && (
                        <span
                          className="op danger" role="button" tabIndex={-1}
                          title="删除此任务（软删除，CLI 可恢复）"
                          aria-label={`删除 ${titleFromMd(t.text)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteTask(t);
                          }}
                        >
                          <Icon name="x" size={12} />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {!tasks.length && (
              <tr>
                <td colSpan="6">
                  <div className="mdw-land-empty">
                    还没有页面：点「＋ 新建页」写第一篇，或让 agent 往{isGlobal ? '全局池' : '这个目录'}投递任务。
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 队列长了翻页看（以前一次渲染全部，队列一长就是一堵墙） */}
      {taskCount > 0 && (
        <div className="mdw-land-pager">
          <Pager
            page={page}
            pageCount={pageCount}
            total={taskCount}
            onPage={onPage}
            unit="个任务"
          />
        </div>
      )}
    </div>
  );
}
