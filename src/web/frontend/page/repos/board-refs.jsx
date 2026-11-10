// 看板上下文条 + 看板参考区块（筛选到某个看板时出现）。
//
// 上下文条把看板的领域描述亮出来 —— desc 写的是这个领域的侧重、谁配合谁
// （谁是中心/终端）、关键路径与搜索关键词。
//
// 参考区块 = 看板（项目组）绑定的参考仓库命名空间展示区：
// 绑到看板本体的是「组级参考」（note 是它的命名空间描述）；
// 绑到成员开发仓库的是仓库级参考（随成员带进来）。
// 关系引用一律按 key（看板 key = board/<名称>，仓库 key = 归一化远程地址）。
import { useMemo } from 'react';
import { Copyable } from '../../components/ui.jsx';
import { Button } from '../../components/button/index.jsx';

export default function BoardRefs({ filterBoard, refRepos, checkOf, onOpenDoc, onAddMember, onSync, onOpen, onLinkNote, onUnbind }) {
  // 绑定在该看板（命名空间本体）或其成员开发仓库上的参考仓库
  const boardRefs = useMemo(() => {
    if (!filterBoard) return [];
    const memberKeys = new Set((filterBoard.repos || []).map((r) => r.key));
    const bkey = filterBoard.key || `board/${filterBoard.name}`;
    return refRepos
      .map((r) => {
        const boardLink = (r.linked || []).find((l) => l.kind === 'board' && l.id === bkey);
        const repoLinks = (r.linked || []).filter((l) => l.kind === 'repo' && memberKeys.has(l.id));
        if (!boardLink && !repoLinks.length) return null;
        return {
          ...r,
          boardNote: boardLink?.note || '',
          viaRepos: repoLinks.map((l) => (filterBoard.repos || []).find((x) => x.key === l.id)?.name || l.id),
        };
      })
      .filter(Boolean);
  }, [refRepos, filterBoard]);

  if (!filterBoard) return null;
  const bkey = filterBoard.key || `board/${filterBoard.name}`;

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
          <span className="rp-ref-mounted-label">「{filterBoard.name}」的参考仓库 <b>{boardRefs.length}</b></span>
          <span className="muted">组级参考 + 成员仓库各自的参考（多对多：一个参考可同时服务多个组/仓库）</span>
        </div>
        {boardRefs.length ? boardRefs.map((r) => {
          const c = checkOf.get(r.id);
          const boardLink = (r.linked || []).find((l) => l.kind === 'board' && l.id === bkey);
          return (
            <div className="rp-ref-mounted-item" key={r.id}>
              <span className={'rp-ref-dot' + (c ? (c.ok ? ' ok' : ' bad') : '')}
                title={c ? (c.ok ? '检查通过' : c.issues.join('\n')) : '尚未检查'} />
              <Copyable text={r.remote || r.name} title="点击复制远程地址" className="rp-ref-mounted-name">{r.name}</Copyable>
              {r.desc ? <span className="muted rp-ref-mounted-desc" title={r.desc}>{r.desc}</span> : null}
              {r.boardNote ? (
                <button className="rp-ref-note-chip" title={`${r.boardNote}\n点击编辑这条命名空间描述`}
                  onClick={() => onLinkNote(r, 'board', filterBoard.id, filterBoard.name)}>
                  {r.boardNote.split('\n')[0]}
                </button>
              ) : (
                <Button small title={`写「${r.name}」在这个组里参考什么（命名空间描述）`}
                  onClick={() => onLinkNote(r, 'board', filterBoard.id, filterBoard.name)}>写描述</Button>
              )}
              {r.viaRepos.length ? <span className="muted" title={'经由成员仓库: ' + r.viaRepos.join('、')}>经由 {r.viaRepos.join('、')}</span> : null}
              <span className="acts">
                <Button small onClick={() => onSync(r)}>同步</Button>
                <Button small onClick={() => onOpen(r)}>打开</Button>
                {boardLink ? (
                  <Button small danger title="只从本组摘除（不影响其它绑定）"
                    onClick={() => onUnbind(r, 'board', filterBoard.id)}>移出本组</Button>
                ) : null}
              </span>
            </div>
          );
        }) : (
          <div className="muted rp-refs-none">这个组还没有绑定的参考仓库 —— 在下方参考仓库面板里点「绑定」勾选本组，或在成员仓库行上绑定。</div>
        )}
      </div>
    </>
  );
}
