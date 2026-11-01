// 项目组详情（#/group/<看板 id>）：这个组里的**子目录**以表格呈现。
//
// 为什么是表格：组是「一组东西」——列表看不出规模与状态；表格一眼看清谁在里面、
// 路径在哪、有没有待领任务、归属是手动挂的还是前缀规则自动来的。
// 行点击 → 进该目录（子任务表在目录视图里）。
//
// 组介绍是**真实的 .md 文档**（board.docRel 指到的自有树文件）：这里只读渲染，
// 双链与「编辑」都落到工作区的 doc 页签（DocPanel）——本页不做内嵌编辑器。
//
// 数据都来自已有的几份：看板成员（/api/boards）、仓库登记（/api/repos）、
// 本机队列（/api/localtasks）、文档（/api/docs/item）——按 **仓库 key** 归位。
//
// 注意「目录 ≠ 队列」：看板成员只是**仓库登记**，未必已有任务队列（topic）。
// 工作台按 topic.key 寻址，所以没有队列的目录要先建队列再跳——走侧栏同一个
// ensureQueueAndGo，绝不能退化成「跳去仓库管理」那种错误落点。
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/icons.jsx';
import { useToast } from '../../components/ui.jsx';
import { ensureQueueAndGo } from '../../components/sidebar/queue-nav.js';
import { api } from '../../api/client.js';
import { renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { useWikiNav } from '../doc/index.jsx';

export default function GroupView({ dirKey, rows, repoData, onNavigate, refreshLocal, model }) {
  const toast = useToast();
  const boards = (repoData && repoData.boards) || [];
  const repos = (repoData && repoData.repos) || [];
  const topics = rows || [];
  const { onClick: onNavClick, openByDocId } = useWikiNav(model);

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
        // 组内描述文档：绑定优先（外部 path 只读），缺省约定路径
        noteDocId: m.noteDocPath ? 'path:' + m.noteDocPath : 'rel:' + m.noteDocRel,
      };
    });
  }, [board, repos, topics]);

  // 组介绍文档（只读渲染；缺失/外部目录按各自形态展示）
  const [intro, setIntro] = useState(null);
  // 双链已解析名集合：组介绍里的 [[..]] 能区分「可点」与「未解析」（虚线红）
  const [known, setKnown] = useState(null);
  useEffect(() => {
    api('/api/docs/index')
      .then((d) => {
        const set = new Set();
        for (const x of d.index || []) {
          set.add(x.name);
          if (x.rel) set.add(String(x.rel).toLowerCase());
          if (x.path) set.add(String(x.path).replace(/\\/g, '/').toLowerCase());
        }
        setKnown(set);
      })
      .catch(() => {});
  }, []);
  const introRef = board ? (board.docPath ? 'path:' + board.docPath : 'rel:' + board.docRel) : '';
  useEffect(() => {
    let alive = true;
    setIntro(null);
    if (!introRef) return undefined;
    api('/api/docs/item?ref=' + encodeURIComponent(introRef))
      .then((d) => {
        if (alive) setIntro(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [introRef]);

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
  const introHtml =
    intro && !intro.missing && !intro.dir && intro.body ? renderMarkdownHtml(intro.body, [], known) : '';
  const docLinks = Array.isArray(board.docLinks) ? board.docLinks : [];

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

      {introHtml ? (
        <div className="rp-intro" onClick={onNavClick}>
          <div className="rp-intro-head">
            <span>组介绍 · {intro.rel || intro.path}</span>
            {intro.rel && <span className="rp-intro-path mono">{intro.rel}</span>}
            <span className="grow" />
            <button className="rp-intro-edit" onClick={() => openByDocId(introRef)} title="编辑组介绍">
              编辑
            </button>
          </div>
          <div className="rp-intro-body mdw" dangerouslySetInnerHTML={{ __html: introHtml }} />
        </div>
      ) : intro && (intro.missing || intro.dir) ? (
        <div className="rp-intro">
          <div className="rp-intro-head">
            <span>组介绍 · {intro.rel || intro.path}</span>
            <span className="grow" />
            {intro.rel && !intro.dir && (
              <button className="rp-intro-edit" onClick={() => openByDocId(introRef)}>
                创建
              </button>
            )}
          </div>
          <div className="rp-intro-body muted">
            {intro.dir ? `外部目录绑定：${intro.path}（${(intro.files || []).length} 个文档）` : '还没有组介绍文档——desc 会在首次读取时播种为 md。'}
          </div>
        </div>
      ) : null}

      {docLinks.length > 0 && (
        <div className="rp-doclinks">
          <span className="rp-doclinks-label">组绑定</span>
          {docLinks.map((l, i) => (
            <button
              key={i}
              className={'rp-doclink' + (l.path ? ' ext' : '')}
              title={l.note || (l.path ? '外部 · 只读 · 不进 zip' : '自有文档')}
              onClick={() => openByDocId(l.rel ? 'rel:' + l.rel : 'path:' + l.path)}
            >
              {l.rel || l.path}
              {l.note ? <span className="rp-doclink-note">{l.note}</span> : null}
              {l.path ? <span className="rp-doclink-tag">外部</span> : null}
            </button>
          ))}
        </div>
      )}

      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '18%' }}>目录</th>
              <th scope="col" style={{ width: '26%' }}>路径</th>
              <th scope="col">说明</th>
              <th scope="col" style={{ width: '10%' }}>文档</th>
              <th scope="col" style={{ width: '9%' }}>待领取</th>
              <th scope="col" style={{ width: '9%' }}>归属</th>
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
                <td>
                  <span className={'rp-src' + (it.auto ? ' auto' : '')}>
                    {it.auto ? '按前缀' : '手动'}
                  </span>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan="6" className="muted rp-empty">
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
