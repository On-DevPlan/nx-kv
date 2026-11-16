// 参考仓库区块（#143）：把「参考仓库」从弹窗面板提升成与开发仓库**同构**的一张表。
//
// 用户在验收里点明：「组 / main 的参考仓库和开发仓库的隔离都是相同的，两个区块」——
// 也就是说参考仓库不再藏在「参考仓库面板」里，而是和仓库并排成第二个区块，
// 同样的表头、同样的行高、同样的搜索；面板仍保留（克隆 / 存储根 / 批量检查这些
// 管理动作不适合塞进一行）。
//
// 两个视角：
//   · main / default：全部参考仓库，绑定对象一列并列显示「组级」与「仓库级」（互不折算）
//   · 组分支：只有这一支绑的参考仓库，第三列换成这一支的组内描述
import { useState } from 'react';
import { Copyable } from '../../components/ui.jsx';
import { Button } from '../../components/button/index.jsx';
import { DocsEntry } from './repo-table.js';
import type { BoardRecord, RefBackLink, RefCheckMap, RepoRecord } from './repo-table.js';
import { IconLink, IconOpen, IconSync, IconUnlink } from './icons.jsx';

export default function RefBlock({ rows, mode, group, boardList, refRepoBackLinks, checkOf, onSync, onOpen, onDocs, onBind, onUnbindGroup, onUnbindRepo, onGoBind, onManage }: {
  rows: RepoRecord[];
  mode: 'main' | 'group' | 'default';
  /** 组分支：当前分支（组）本身 */
  group?: BoardRecord | null;
  boardList: BoardRecord[];
  refRepoBackLinks: Map<string, RefBackLink[]>;
  checkOf: RefCheckMap;
  onSync: (r: RepoRecord) => void;
  onOpen: (r: RepoRecord) => void;
  onDocs: (r: RepoRecord) => void;
  onBind: (r: RepoRecord) => void;
  onUnbindGroup: (r: RepoRecord, groupId: string) => void;
  onUnbindRepo: (r: RepoRecord, repoKey: string) => void;
  onGoBind: (kind: string, target: string) => void;
  /** 打开参考仓库管理面板（克隆 / 存储根 / 批量检查） */
  onManage: () => void;
}) {
  const isGroup = mode === 'group';
  const [expand, setExpand] = useState<Record<string, boolean>>({});

  if (!rows.length) {
    return (
      <div className="rp-block-empty">
        <div className="rp-block-empty-t">{isGroup ? '这个分支还没有参考仓库' : '还没有登记参考仓库'}</div>
        <div className="rp-block-empty-d">
          参考仓库是「拿来看的本机代码」——登记进来之后可以和开发仓库并列出现在任务上下文里。
        </div>
        <Button onClick={onManage}>打开参考仓库管理</Button>
      </div>
    );
  }

  return (
    <div className="rp-table-wrap" id="rp-refs">
      <table className="rp-table rp-table-ref">
        <thead>
          <tr>
            <th scope="col" style={{ width: '26%' }}>参考仓库</th>
            <th scope="col" style={{ width: '24%' }}>远程地址</th>
            <th scope="col">{isGroup ? '组内描述' : '绑定对象'}</th>
            <th scope="col" style={{ width: '322px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = checkOf.get(r.id);
            const groups = boardList
              .map((b) => {
                const l = (b.refs || []).find((x) => x.id === r.key);
                return l ? { board: b, note: l.note || '' } : null;
              })
              .filter((l): l is { board: BoardRecord; note: string } => l !== null);
            const direct = refRepoBackLinks.get(r.key) || [];
            const open = !!expand[r.id];
            const LIMIT = 3;
            const noteInGroup = isGroup && group
              ? String((group.refs || []).find((x) => x.id === r.key)?.note || '')
              : '';
            return (
              <tr key={r.id} id={'rp-refrepo-row-' + r.key}>
                <td className="rp-ref-cell-name">
                  <strong>
                    <span className={'rp-ref-dot' + (c ? (c.ok ? ' ok' : ' bad') : '')}
                      title={c ? (c.ok ? '检查通过' : (c.issues || []).join('\n')) : '尚未检查'} />
                    {r.name}
                  </strong>
                  <DocsEntry docs={r.descDocs} onOpen={() => onDocs(r)} />
                </td>
                <td className="mono rp-ref-cell-remote">
                  <Copyable text={r.remote || ''} title="点击复制远程地址">{r.remote || '（无）'}</Copyable>
                </td>
                <td className="rp-ref-cell-links">
                  {isGroup ? (
                    noteInGroup
                      ? <span className="rp-group-note" title={`组内描述：\n${noteInGroup}`}>{noteInGroup.split('\n')[0]}</span>
                      : <span className="muted rp-refs-none">—</span>
                  ) : (groups.length || direct.length) ? (
                    <>
                      {groups.length ? (
                        <div className="rp-bind-row">
                          <span className="rp-bind-label">组</span>
                          {(open ? groups : groups.slice(0, LIMIT)).map((l) => (
                            <span className="rp-link-chip rp-link-chip-group" key={'board:' + l.board.id}>
                              <button className="rp-link-chip-main"
                                title={['点击跳到这个分支', '组级绑定（分支内共享）'].join('\n')}
                                onClick={() => onGoBind('board', l.board.id)}>
                                <b>组</b>
                                <span className="rp-link-chip-name">{l.board.name}</span>
                              </button>
                              <button className="rp-link-chip-x" title="从这一支摘除（不影响其它分支与仓库级绑定）"
                                onClick={() => onUnbindGroup(r, l.board.id)}>×</button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {direct.length ? (
                        <div className="rp-bind-row">
                          <span className="rp-bind-label">仓</span>
                          {(open ? direct : direct.slice(0, LIMIT)).map((d) => (
                            <span className="rp-link-chip rp-link-chip-repo" key={'repo:' + d.repo.key}>
                              <button className="rp-link-chip-main"
                                title={[d.note || '直接绑定到这个仓库（不经过组）', `仓库 key: ${d.repo.key}`, '点击定位到仓库行'].join('\n')}
                                onClick={() => onGoBind('repo', d.repo.key)}>
                                <b>仓</b>
                                <span className="rp-link-chip-name">{d.repo.name}</span>
                              </button>
                              <button className="rp-link-chip-x" title="从这个仓库摘除（不影响组级绑定）"
                                onClick={() => onUnbindRepo(r, d.repo.key)}>×</button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {groups.length + direct.length > LIMIT * 2 ? (
                        <button className="rp-bind-toggle"
                          onClick={() => setExpand((m) => ({ ...m, [r.id]: !open }))}>
                          {open ? '收起' : `展开全部 ${groups.length + direct.length}`}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="muted rp-refs-none">未绑定</span>
                      <Button small className="rp-ref-bind" onClick={() => onBind(r)}>绑定…</Button>
                    </>
                  )}
                </td>
                <td className="rp-acts rp-acts-wrap">
                  <Button small title="拉取最新（git fetch / pull）" onClick={() => onSync(r)}>
                    <span className="rp-btn-ico"><IconSync size={12} /></span>同步
                  </Button>
                  <Button small title="在文件管理器中打开" onClick={() => onOpen(r)}>
                    <span className="rp-btn-ico"><IconOpen size={12} /></span>打开
                  </Button>
                  <Button small title="管理它绑在哪些组 / 仓库" onClick={() => onBind(r)}><span className="rp-btn-ico"><IconLink size={12} /></span>绑定…</Button>
                  {isGroup && group ? (
                    <Button small danger title="只从这一支摘除（不影响其它分支）" onClick={() => onUnbindGroup(r, group.id)}>
                      <span className="rp-btn-ico"><IconUnlink size={12} /></span>移出本组
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
