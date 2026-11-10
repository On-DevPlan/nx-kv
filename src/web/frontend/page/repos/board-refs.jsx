// 看板上下文条 + 看板参考区块（筛选到某个看板时出现）。
//
// 上下文条把看板的领域描述亮出来 —— desc 写的是这个领域的侧重、谁配合谁
// （谁是中心/终端）、关键路径与搜索关键词。
//
// 参考区块 = 组（看板）上绑定的参考仓库（组级参考，v4：组内所有仓库共享）。
// 不再按「经由成员仓库」拆分展示。
// 关系引用一律按 key（看板 key = board/<名称>，仓库 key = 归一化远程地址）。
import { useEffect, useMemo, useState } from 'react';
import { Copyable } from '../../components/ui.jsx';
import { Button } from '../../components/button/index.jsx';

export default function BoardRefs({ filterBoard, refRepos, checkOf, onOpenDoc, onAddMember, onSync, onOpen, onLinkNote, onUnbind }) {
  // 组上绑定的参考仓库（组内共享；不再有「经由成员仓库」）
  const boardRefRepos = useMemo(() => {
    if (!filterBoard) return [];
    const byKey = new Map(refRepos.map((r) => [r.key, r]));
    return (filterBoard.refs || [])
      .map((l) => {
        const r = byKey.get(l.id);
        return r ? { ...r, boardNote: l.note || '' } : null;
      })
      .filter(Boolean);
  }, [refRepos, filterBoard]);

  // 组参考区块的折叠：条目多（>8）默认收起，别让一屏全是参考仓库；
  // 切组时回到「按条目数自动」。用户点了展开/收起以当次选择为准。
  const [boardRefReposOpen, setBoardRefsOpen] = useState(null); // null = 自动
  useEffect(() => { setBoardRefsOpen(null); }, [filterBoard ? filterBoard.id : null]);
  const boardRefReposExpanded = boardRefReposOpen === null ? boardRefRepos.length <= 8 : boardRefReposOpen;

  if (!filterBoard) return null;

  return (
    <>
      <div className="rp-context" data-testid="rp-context">
        <span className="rp-context-name">{filterBoard.name}</span>
        {filterBoard.desc ? (
          <span className="rp-context-desc" title={filterBoard.desc}>{filterBoard.desc}</span>
        ) : (
          <span className="muted rp-context-desc">
            还没有领域描述 —— 点「组介绍文档」补一段：侧重什么、谁配合谁、关键路径与搜索关键词在哪。
          </span>
        )}
        <span className="acts">
          <Button small title="打开这个分组的组介绍文档"
            onClick={() => onOpenDoc(filterBoard)}>组介绍文档 ✎</Button>
          <a className="btn small ghost" href={'#/group/' + encodeURIComponent(filterBoard.id)}
            title="组页里看这个组的成员与任务">组页 ↗</a>
          <Button small onClick={() => onAddMember(filterBoard.id)}>添加成员</Button>
        </span>
      </div>

      <div className="rp-ref-mounted" data-testid="rp-board-refs">
        <div className="rp-ref-mounted-head">
          <span className="rp-ref-mounted-label">「{filterBoard.name}」的参考仓库 <b>{boardRefRepos.length}</b></span>
          <span className="muted">绑定在组上：组内所有仓库共享，不区分来源仓库</span>
          {boardRefRepos.length ? (
            <Button small className="rp-ref-mounted-toggle"
              title={boardRefReposExpanded ? '收起这个组的参考仓库清单' : '展开这个组的参考仓库清单'}
              onClick={() => setBoardRefsOpen(!boardRefReposExpanded)}>
              {boardRefReposExpanded ? '收起' : `展开 ${boardRefRepos.length}`}
            </Button>
          ) : null}
        </div>
        {!boardRefRepos.length ? (
          <div className="muted rp-refs-none">这个组还没有绑定的参考仓库 —— 在下方参考仓库面板里点「绑定」勾选本组。</div>
        ) : boardRefReposExpanded ? boardRefRepos.map((r) => {
          const c = checkOf.get(r.id);
          return (
            <div className="rp-ref-mounted-item" key={r.id}>
              <span className={'rp-ref-dot' + (c ? (c.ok ? ' ok' : ' bad') : '')}
                title={c ? (c.ok ? '检查通过' : c.issues.join('\n')) : '尚未检查'} />
              <Copyable text={r.remote || r.name} title="点击复制远程地址" className="rp-ref-mounted-name">{r.name}</Copyable>
              {r.desc ? <span className="muted rp-ref-mounted-desc" title={r.desc}>{r.desc}</span> : null}
              {r.boardNote ? (
                <button className="rp-ref-note-chip" title={`${r.boardNote}\n点击编辑这条组级描述`}
                  onClick={() => onLinkNote(r, filterBoard.id, filterBoard.name, r.boardNote)}>
                  {r.boardNote.split('\n')[0]}
                </button>
              ) : (
                <Button small title={`写「${r.name}」在这个组里参考什么（组级描述）`}
                  onClick={() => onLinkNote(r, filterBoard.id, filterBoard.name, '')}>写描述</Button>
              )}
              <span className="acts">
                <Button small onClick={() => onSync(r)}>同步</Button>
                <Button small onClick={() => onOpen(r)}>打开</Button>
                <Button small danger title="只从本组摘除（不影响其它组）"
                  onClick={() => onUnbind(r, filterBoard.id)}>移出本组</Button>
              </span>
            </div>
          );
        }) : null}
      </div>
    </>
  );
}
