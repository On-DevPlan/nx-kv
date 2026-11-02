// 项目组详情（#/group/<看板 id>）：这个组里的**子目录**以表格呈现。
//
// 为什么是表格：组是「一组东西」——列表看不出规模与状态；表格一眼看清谁在里面、
// 路径在哪、有没有待领任务、归属是手动挂的还是前缀规则自动来的。
// 行点击 → 进该目录（子任务表在目录视图里）。
//
// 组介绍与项目介绍共用 Introduction（显示 / 编辑 / 补 ref）。
//
// 注意「目录 ≠ 队列」：看板成员只是**仓库登记**，未必已有任务队列（topic）。
// 工作台按 topic.key 寻址，所以没有队列的目录要先建队列再跳——走侧栏同一个
// ensureQueueAndGo，绝不能退化成「跳去仓库管理」那种错误落点。
import { useMemo } from 'react';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/ui.jsx';
import Introduction from '../../components/Introduction/index.jsx';
import { ensureQueueAndGo } from '../../components/sidebar/queue-nav.js';
import { useWikiNav } from '../doc/index.jsx';

export default function GroupView({ dirKey, rows, repoData, onNavigate, refreshLocal, model }) {
  const toast = useToast();
  const boards = (repoData && repoData.boards) || [];
  const repos = (repoData && repoData.repos) || [];
  const topics = rows || [];
  const { openByDocId } = useWikiNav(model);

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

  // 点行 = 打开这个目录的工作台。没有任务队列的目录先登记队列（幂等）再跳，
  // 与侧栏仓库行同一套行为；只有连路径都没有（本机没登记过）才留在原地提示。
  const openRepo = (it) => {
    ensureQueueAndGo({
      row: { type: 'repo', topicKey: it.topicKey, cwd: it.path, name: it.name },
      onNavigate,
      refreshLocal,
      toast,
    });
  };

  const totalPending = items.reduce((n, it) => n + it.pending, 0);

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
            className="btn small ghost"
            title="在仓库页打开这个分组的成员管理（勾选本机仓库加入）"
            onClick={() => onNavigate('#/repos?board=' + encodeURIComponent(board.id) + '&add=1')}
          >
            添加成员
          </button>
        </div>
      </div>

      <Introduction kind="board" owner={board} model={model} />

      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '18%' }}>目录</th>
              <th scope="col" style={{ width: '26%' }}>路径</th>
              <th scope="col">说明</th>
              <th scope="col" style={{ width: '10%' }}>文档</th>
              <th scope="col" style={{ width: '9%' }}>待领取</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key} className="rp-click-row" onClick={() => openRepo(it)}>
                <td>
                  <div className="rp-name">
                    <strong>{it.name}</strong>
                    {it.waiting && <span className="wdot" title="agent 等待回填中" />}
                  </div>
                  {!it.present && <div className="rp-desc">本机没有这个仓库的登记</div>}
                </td>
                <td>
                  <div className="rp-path mono">{it.path || '—'}</div>
                </td>
                <td>
                  <div className="rp-desc" title={it.desc}>{it.desc || '—'}</div>
                </td>
                <td>
                  <button
                    className="rp-doclink"
                    title="打开组内描述文档"
                    onClick={(e) => {
                      e.stopPropagation();
                      openByDocId(it.noteDocId);
                    }}
                  >
                    描述
                  </button>
                </td>
                <td>
                  {it.pending > 0 ? (
                    <span className="rp-badge-n">{it.pending}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan="5" className="muted rp-empty">
                  这个组还是空的 —— 点「添加成员」勾选，或跑 nx-kv board prefix &lt;前缀&gt; 按名字前缀批量挂入。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
