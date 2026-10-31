// 项目组详情（#/group/<看板 id>）：这个组里的**子目录**以表格呈现。
//
// 为什么是表格：组是「一组东西」——列表看不出规模与状态；表格一眼看清谁在里面、
// 路径在哪、有没有待领任务、归属是手动挂的还是前缀规则自动来的。
// 行点击 → 进该目录（子任务表在目录视图里）。
//
// 数据都来自已有的三份：看板成员（/api/boards）、仓库登记（/api/repos）、
// 本机队列（/api/localtasks）——按 **仓库 key** 归位，不新建映射关系。
//
// 注意「目录 ≠ 队列」：看板成员只是**仓库登记**，未必已有任务队列（topic）。
// 工作台按 topic.key 寻址，所以没有队列的目录要先建队列再跳——走侧栏同一个
// ensureQueueAndGo，绝不能退化成「跳去仓库管理」那种错误落点。
import { useMemo } from 'react';
import { Icon } from '../../web/frontend/components/icons.jsx';
import { useToast } from '../../web/frontend/components/ui.jsx';
import { ensureQueueAndGo } from '../../web/frontend/components/sidebar/queue-nav.js';

export default function GroupView({ dirKey, rows, repoData, onNavigate, refreshLocal }) {
  const toast = useToast();
  const boards = (repoData && repoData.boards) || [];
  const repos = (repoData && repoData.repos) || [];
  const topics = rows || [];

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
        auto: !!m.auto, // 前缀规则自动归入 vs 手动挂的
        present: m.present !== false,
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
      </div>

      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '20%' }}>目录</th>
              <th scope="col" style={{ width: '30%' }}>路径</th>
              <th scope="col">说明</th>
              <th scope="col" style={{ width: '10%' }}>待领取</th>
              <th scope="col" style={{ width: '10%' }}>归属</th>
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
                  {it.pending > 0 ? (
                    <span className="rp-badge-n">{it.pending}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <span className={'rp-src' + (it.auto ? ' auto' : '')}>
                    {it.auto ? '按前缀' : '手动'}
                  </span>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan="5" className="muted rp-empty">
                  这个组还是空的 —— 加成员，或用「按前缀分组」规则自动归组。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
