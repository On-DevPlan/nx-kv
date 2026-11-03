// 项目组详情（#/group/<看板 id>）：组是**操作单元**，不是树里的一层文件夹。
//
// 本页就是**本组任务面板**（2026-11-03）：一列列出全部「在本组创建」的任务——
// 任务正文头部带 frontmatter（board/project，提交时自动写入，携带工作组语义），
// 每条用项目 tag 标出归属；「新增任务」进 MD 编辑页，工具区选归属项目（限本组成员），
// 提交按 frontmatter.project 路由进对应项目的队列。成员名册表格已移除（成员管理在仓库页）。
//
// 组介绍与项目介绍共用 Introduction（显示 / 编辑 / 补 ref）。
import { useMemo, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/ui.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import { taskLabel } from '../../components/sidebar/model.js';
import { useApp } from '../../app-context.jsx';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { NEW_TEMPLATE, parseFrontmatter, withFrontmatter } from '../../modules/md/md-parse.js';

export default function GroupView({ dirKey, rows, repoData, onNavigate, model }) {
  const toast = useToast();
  const app = useApp() || {};
  const boards = (repoData && repoData.boards) || [];
  const repos = (repoData && repoData.repos) || [];
  const topics = rows || [];
  // 手选的项目 key（空 = 跟随默认）；换组时键不在新成员表里，自动回默认
  // 已领取历史折叠态
  const [showDone, setShowDone] = useState(false);

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
        <div className="rp-empty">项目组不存在（看板可能被删了）</div>
      </div>
    );
  }

  const totalPending = items.reduce((n, it) => n + it.pending, 0);

  // 新建任务的默认归属项目：第一个有待领取的成员（面板一打开就对准活儿），
  // 都没有就第一个成员。编辑页的工具区里还可以改（限本组成员）。
  const sel =
    items.find((it) => it.pending > 0) ||
    items[0] ||
    null;

  // 本组任务 = 成员队列里**正文 frontmatter.board 指向本组**的任务——
  // 只有从组面板「新增任务」创建的才带这个语义（提交时自动写入），不是成员全部任务。
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
    pend.sort((a, b) => b.task.id - a.task.id);
    done.sort((a, b) => String(b.task.consumedAt || '').localeCompare(String(a.task.consumedAt || '')));
    return { pend, done };
  }, [board, items]);

  // 组里建任务：草稿预写 frontmatter（board + 默认归属项目），提交时编辑页的工具区
  // 可改归属项目（限本组成员），按它路由进对应项目的队列。
  // 落种用 PagePanel 同一套复合键（scope::draft-N）——裸 draft 号会种不到正文上。
  const createTask = () => {
    if (!board) return;
    if (!sel) return toast('这个组还没有成员——先「添加成员」，再建任务');
    const id = nextDraftId();
    const docId = docIdOf(scopeOf(sel.topicKey || ''), id);
    saveDoc(docId, { title: '', body: withFrontmatter(NEW_TEMPLATE, { board: board.id, project: sel.key }) });
    app.openPage?.({ dirKey: sel.topicKey || '', task: id, name: '新任务' });
  };

  return (
    <div className="rp-page">
      <div className="rp-group-head">
        <h2>
          <Icon name="folder" size={15} /> {board.name}
          <span className="rp-chip-count">{items.length} 个目录</span>
          {totalPending > 0 && <span className="rp-chip-count">待领取 {totalPending}</span>}
        </h2>
        {board.desc ? <p className="muted">{board.desc}</p> : null}
        <div className="rp-group-acts">
          <button
            className="btn small"
            title="新建一个携带本组语义的任务（MD 编辑页里可选归属项目）"
            onClick={createTask}
          >
            ＋ 新增任务
          </button>
          <button
            className="btn small ghost"
            title="在仓库页打开这个分组的成员管理（勾选本机仓库加入）"
            onClick={() => onNavigate('#/repos?board=' + encodeURIComponent(board.id) + '&add=1')}
          >
            添加成员
          </button>
        </div>
      </div>

      {/* 首屏：本组任务面板——只列 frontmatter.board 指向本组的任务，项目 tag 标归属 */}
      <div className="rp-tasks">
        <div className="rp-tasks-h">
          <Icon name="list" size={13} /> 本组任务
          <span className="rp-chip-count">{groupTasks.pend.length} 待领取</span>
          {groupTasks.done.length > 0 && <span className="rp-chip-count">已领取 {groupTasks.done.length}</span>}
        </div>
        {groupTasks.pend.map(({ member, task }) => (
          <button
            key={member.key + ':' + task.id}
            className="rp-proj-task"
            title="打开这条任务"
            onClick={() => onNavigate('#/dir/' + encodeURIComponent(member.topicKey) + '?task=' + task.id)}
          >
            <span className="mono">#{task.id}</span>
            <span className="rp-ptag" title={`归属项目：${member.name}`}>{member.name}</span>
            <span className="rp-proj-task-tx">{taskLabel(task)}</span>
            {task.timegoal && (
              <span className="rp-proj-goal" title={`时间目标 ${task.timegoal.duration}：领取即计时，未到点不许标完成`}>
                <Icon name="clock" size={11} /> {task.timegoal.duration}
              </span>
            )}
            <span className="rp-tstat" title="待领取">待领取</span>
          </button>
        ))}
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
                onClick={() => onNavigate('#/dir/' + encodeURIComponent(member.topicKey) + '?task=' + task.id)}
              >
                <span className="mono">#{task.id}</span>
                <span className="rp-ptag" title={`归属项目：${member.name}`}>{member.name}</span>
                <span className="rp-proj-task-tx">{taskLabel(task)}</span>
                <span className="rp-tstat done">{task.consumedAt || '已领取'}</span>
              </button>
            ))}
          </>
        )}
      </div>

      <Introduction kind="board" owner={board} model={model} />

    </div>
  );
}
