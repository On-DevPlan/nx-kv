// 项目组详情（#/group/<看板 id>）：组是**操作单元**，不是树里的一层文件夹。
//
// 本页就是**本组任务面板**（2026-11-03）：一列列出全部「在本组创建」的任务——
// 任务正文头部带 frontmatter（board/project，提交时自动写入，携带工作组语义），
// 每条用项目 tag 标出归属；「新增任务」进 MD 编辑页，工具区选归属项目（限本组成员），
// 提交按 frontmatter.project 路由进对应项目的队列。成员名册表格已移除（成员管理在仓库页）。
//
// 编排（#40）：组任务横跨多个成员队列；待领取行可拖动排序（同目录页）——
// reorder API 按 topic，故只允许拖到**同一成员队列**的落点；跨项目落点会提示。
// 组介绍与项目介绍共用 Introduction（显示 / 编辑 / 补 ref）。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/toast/index.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import { taskLabel } from '../../components/sidebar/model.js';
import StatusTag from '../../components/status-tag/index.jsx';
import { useApp } from '../../app-context.jsx';
import { api } from '../../api/client.js';
import { openPanel } from '../../workspace.js';
import { openTemplateEditor } from '../../panels.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { NEW_TEMPLATE_VALUES, parseFrontmatter, withFrontmatter } from '../../modules/md/md-parse.js';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';
import { useTemplates, useTemplatesFor } from '../../modules/md/use-templates.js';

