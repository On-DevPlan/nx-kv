// 参考仓库面板（独立弹窗，宽表）：克隆 / 绑定 / 同步 / 检查 / 存储根。
//
// 与开发仓库分表——主表只放 dev，行内「参考」列显示绑定关系。
// 每行：状态徽标 / 名称+描述 / 远程地址 / 绑定 chips / 操作。
// 绑定两类并存、互不折算：组级（group_refs，组内共享）与仓库级（只绑这一个仓库）。
// 绑定一律选项式（「绑定」弹窗里勾选），不手填字符串。
// 做成弹窗：它是「隔一阵来维护一次」的东西，平铺会把开发仓库主表顶到两屏之外。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Copyable } from '../../components/ui.jsx';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { DocsEntry } from './repo-table.jsx';

export default function RefPanel({
  refRepos, devRepos, boardList, checkOf, refRepoBackLinks, refBindOpen, onRefBindOpen,
  onClose, onSyncOne, onUnbind, onUnbindRepo, onLinkNote, onGoBind, onDocs, onRowAct, reload,
}) {
  const guard = useGuard();
  const toast = useToast();
  const [settingInfo, setSettingInfo] = useState(null); // gitRepoRoot / gitDevRoot 当前值
  const [rootsOpen, setRootsOpen] = useState(false);
  const [rootsForm, setRootsForm] = useState({ gitRepoRoot: '', gitDevRoot: '' });
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ url: '', name: '', desc: '', depth: '1' });
  // 选项式绑定：克隆时勾选目标（{repoId:true, boardId:true}）；绑定管理弹窗复用同一形状
  const [cloneTargets, setCloneTargets] = useState({});
  // 绑定管理弹窗：目标 ref（checkbox 列表 = 全部组 + 全部开发仓库）
  const [bindFor, setBindFor] = useState(null); // ref 对象 | null
  const [bindSel, setBindSel] = useState({}); // { 'repo:<key>': bool, 'board:<key>': bool }

  const loadSetting = useCallback(async () => {
    setSettingInfo(await api('/api/setting').catch(() => null));
  }, []);
  useEffect(() => { loadSetting(); }, [loadSetting]);

  const saveRoots = () => guard(async () => {
    const body = {};
    if (rootsForm.gitRepoRoot.trim()) body.gitRepoRoot = rootsForm.gitRepoRoot.trim();
    if (rootsForm.gitDevRoot.trim()) body.gitDevRoot = rootsForm.gitDevRoot.trim();
    if (!Object.keys(body).length) return;
    setSettingInfo(await api('/api/setting', { method: 'POST', body }));
    setRootsOpen(false);
    toast('已保存存储根目录');
  });

  const doClone = () => guard(async () => {
    const url = cloneForm.url.trim();
    if (!url) return;
    const body = {
      url,
      name: cloneForm.name.trim() || undefined,
      desc: cloneForm.desc.trim() || undefined,
      depth: parseInt(cloneForm.depth, 10) || 1,
      'no-bind': true, // 面板没有 cwd 语义，自动绑定只在 CLI（在开发仓库目录里跑）有意义
    };
    // 选项式绑定：勾选了哪些 dev 仓库 / 看板，就绑哪些（不填字符串）
    const repoBinds = devRepos.filter((d) => cloneTargets['repo:' + d.id]).map((d) => d.id);
    const boardBinds = boardList.filter((b) => cloneTargets['board:' + b.id]).map((b) => b.id);
    if (repoBinds.length) body.bind = repoBinds;
    if (boardBinds.length) body.board = boardBinds;
    const r = await api('/api/repos/ref/clone', { method: 'POST', body });
    setCloneOpen(false);
    setCloneForm({ url: '', name: '', desc: '', depth: '1' });
    setCloneTargets({});
    toast(`已克隆: ${r.name} → ${r.dest || r.path}`);
    await reload.all();
  });

  const syncAll = () => guard(async () => {
    const d = await api('/api/repos/ref/sync', { method: 'POST', body: { all: true } });
    const bad = d.results.filter((x) => x.status !== 'updated' && x.status !== 'upToDate');
    toast(`同步 ${d.synced} 个${bad.length ? `，${bad.length} 个有问题（见检查结果）` : '，全部完成'}`);
    await reload.refCheck();
  });

  // 绑定管理弹窗：参考仓库 ↔ 组 / 单个开发仓库（两类并存，互不折算）。
  // 勾选 = 建立该维度绑定，取消 = 摘除；保存时对比差异。
  const boardKeyOf = (b) => b.key || `board/${b.name}`;
  const openBind = (r) => {
    const sel = {};
    for (const b of boardList) {
      if ((b.refs || []).some((l) => l.id === r.key)) sel['board:' + boardKeyOf(b)] = true;
    }
    for (const d of devRepos) {
      if ((d.linked || []).some((l) => l && l.kind === 'ref' && String(l.id) === r.key)) sel['repo:' + d.key] = true;
    }
    setBindSel(sel);
    setBindFor(r);
  };
  const saveBind = () => guard(async () => {
    if (!bindFor) return;
    const boardOf = (k) => boardList.find((b) => boardKeyOf(b) === k.slice('board:'.length));
    const oldKeys = new Set([
      ...boardList.filter((b) => (b.refs || []).some((l) => l.id === bindFor.key)).map((b) => 'board:' + boardKeyOf(b)),
      ...devRepos
        .filter((d) => (d.linked || []).some((l) => l && l.kind === 'ref' && String(l.id) === bindFor.key))
        .map((d) => 'repo:' + d.key),
    ]);
    const newKeys = new Set(Object.keys(bindSel).filter((k) => bindSel[k]));
    // 先加后摘（摘全部绑定也不会误删刚加的）
    for (const k of newKeys) {
      if (oldKeys.has(k)) continue;
      if (k.startsWith('board:')) {
        const b = boardOf(k);
        if (!b) continue;
        await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, board: [b.id] } });
      } else {
        await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, repo: [k.slice('repo:'.length)] } });
      }
    }
    for (const k of oldKeys) {
      if (newKeys.has(k)) continue;
      if (k.startsWith('board:')) {
        const b = boardOf(k);
        if (!b) continue;
        await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, board: [b.id], remove: true } });
      } else {
        await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, repo: [k.slice('repo:'.length)], remove: true } });
      }
    }
    setBindFor(null);
    await Promise.all([reload.repos(), reload.boards(), reload.refCheck()]);
  });

  return (
    <Modal size="wide" title={`参考仓库 · ${refRepos.length}`} onClose={onClose}>
      <div className="rp-modal-bar">
        <span className="acts">
          <Button small onClick={() => { setCloneTargets({}); setCloneOpen(true); }}>克隆参考仓库</Button>
          <Button small onClick={syncAll}>同步全部</Button>
          <Button small onClick={reload.refCheck}>检查</Button>
          {/* #114：「导入导出」与页头工具条同一入口，重复的那颗删掉。 */}
          <Button small onClick={() => {
            setRootsForm({ gitRepoRoot: settingInfo?.gitRepoRoot || '', gitDevRoot: settingInfo?.gitDevRoot || '' });
            setRootsOpen(true);
          }}>存储根</Button>
        </span>
      </div>
      {!settingInfo?.gitRepoRoot ? (
        <div className="rp-ref-warn">
          存储根未设置 —— 克隆会被拒绝。点「存储根」设一个非 C 盘目录（参考仓库体积不小，别放系统盘）。
        </div>
      ) : null}
      <div className="rp-ref-table-wrap">
        <table className="rp-ref-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '30px' }}></th>
              <th scope="col" style={{ width: '17%' }}>参考仓库</th>
              <th scope="col" style={{ width: '22%' }}>远程地址</th>
              <th scope="col">绑定对象（仓库组 / 单独仓库 · 点击跳转）</th>
              <th scope="col" style={{ width: '220px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {refRepos.map((r) => {
              const c = checkOf.get(r.id);
              // 绑定反查：组级（b.refs）与仓库级（refRepoBackLinks）并列，互不折算
              const links = boardList
                .map((b) => {
                  const l = (b.refs || []).find((x) => x.id === r.key);
                  return l ? { board: b, note: l.note || '' } : null;
                })
                .filter(Boolean);
              return (
                <tr key={r.id} id={'rp-refrepo-row-' + r.key}>
                  <td><span className={'rp-ref-dot' + (c ? (c.ok ? ' ok' : ' bad') : '')}
                    title={c ? (c.ok ? '检查通过' : c.issues.join('\n')) : '尚未检查'} /></td>
                  <td className="rp-ref-cell-name">
                    <strong>{r.name}</strong>
                    <DocsEntry docs={r.descDocs} onOpen={() => onDocs(r)} />
                  </td>
                  <td className="mono rp-ref-cell-remote">
                    <Copyable text={r.remote || ''} title="点击复制远程地址">{r.remote || '（无）'}</Copyable>
                  </td>
                  <td className="rp-ref-cell-links">
                    {(() => {
                      const groups = links;
                      const direct = refRepoBackLinks.get(r.key) || [];
                      if (!groups.length && !direct.length) {
                        return (
                          <>
                            <span className="muted rp-refs-none">未绑定</span>
                            <Button small className="rp-ref-bind" onClick={() => openBind(r)}>绑定…</Button>
                          </>
                        );
                      }
                      const open = !!refBindOpen[r.id];
                      const LIMIT = 4;
                      const shownGroups = open ? groups : groups.slice(0, LIMIT);
                      const shownDirect = open ? direct : direct.slice(0, LIMIT);
                      const collapsible = groups.length > LIMIT || direct.length > LIMIT;
                      return (
                        <>
                          {groups.length ? (
                            <div className="rp-bind-row">
                              <span className="rp-bind-label">仓库组</span>
                              {shownGroups.map((l) => (
                                <span className="rp-link-chip rp-link-chip-group" key={'board:' + l.board.id}>
                                  <button className="rp-link-chip-main"
                                    title={[l.note || '点击跳到这个组', '组级绑定（组内共享）'].join('\n')}
                                    onClick={() => onGoBind('board', l.board.id)}>
                                    <b>组</b>
                                    <span className="rp-link-chip-name">{l.board.name}</span>
                                  </button>
                                  <button className="rp-link-chip-note-btn"
                                    title={l.note ? `编辑组级描述：${l.note}` : '写这条组级描述（这个组里参考什么）'}
                                    onClick={() => onLinkNote(r, l.board.id, l.board.name, l.note)}>
                                    {l.note ? l.note.split('\n')[0] : '＋'}
                                  </button>
                                  <button className="rp-link-chip-x" title="从本组摘除（不影响其它组、也不动仓库级绑定）"
                                    onClick={() => onUnbind(r, l.board.id)}>×</button>
                                </span>
                              ))}
                              {!open && groups.length > LIMIT ? (
                                <button className="rp-bind-more" title="展开本行全部绑定"
                                  onClick={() => onRefBindOpen((m) => ({ ...m, [r.id]: true }))}>
                                  +{groups.length - LIMIT}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {direct.length ? (
                            <div className="rp-bind-row">
                              <span className="rp-bind-label">仓库</span>
                              {shownDirect.map((d) => (
                                <span className="rp-link-chip rp-link-chip-repo" key={'repo:' + d.repo.key}>
                                  <button className="rp-link-chip-main"
                                    title={[d.note || '直接绑定到这个仓库（不经过组）', `仓库 key: ${d.repo.key}`, '点击定位到仓库行'].join('\n')}
                                    onClick={() => onGoBind('repo', d.repo.key)}>
                                    <b>仓</b>
                                    <span className="rp-link-chip-name">{d.repo.name}</span>
                                    <span className="mono rp-link-chip-key">{d.repo.key}</span>
                                  </button>
                                  {d.note ? <i className="rp-link-chip-note" title={d.note}>{d.note.split('\n')[0]}</i> : null}
                                  <button className="rp-link-chip-x" title="从这个仓库摘除（不影响组级绑定）"
                                    onClick={() => onUnbindRepo(r, d.repo.key)}>×</button>
                                </span>
                              ))}
                              {!open && direct.length > LIMIT ? (
                                <button className="rp-bind-more" title="展开本行全部绑定"
                                  onClick={() => onRefBindOpen((m) => ({ ...m, [r.id]: true }))}>
                                  +{direct.length - LIMIT}
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {collapsible ? (
                            <button className="rp-bind-toggle"
                              onClick={() => onRefBindOpen((m) => ({ ...m, [r.id]: !open }))}>
                              {open ? '收起' : `展开全部 ${groups.length + direct.length}`}
                            </button>
                          ) : null}
                          <Button small className="rp-ref-bind" onClick={() => openBind(r)}>绑定…</Button>
                        </>
                      );
                    })()}
                  </td>
                  <td className="rp-acts">
                    <Button small onClick={() => onSyncOne(r)}>同步</Button>
                    <Button small onClick={() => onRowAct('open', r)}>打开</Button>
                    <Button small onClick={() => onRowAct('edit', r)}>编辑</Button>
                    <Button small danger onClick={() => onRowAct('del', r)}>删除</Button>
                  </td>
                </tr>
              );
            })}
            {!refRepos.length ? (
              <tr><td colSpan="5" className="muted rp-empty">
                还没有参考仓库 —— 点「克隆参考仓库」抓一个远程仓库下来（或用 CLI: nx-kv repo ref clone &lt;url&gt;）。
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 克隆参考仓库弹窗：绑定走选项式勾选（不手填 id 字符串） */}
      {cloneOpen ? (
        <Modal title="克隆参考仓库" onClose={() => { setCloneOpen(false); setCloneTargets({}); }}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="ref-url">远程 git 地址 *</label>
              <input id="ref-url" spellCheck="false" placeholder="git@github.com:lib/x.git 或 https://github.com/lib/x"
                value={cloneForm.url} onChange={(e) => setCloneForm((f) => ({ ...f, url: e.target.value }))} />
            </div>
            <div className="form-field">
              <label htmlFor="ref-name">名称</label>
              <input id="ref-name" placeholder="留空则用 URL 末段" value={cloneForm.name}
                onChange={(e) => setCloneForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-field">
              <label htmlFor="ref-desc">它参考什么</label>
              <input id="ref-desc" spellCheck="false" placeholder="如：liquid glass 的官方实现参考"
                value={cloneForm.desc} onChange={(e) => setCloneForm((f) => ({ ...f, desc: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>克隆后绑定到（可多选）</label>
              <div className="rp-pick-list">
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">开发仓库</span>
                  {devRepos.map((d) => (
                    <label className="rp-pick-item" key={d.id}>
                      <input type="checkbox" checked={!!cloneTargets['repo:' + d.id]}
                        onChange={(e) => setCloneTargets((m) => ({ ...m, ['repo:' + d.id]: e.target.checked }))} />
                      <span title={d.path}>{d.name}</span>
                    </label>
                  ))}
                  {!devRepos.length ? <span className="muted">（还没有开发仓库）</span> : null}
                </div>
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">看板（项目组）</span>
                  {boardList.map((b) => (
                    <label className="rp-pick-item" key={b.id}>
                      <input type="checkbox" checked={!!cloneTargets['board:' + b.id]}
                        onChange={(e) => setCloneTargets((m) => ({ ...m, ['board:' + b.id]: e.target.checked }))} />
                      <span title={b.desc || ''}>{b.name}</span>
                    </label>
                  ))}
                  {!boardList.length ? <span className="muted">（还没有看板）</span> : null}
                </div>
              </div>
              <div className="form-hint">一个参考可同时服务多个仓库/组；之后随时在「绑定…」里增删。</div>
            </div>
            <div className="form-acts">
              <Button  onClick={() => { setCloneOpen(false); setCloneTargets({}); }}>取消</Button>
              <Button  disabled={!cloneForm.url.trim() || !settingInfo?.gitRepoRoot}
                title={settingInfo?.gitRepoRoot ? `克隆到 ${settingInfo.gitRepoRoot}` : '先在「存储根」设置 gitRepoRoot'}
                onClick={doClone}>克隆</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 绑定管理弹窗（参考侧）：两类绑定并存、互不折算，全部选项式勾选 */}
      {bindFor ? (
        <Modal title={`绑定 · ${bindFor.name}`} onClose={() => setBindFor(null)}>
          <div className="form-grid">
            <div className="form-field">
              <div className="form-hint">
                两类绑定并存、互不折算：勾「仓库组」= 组内共享（group_refs）；勾「开发仓库」= 只绑这一个仓库（仓库级）。
                取消勾选 = 摘除该维度（保存时对比差异）。
              </div>
              <div className="rp-pick-list">
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">仓库组</span>
                  {boardList.map((b) => {
                    const bk = boardKeyOf(b);
                    return (
                      <label className="rp-pick-item" key={b.id}>
                        <input type="checkbox" checked={!!bindSel['board:' + bk]}
                          onChange={(e) => setBindSel((m) => ({ ...m, ['board:' + bk]: e.target.checked }))} />
                        <span title={b.desc || ''}>{b.name}</span>
                      </label>
                    );
                  })}
                  {!boardList.length ? <span className="muted">（还没有看板）</span> : null}
                </div>
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">开发仓库（单独绑定）</span>
                  {devRepos.map((d) => (
                    <label className="rp-pick-item" key={d.id}>
                      <input type="checkbox" checked={!!bindSel['repo:' + d.key]}
                        onChange={(e) => setBindSel((m) => ({ ...m, ['repo:' + d.key]: e.target.checked }))} />
                      <span title={d.path}>{d.name}</span>
                      <span className="muted mono rp-pick-desc">{d.key}</span>
                    </label>
                  ))}
                  {!devRepos.length ? <span className="muted">（还没有开发仓库）</span> : null}
                </div>
              </div>
            </div>
            <div className="form-acts">
              <Button  onClick={() => setBindFor(null)}>取消</Button>
              <Button  onClick={saveBind}>保存绑定</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 存储根设置弹窗 */}
      {rootsOpen ? (
        <Modal title="参考仓库存储根" onClose={() => setRootsOpen(false)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="roots-ref">参考仓库存储根（gitRepoRoot）</label>
              <input id="roots-ref" spellCheck="false" placeholder="如 D:/gitrepo-ref（非 C 盘）"
                value={rootsForm.gitRepoRoot} onChange={(e) => setRootsForm((f) => ({ ...f, gitRepoRoot: e.target.value }))} />
              <div className="form-hint">repo ref clone 的落盘位置。不设 = 克隆被拒绝。</div>
            </div>
            <div className="form-field">
              <label htmlFor="roots-dev">开发仓库克隆根（gitDevRoot，可选）</label>
              <input id="roots-dev" spellCheck="false" placeholder="导入布局时开发仓库克隆到哪里"
                value={rootsForm.gitDevRoot} onChange={(e) => setRootsForm((f) => ({ ...f, gitDevRoot: e.target.value }))} />
            </div>
            <div className="form-acts">
              <Button  onClick={() => setRootsOpen(false)}>取消</Button>
              <Button  onClick={saveRoots}>保存</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Modal>
  );
}
