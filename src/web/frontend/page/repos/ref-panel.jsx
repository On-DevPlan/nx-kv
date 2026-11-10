// 参考仓库面板（独立弹窗，宽表）：克隆 / 绑定 / 同步 / 检查 / 存储根。
//
// 与开发仓库分表——主表只放 dev，行内「参考」列显示绑到它的 ref。
// 每行：状态徽标 / 名称+描述 / 远程地址 / 绑定 chips / 操作。
// 绑定一律选项式（「绑定」弹窗里勾选），不手填字符串。
// 做成弹窗：它是「隔一阵来维护一次」的东西，平铺会把开发仓库主表顶到两屏之外。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Copyable } from '../../components/ui.jsx';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { DocsEntry } from './repo-table.jsx';

export default function RefPanel({ refRepos, devRepos, boardList, checkOf, onClose, onSyncOne, onUnbind, onLinkNote, onDocs, onRowAct, reload }) {
  const guard = useGuard();
  const toast = useToast();
  const [settingInfo, setSettingInfo] = useState(null); // gitRepoRoot / gitDevRoot 当前值
  const [rootsOpen, setRootsOpen] = useState(false);
  const [rootsForm, setRootsForm] = useState({ gitRepoRoot: '', gitDevRoot: '' });
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ url: '', name: '', desc: '', depth: '1' });
  // 选项式绑定：克隆时勾选目标（{repoId:true, boardId:true}）；绑定管理弹窗复用同一形状
  const [cloneTargets, setCloneTargets] = useState({});
  // 绑定管理弹窗：目标 ref（checkbox 列表 = 全部 dev 仓库 + 全部看板）
  const [bindFor, setBindFor] = useState(null); // ref 对象 | null
  const [bindSel, setBindSel] = useState({}); // { 'repo:<id>': bool, 'board:<id>': bool }

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

  // 绑定管理弹窗：打开时按该 ref 现有绑定勾选；保存 = 对比差异，加/摘各一批
  const openBind = (r) => {
    const sel = {};
    for (const l of r.linked || []) sel[l.kind + ':' + l.id] = true;
    setBindSel(sel);
    setBindFor(r);
  };
  const saveBind = () => guard(async () => {
    if (!bindFor) return;
    const oldKeys = new Set((bindFor.linked || []).map((l) => l.kind + ':' + l.id));
    const newKeys = new Set(Object.keys(bindSel).filter((k) => bindSel[k]));
    // 先加后摘（摘全部绑定也不会误删刚加的）
    for (const k of newKeys) {
      if (oldKeys.has(k)) continue;
      const [kind, id] = k.split(':');
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, [kind]: [id] } });
    }
    for (const k of oldKeys) {
      if (newKeys.has(k)) continue;
      const [kind, id] = k.split(':');
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, [kind]: [id], remove: true } });
    }
    setBindFor(null);
    await Promise.all([reload.repos(), reload.refCheck()]);
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
              <th scope="col">绑定（组 / 仓库 · 点击写描述 · × 摘除）</th>
              <th scope="col" style={{ width: '220px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {refRepos.map((r) => {
              const c = checkOf.get(r.id);
              const links = r.linked || [];
              return (
                <tr key={r.id}>
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
                    {links.length ? links.map((l) => {
                      // 绑定目标按 key 找（关系引用一律是 key）
                      const label = l.kind === 'board'
                        ? (boardList.find((b) => (b.key || `board/${b.name}`) === l.id)?.name || l.id)
                        : (devRepos.find((d) => d.key === l.id)?.name || l.id);
                      return (
                        <span className="rp-link-chip" key={l.kind + ':' + l.id}>
                          <button className="rp-link-chip-main" title={l.note ? `${l.note}\n点击编辑这条绑定描述` : `点击写「${r.name}」绑定到这里的描述`}
                            onClick={() => onLinkNote(r, l.kind, l.id, label)}>
                            <b>{l.kind === 'board' ? '组' : '仓'}</b> {label}
                            {l.note ? <i className="rp-link-chip-note" title={l.note}>{l.note.split('\n')[0]}</i> : null}
                          </button>
                          <button className="rp-link-chip-x" title={`摘除这条绑定（不影响其它）`}
                            onClick={() => onUnbind(r, l.kind, l.id)}>×</button>
                        </span>
                      );
                    }) : <span className="muted rp-refs-none">未绑定</span>}
                    <Button small className="rp-ref-bind" onClick={() => openBind(r)}>绑定…</Button>
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

      {/* 绑定管理弹窗（参考侧）：这个参考绑到哪些开发仓库 / 看板 —— 全部选项式勾选 */}
      {bindFor ? (
        <Modal title={`绑定 · ${bindFor.name}`} onClose={() => setBindFor(null)}>
          <div className="form-grid">
            <div className="form-field">
              <div className="form-hint">
                勾选 = 绑定，取消 = 摘除（保存时对比差异）。一个参考可同时绑多个仓库/组。
              </div>
              <div className="rp-pick-list">
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">开发仓库</span>
                  {devRepos.map((d) => (
                    <label className="rp-pick-item" key={d.id}>
                      <input type="checkbox" checked={!!bindSel['repo:' + d.id]}
                        onChange={(e) => setBindSel((m) => ({ ...m, ['repo:' + d.id]: e.target.checked }))} />
                      <span title={d.path}>{d.name}</span>
                    </label>
                  ))}
                  {!devRepos.length ? <span className="muted">（还没有开发仓库）</span> : null}
                </div>
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">看板（项目组）</span>
                  {boardList.map((b) => (
                    <label className="rp-pick-item" key={b.id}>
                      <input type="checkbox" checked={!!bindSel['board:' + b.id]}
                        onChange={(e) => setBindSel((m) => ({ ...m, ['board:' + b.id]: e.target.checked }))} />
                      <span title={b.desc || ''}>{b.name}</span>
                    </label>
                  ))}
                  {!boardList.length ? <span className="muted">（还没有看板）</span> : null}
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