export default function GroupView({ dirKey, rows, repoData, model }) {
  const toast = useToast();
  const { node: dialogNode } = useDialog();
  const app = useApp() || {};
  const tpl = useTemplates();
  const boards = (repoData && repoData.boards) || [];
  const repos = (repoData && repoData.repos) || [];
  const topics = rows || [];
  // 手选的项目 key（空 = 跟随默认）；换组时键不在新成员表里，自动回默认
  // 已领取历史折叠态
  const [showDone, setShowDone] = useState(false);
  // 「添加成员」就地弹窗（不跳仓库管理页——组面板里就地改归属）
  const [addOpen, setAddOpen] = useState(false);
  // 「＋ 新增任务 ▾」（#131/#132）：点击开合；portal + fixed 防组页矮容器裁切出滚动条。
  const [tplFlyOpen, setTplFlyOpen] = useState(false);
  const [tplFlyPos, setTplFlyPos] = useState(null); // { top, right } 视口坐标
  const newtaskRef = useRef(null);
  const tplFlyRef = useRef(null);
  useEffect(() => {
    if (!tplFlyOpen) return undefined;
    const onDoc = (e) => {
      if (newtaskRef.current?.contains(e.target) || tplFlyRef.current?.contains(e.target)) return;
      setTplFlyOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setTplFlyOpen(false);
    };
    const onReposition = () => {
      const btn = newtaskRef.current?.querySelector('button');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuH = tplFlyRef.current?.offsetHeight || 240;
      const gap = 6;
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const top = spaceBelow >= menuH || spaceBelow >= r.top
        ? r.bottom + gap
        : Math.max(8, r.top - gap - menuH);
      setTplFlyPos({
        top,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    onReposition();
    // 下一帧再量一次（菜单已挂到 body，高度准）
    const t = requestAnimationFrame(onReposition);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [tplFlyOpen]);

  const board = useMemo(
    () => boards.find((b) => b.id === dirKey) || boards.find((b) => b.key === dirKey) || null,
    [boards, dirKey]
  );

  // 成员行 = 看板成员 + 仓库登记（本机没有登记的占位只显示 key）+ 队列现状
  const items = useMemo(() => {
    if (!board) return [];
    const repoByKey = new Map(repos.map((r) => [r.key, r]));
    const topicByRepoKey = new Map();
    for (const t of topics) {
      if (t.isGlobal || !t.repo || !t.repo.key) continue;
      if (!topicByRepoKey.has(t.repo.key)) topicByRepoKey.set(t.repo.key, t);
    }
    return (board.repos || []).map((m) => {
      const repo = repoByKey.get(m.key) || null;
      const topic = topicByRepoKey.get(m.key) || null;
      return {
        key: m.key,
        name: m.name || (repo && repo.name) || m.key,
        path: m.path || (repo && repo.path) || '',
        cwd: (topic && topic.cwd) || m.path || (repo && repo.path) || '',
        desc: m.note || (repo && repo.desc) || '',
        pending: topic ? topic.pending || 0 : 0,
        waiting: !!(topic && topic.waiting),
        topicKey: topic ? topic.key : '',
        summary: topic ? topic.summary || '' : '',
        tasks: topic ? (topic.tasks || []).filter((t) => !t.deletedAt) : [],
        present: m.present !== false,
        // 组内描述文档：绑定优先（外部 path 只读），缺省约定路径
        noteDocId: m.noteDocPath ? 'path:' + m.noteDocPath : 'rel:' + m.noteDocRel,
      };
    });
  }, [board, repos, topics]);

  if (!board) {
    return (
      <div className="rp-page">
        <RouteBreadcrumb />
        <div className="rp-empty">项目组不存在（看板可能被删了）</div>
      </div>
    );
  }

  const totalPending = items.reduce((n, it) => n + it.pending, 0);

  // 每个成员队列的编排素材：待领取任务（队列序）+ 闸门的下游映射（同 isReadyToClaim 口径）。
  // rows = /api/localtasks 的裸 topic（tasks 直挂其上）。
  const dagByTopic = useMemo(() => {
    const map = new Map();
    for (const r of topics) {
      if (!r.key || r.isGlobal) continue;
      const pend = (r.tasks || []).filter(
        (t) => t && !t.deletedAt && !t.migratedTo && t.status === 'pending',
      );
      const downstream = {};
      pend.forEach((t, i) => {
        if (t.blocksFollowing) downstream[t.id] = pend.slice(i + 1).map((x) => x.id);
      });
      map.set(r.key, { tasks: pend, downstream });
    }
    return map;
  }, [topics]);

  // 保存与目录页同构：逐条 PATCH（本任务 gate/blockBy + 下游各方 blockBy）；
  // 失败 toast 并上抛——编辑器据此保持打开。

  // 新建任务的默认归属项目：第一个有待领取的成员（面板一打开就对准活儿），
  // 都没有就第一个成员。编辑页的工具区里还可以改（限本组成员）。
  const sel =
    items.find((it) => it.pending > 0) ||
    items[0] ||
    null;

  // 本组任务 = 成员队列里**正文 frontmatter.board 指向本组**的任务。
  // 待领取保持各成员队列序（可拖动排序）；已领取按领取时间倒序。
  const groupTasks = useMemo(() => {
    const ids = board ? [board.id, board.key, board.name].filter(Boolean) : [];
    const pend = [];
    const done = [];
    for (const it of items) {
      for (const t of it.tasks || []) {
        const fm = parseFrontmatter(t.text);
        if (!fm.board || !ids.includes(fm.board)) continue;
        (t.status === 'pending' ? pend : done).push({ member: it, task: t, project: fm.project || '' });
      }
    }
    done.sort((a, b) => String(b.task.consumedAt || '').localeCompare(String(a.task.consumedAt || '')));
    return { pend, done };
  }, [board, items]);

  // 待领取拖动排序（同目录页 HTML5 DnD；落点须同 topic）
  const dragRef = useRef(null); // { id, topicKey, cwd }
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { key: memberKey:taskId, zone }
  const rowKey = (member, task) => member.key + ':' + task.id;
  const zoneOf = (e, el) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const onDragStart = (e, member, task) => {
    dragRef.current = {
      id: Number(task.id),
      topicKey: member.topicKey,
      cwd: member.cwd || member.path || '',
      row: rowKey(member, task),
    };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'task:' + task.id);
    setDragId(rowKey(member, task));
  };
  const onDragOver = (e, member, task) => {
    const drag = dragRef.current;
    if (!drag || drag.row === rowKey(member, task)) return;
    // 异队列也可 hover 提示，松手再拦
    e.preventDefault();
    e.dataTransfer.dropEffect = drag.topicKey === member.topicKey ? 'move' : 'none';
    setDropAt({ key: rowKey(member, task), zone: zoneOf(e, e.currentTarget) });
  };
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropAt(null);
  };
  const onDrop = async (e, member, task) => {
    e.preventDefault();
    const zone = zoneOf(e, e.currentTarget);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
    if (!drag || drag.row === rowKey(member, task)) return;
    if (drag.topicKey !== member.topicKey) {
      toast('只能在同一项目队列内排序（跨项目请用编排连线）');
      return;
    }
    const cwd = member.cwd || member.path;
    if (!member.topicKey || !cwd) {
      toast('该成员还没有本地队列，无法排序');
      return;
    }
    try {
      await api('/api/localtasks/reorder', {
        method: 'PATCH',
        body: {
          cwd,
          id: drag.id,
          ...(zone === 'before' ? { beforeId: Number(task.id) } : { afterId: Number(task.id) }),
        },
      });
      app.refreshLocal && (await app.refreshLocal());
    } catch (err) {
      toast(String(err.message || err));
    }
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDragId(null);
    setDropAt(null);
  };

  // 组里建任务：草稿预写 frontmatter（board + 默认归属项目），提交时编辑页的工具区
  // 可改归属项目（限本组成员），按它路由进对应项目的队列。
  // 落种用 PagePanel 同一套复合键（scope::draft-N）——裸 draft 号会种不到正文上。
  // body 可选（#128）：hover 面板里选了模板就带模板正文；不带 = 默认模板（旧行为）。
  const createTask = (body) => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再建任务');
    const id = nextDraftId();
    // 草稿 doc 种在**组 scope**（docIdOf(scopeOf(board.id), id)）：从组路由
    // #/group/<id>?task=draft-N 打开寻得回同一份（#86）。以前种在成员 scope、
    // 打开走 dir 路由——组语义在建任务这步就断了。
    const docId = docIdOf(scopeOf(board.id), id);
    // 与目录任务页同一条 defaultBody：已按槽位值渲染，不出现裸 {{背景}}
    saveDoc(docId, {
      title: '',
      body: withFrontmatter(body || tpl.defaultBody(), { board: board.id, project: sel.key }),
    });
    app.openPage?.({ groupId: board.id, task: id, name: '新任务' });
  };

  // #132：组本身是可见主体——按 group +（可选）成员 repo/topic 三钥过滤。
  const scopedTpl = useTemplatesFor({
    topic: sel ? sel.topicKey : '',
    group: board ? board.key : '',
    repo: sel ? sel.key : '',
  });
  const flyTemplates = scopedTpl.templates || tpl.templates || [];

  // 就地新建（#135）：不弹窗，直进全屏编辑；标题即名称；scope 预置本组。
  const newTemplateHere = () => {
    if (!board || !model) return;
    openTemplateEditor(model, {
      mode: 'new',
      scope: [`group:${board.key}`],
      name: '',
    });
  };

  return (
    <div className="rp-page">
      {dialogNode}
      <div className="rp-group-head">
        <h2>
          <Icon name="folder" size={15} /> {board.name}
          <span className="rp-chip-count">{items.length} 个目录</span>
          {totalPending > 0 && <span className="rp-chip-count">待领取 {totalPending}</span>}
        </h2>
        {/* 组简介（board/<组>.md）不在头部铺正文：那一大段文字会被右侧动作按钮压住，
            而且组介绍已经是文档（下面的「组介绍」入口直达）。任务 #87：
            「文字被按钮遮挡，不显示简介文本」——此处只留名字与计数。 */}
        <div className="rp-group-acts">
          {/* #139：工具区可编排；新增任务保留模板下拉（#132 portal） */}
          <ToolActsBar
            kind="group"
            titles={{
              progress: '打开本组的任务进程面板',
              addMember: '挑项目加进这个组',
              orch: '打开可视化编排面板',
              refs: '查看文档 / reference 列表',
            }}
            disabled={{ new: !sel }}
            renderers={{
              new: () => (
                <div className="rp-newtask" ref={newtaskRef}>
                  {/* #161 拆两级命中区（视觉一颗按钮）：主区点击 = 按默认模板直接
                      新建；内嵌箭头 = 模板下拉（选择模板新建） */}
                  <button
                    type="button"
                    className={'btn small' + (tplFlyOpen ? ' is-open' : '')}
                    title="按默认模板新建任务（▾ 选模板；携带本组语义）"
                    disabled={!sel}
                    onClick={() => createTask('')}
                  >
                    ＋ 新增任务
                    <span
                      role="button"
                      tabIndex={sel ? 0 : undefined}
                      aria-label="选择模板新建任务"
                      aria-haspopup="menu"
                      aria-expanded={tplFlyOpen}
                      className={'rp-newtask-caret' + (tplFlyOpen ? ' rot' : '')}
                      title="选择模板新建任务"
                      onClick={(e) => {
                        e.stopPropagation();
                        const host = e.currentTarget.closest('.rp-newtask');
                        const r = (host || e.currentTarget).getBoundingClientRect();
                        setTplFlyPos({
                          top: r.bottom + 6,
                          right: Math.max(8, window.innerWidth - r.right),
                        });
                        setTplFlyOpen((v) => !v);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          const host = e.currentTarget.closest('.rp-newtask');
                          const r = (host || e.currentTarget).getBoundingClientRect();
                          setTplFlyPos({
                            top: r.bottom + 6,
                            right: Math.max(8, window.innerWidth - r.right),
                          });
                          setTplFlyOpen((v) => !v);
                        }
                      }}
                    >
                      <Icon name="chevron" size={11} />
                    </span>
                  </button>
                  {tplFlyOpen &&
                    sel &&
                    tplFlyPos &&
                    createPortal(
                      <div
                        ref={tplFlyRef}
                        className="rp-tpl-fly rp-tpl-fly-portal"
                        role="menu"
                        aria-label="选择模板新建任务"
                        style={{ top: tplFlyPos.top, right: tplFlyPos.right }}
                      >
                        <div className="rp-tpl-fly-h">{board.name} · 可用模板</div>
                        <div className="rp-tpl-fly-list">
                          {(flyTemplates.length
                            ? flyTemplates
                            : [{ id: '__fallback__', name: '按默认模板新建', fallback: true }]
                          ).map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              className="rp-tpl-fly-it"
                              role="menuitem"
                              onClick={() => {
                                setTplFlyOpen(false);
                                createTask(
                                  t.fallback
                                    ? ''
                                    : renderTemplateBody(t.body, { ...NEW_TEMPLATE_VALUES, ...(t.values || {}) })
                                );
                              }}
                            >
                              {(t.id === tpl.defaultId && !t.fallback ? '✓ ' : '') + t.name}
                            </button>
                          ))}
                        </div>
                        <div className="rp-tpl-fly-foot">
                          <button
                            type="button"
                            className="rp-tpl-fly-new"
                            onClick={() => {
                              setTplFlyOpen(false);
                              newTemplateHere();
                            }}
                          >
                            ＋ 新增模板…
                          </button>
                        </div>
                      </div>,
                      document.body
                    )}
                </div>
              ),
            }}
            actions={{
              progress: () => {
                if (!model) return;
                openPanel(model, {
                  component: 'progress',
                  name: '进程',
                  config: { groupKey: dirKey },
                  location: 'right',
                });
              },
              addMember: () => setAddOpen(true),
              orch: () => {
                if (!model) return;
                openPanel(model, {
                  component: 'dag',
                  name: '编排',
                  config: { dirKey: (sel && sel.topicKey) || '', groupId: board && board.id },
                });
              },
              refs: () => {
                if (!model || !board) return;
                openPanel(model, {
                  component: 'refs',
                  name: '文档列表',
                  config: { boardKey: dirKey, boardName: board.name },
                  location: 'right',
                });
              },
            }}
          />
        </div>
      </div>

      {/* 组介绍（board/<组>.md，文字超链接打开 DocPanel）放在本组任务**上方**——
          先看这个组是干什么的，再看活儿 */}
      <Introduction kind="board" owner={board} model={model} />

      {/* 首屏：本组任务面板——只列 frontmatter.board 指向本组的任务，项目 tag 标归属 */}
      <div className="rp-tasks">
        <div className="rp-tasks-h">
          <Icon name="list" size={13} /> 本组任务
          <span className="rp-chip-count">{groupTasks.pend.length} 待领取</span>
          {groupTasks.done.length > 0 && <span className="rp-chip-count">已领取 {groupTasks.done.length}</span>}
        </div>
        {groupTasks.pend.map(({ member, task }) => {
          const dagInfo = dagByTopic.get(member.topicKey);
          const downs = (dagInfo && dagInfo.downstream[task.id]) || [];
          const locked = task.ready === false;
          const rk = rowKey(member, task);
          return (
            <div
              key={rk}
              className={
                'rp-proj-row'
                + (dragId === rk ? ' dragging' : '')
                + (dropAt && dropAt.key === rk ? ' drop-' + dropAt.zone : '')
              }
              onDragOver={(e) => onDragOver(e, member, task)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, member, task)}
            >
              {member.topicKey ? (
                <span
                  className="rp-drag-handle"
                  draggable
                  title="拖动调整本项目队列内顺序"
                  aria-label="拖动排序"
                  onDragStart={(e) => onDragStart(e, member, task)}
                  onDragEnd={onDragEnd}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name="grip" size={12} />
                </span>
              ) : (
                <span className="rp-drag-handle off" aria-hidden="true" />
              )}
              <button
                className="rp-proj-task"
                title="打开这条任务"
                onClick={() => app.openPage && app.openPage({ groupId: board.id, task: String(task.id), name: `#${task.id}` })}
              >
                <span className="mono">#{task.id}</span>
                <span className="rp-ptag" title={`归属项目：${member.name}`}>{member.name}</span>
                <span className="rp-proj-task-tx">{taskLabel(task)}</span>
                {task.timegoal && (
                  <span className="rp-proj-goal" title={`时间目标 ${task.timegoal.duration}：领取即计时，未到点不许标完成`}>
                    <Icon name="clock" size={11} /> {task.timegoal.duration}
                  </span>
                )}
                {task.blocksFollowing && (
                  <span
                    className="rp-tgate"
                    title={
                      downs.length
                        ? `闸门：未完成前挡住 ${downs.length} 个后续任务（#${downs.join(', #')}）`
                        : '闸门：未完成前挡住队列里排在后面的待领取任务'
                    }
                  >
                    闸门{downs.length ? `×${downs.length}` : ''}
                  </span>
                )}
                {locked && (
                  <span
                    className="rp-tlock"
                    title={task.blockBy?.length ? `等待依赖完成：#${task.blockBy.join(', #')}` : '被前方闸门挡住'}
                  >
                    锁定
                  </span>
                )}
                {/* #121 统一组件：待领取=浅灰药丸 */}
                <StatusTag t={task} />
              </button>
            </div>
          );
        })}
        {!groupTasks.pend.length && (
          <div className="rp-proj-none muted">
            本组还没有待领取任务——点「＋ 新增任务」创建；只有在本组创建的任务（携带本组语义）才会出现在这里。
          </div>
        )}
        {groupTasks.done.length > 0 && (
          <>
            <button type="button" className="rp-done-toggle" onClick={() => setShowDone((v) => !v)}>
              <span className={'tri' + (showDone ? ' open' : '')}>▸</span> 已领取 {groupTasks.done.length}
            </button>
            {showDone && groupTasks.done.map(({ member, task }) => (
              <button
                key={member.key + ':' + task.id}
                className="rp-proj-task done"
                title="打开这条任务"
                onClick={() => app.openPage && app.openPage({ groupId: board.id, task: String(task.id), name: `#${task.id}` })}
              >
                <span className="mono">#{task.id}</span>
                <span className="rp-ptag" title={`归属项目：${member.name}`}>{member.name}</span>
                <span className="rp-proj-task-tx">{taskLabel(task)}</span>
                {/* 已领取=进行中：领取时刻用 #121 口径的进行中蓝（rp-tstat.live） */}
                <span className="rp-tstat live">{task.consumedAt || '已领取'}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* 添加成员：就地弹窗（项目 + 项目组，可搜索） */}
      {addOpen && board ? (
        <MemberPicker
          board={board}
          boards={boards}
          repos={repos}
          onClose={() => setAddOpen(false)}
          onChanged={() => app.refreshRepos && app.refreshRepos()}
        />
      ) : null}

    </div>
  );
}
