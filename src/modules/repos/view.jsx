// 仓库上下文页：**一张扁平的中心清单** + 看板（只当筛选器与标签用）。
//
// **来历**：原本长在 nx-rh，2026-10-23 整体迁到 nx-kv（远程清单 topic=goal 的 #72）——
// 仓库登记是本机事实，它的价值是给「本地任务管理」当上下文，所以它跟着任务走。
// 每个按钮 = 一条 HTTP 路由 = 一条 CLI 命令（三者同源于模块的 action 声明）。
//
// 版面：**中心清单 + 看板只是标签**。
//   - 仓库登记是唯一真相，一直在这张清单里；
//   - 看板只存引用 → **加入看板是复制**，不是移动：同一个仓库可以同时在多个
//     看板里（fr 同时在「fr常用」与「远程打字」）；
//   - 取消某份副本只摘那个看板的引用，仓库本体纹丝不动。
//
// 之前这一页是「按看板分组的卡片墙 + 拖拽」：同一套数据，但读起来就是「移动」，
// 而且同一个仓库会在多个分组里重复出现、看不到全貌。现在主视图是扁平的中心清单，
// 看板退成上方的筛选器与行内的标签。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useStore } from '../../web/frontend/store.jsx';
import { useGuard, useDialog, useToast, Modal, Copyable } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

const EMPTY_FORM = { path: '', name: '', desc: '', notes: '' };

// 路径照搬目录看板的「可扫标签」画法：祖先目录变暗、末段略重，点击复制全文。
// 纯灰一长串（旧画法）里，人眼要逐字符对比才能找到目录名。
function RepoPath({ path }) {
  const s = String(path || '');
  const cut = s.replace(/\\/g, '/').lastIndexOf('/');
  if (cut < 0) return <Copyable text={s}>{s}</Copyable>;
  return (
    <Copyable text={s} title="点击复制完整路径">
      <span className="anc">{s.slice(0, cut)}</span>
      {s.slice(cut)}
    </Copyable>
  );
}

// 仓库行：名称 + 描述 / 路径（点击复制）/ 操作。
// 中心清单里**不再显示所属看板**——行内的 chip + × + 下拉三件套又挤又乱，
// 归属的增删统一走「成员管理」弹窗（筛选到看板 → 导入仓库 / 摘除）。
// 看板视图下描述行显示**组内描述**（该仓库在这个组里的角色），没写则回退仓库描述。
function RepoRow({ r, filterBoard, acts }) {
  const note = filterBoard
    ? ((r.boards || []).find((b) => b.id === filterBoard.id)?.note || '')
    : null;
  const desc = note !== null ? (note || r.desc || '') : (r.desc || '');
  const descTitle = note !== null
    ? (note ? `组内描述：${note}` : `（组内描述未写，暂显示仓库描述）${r.desc || ''}`)
    : (r.desc || '');
  return (
    <tr>
      <td className="rp-name">
        <strong>{r.name}</strong>
        {desc ? <div className="muted rp-desc" title={descTitle}>{desc}</div> : null}
      </td>
      <td className="mono rp-path"><RepoPath path={r.path} /></td>
      <td className="rp-acts">
        <button className="btn small ghost" title="在文件管理器中打开" onClick={() => acts.open(r)}>打开</button>
        <button className="btn small ghost" onClick={() => acts.edit(r)}>编辑</button>
        {filterBoard ? (
          <button className="btn small ghost" title={`写「${r.name}」在看板「${filterBoard.name}」里的组内描述`}
            onClick={() => acts.note(r)}>描述</button>
        ) : null}
        <button className="btn small ghost rp-del" onClick={() => acts.del(r)}>删除</button>
      </td>
    </tr>
  );
}

export default function ReposView() {
  const { boot } = useStore();
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scan, setScan] = useState({ root: '', depth: '3' });
  const [scanResult, setScanResult] = useState(null);
  // 成员管理弹窗：打开时 = 正在往这个看板里点选导入 / 摘除仓库
  const [impBoardId, setImpBoardId] = useState(null);
  // 组内描述编辑：{ id, repo, boardId, boardName, note } | null
  const [noteFor, setNoteFor] = useState(null);
  const [noteText, setNoteText] = useState('');

  // 看板（只作筛选与标签）
  const [boards, setBoards] = useState(null); // { boards: [...], unassigned: [...] }
  const [filter, setFilter] = useState(''); // '' = 全部（中心清单）
  const [boardForm, setBoardForm] = useState(null); // null | { id?, name, desc }
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState('');
  const [expText, setExpText] = useState(null);
  const [boardsOpen, setBoardsOpen] = useState(false);

  // 仓库中心清单（扁平；每条带 boards）
  const [repos, setRepos] = useState([]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setFormOpen(false); };

  const loadRepos = useCallback(async () => {
    setRepos((await api('/api/repos').catch(() => [])) || []);
  }, []);
  const loadBoards = useCallback(async () => {
    setBoards(await api('/api/boards').catch(() => null));
  }, []);
  useEffect(() => { loadRepos(); loadBoards(); }, [loadRepos, loadBoards]);

  // 组内描述保存：note 为空 = 清除
  const saveNote = () => guard(async () => {
    await api('/api/boards/note', {
      method: 'POST',
      body: { id: noteFor.id, board: noteFor.boardId, note: noteText },
    });
    setNoteFor(null);
    await Promise.all([loadRepos(), loadBoards()]);
    toast('已保存组内描述');
  });

  // 看板清单（用来做「+ 看板」下拉与筛选器）
  const boardList = useMemo(() => (boards && boards.boards) || [], [boards]);

  // 筛选后的中心清单：选某个看板时**只显示该看板的仓库**，
  // 且去重（一个仓库在多个看板里也只出现一次 —— 它在中心清单里只有一条）。
  const shown = useMemo(() => {
    if (!filter) return repos;
    return repos.filter((r) => (r.boards || []).some((b) => b.id === filter));
  }, [repos, filter]);

  // 当前筛选到的看板（用来显示领域描述上下文条）与成员管理弹窗的目标看板
  const filterBoard = useMemo(() => boardList.find((b) => b.id === filter) || null, [boardList, filter]);
  const impBoard = useMemo(() => boardList.find((b) => b.id === impBoardId) || null, [boardList, impBoardId]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setFormOpen(true);
  };

  const submit = () => guard(async () => {
    if (!form.path.trim()) return;
    const body = {
      path: form.path.trim(),
      name: form.name.trim() || undefined,
      desc: form.desc.trim() || undefined,
      notes: form.notes,
    };
    if (editing) await api(`/api/repos/${encodeURIComponent(editing)}`, { method: 'PATCH', body });
    else await api('/api/repos', { method: 'POST', body });
    resetForm();
    await Promise.all([loadRepos(), loadBoards()]);
  });

  // 扫描两种意图：只发现（零副作用）/ 扫描登记（真登记）。
  const doScan = (dryRun) => guard(async () => {
    const root = scan.root.trim() || boot?.projectRoot || '';
    if (!root) return;
    const r = await api('/api/repos/scan', {
      method: 'POST',
      body: { root, depth: parseInt(scan.depth, 10) || 3, 'dry-run': dryRun },
    });
    const lines = (r.found || []).map((x) => `  ${x.known ? '已登记' : '未登记'}  ${x.path}`);
    if (dryRun) {
      setScanResult(`发现 ${r.root} 下 ${r.scanned} 个 git 仓库（未登记，磁盘与登记表都没动）`
        + (lines.length ? '\n\n' + lines.join('\n') : '\n')
        + (r.scanned ? '\n\n要收进来：点「扫描登记」，或逐个 nx-kv repo add <path> --desc "一句话描述"' : ''));
    } else {
      setScanResult(`扫描 ${r.root}: 发现 ${r.scanned} 个仓库，新登记 ${r.added.length} 个`
        + (r.added.length ? '\n\n' + r.added.map((x) => `  + ${x.name}  ${x.path}`).join('\n') : ''));
    }
    setScanOpen(false);
    await Promise.all([loadRepos(), loadBoards()]);
  });

  const rowAct = (act, r) => guard(async () => {
    if (act === 'open') {
      await api('/api/repos/open', { method: 'POST', body: { id: r.id } });
    } else if (act === 'edit') {
      setEditing(r.id);
      setForm({
        path: r.path,
        name: r.name || '',
        desc: r.desc || '',
        tags: (r.tags || []).join(','),
        notes: r.notes || '',
      });
      setFormOpen(true);
    } else if (act === 'del') {
      const ok = await dialog({
        message: `删除仓库登记「${r.name}」？（仅移除登记，磁盘文件不受影响；各看板里的归属同步摘除）`,
        danger: true,
      });
      if (!ok) return;
      await api(`/api/repos/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      await Promise.all([loadRepos(), loadBoards()]);
    }
  });

  // ---- 看板归属：**复制**，不是移动 ----
  // 加一个看板 = 多一份归属，仓库本体不动、别的看板也不动；
  // 移出某个看板 = 只摘那一份，仓库本体不动。
  // 行内的加/摘入口已收进「成员管理」弹窗（toggleMember），表格式逐行操作太乱。
  const toggleMember = (r, add) => guard(async () => {
    await api('/api/boards/assign', {
      method: 'POST',
      body: add ? { id: r.id, board: impBoardId } : { id: r.id, board: impBoardId, remove: true },
    });
    setRepos((await api('/api/repos')) || []);
    await loadBoards();
  });

  // ---- 看板管理 ----
  const saveBoard = () => guard(async () => {
    const body = { name: boardForm.name.trim(), desc: boardForm.desc.trim() };
    if (!body.name) return;
    if (boardForm.id) await api(`/api/boards/${encodeURIComponent(boardForm.id)}`, { method: 'PATCH', body });
    else await api('/api/boards', { method: 'POST', body });
    setBoardForm(null);
    await loadBoards();
  });

  const removeBoard = (b) => guard(async () => {
    const ok = await dialog({
      message: `删看板「${b.name}」？它里面的 ${b.repos.length} 个仓库**仍留在中心清单里**（只是少了一份归属）。`,
      danger: true,
    });
    if (!ok) return;
    await api(`/api/boards/${encodeURIComponent(b.id)}`, { method: 'DELETE', body: {} });
    await Promise.all([loadRepos(), loadBoards()]);
  });

  const doImport = () => guard(async () => {
    if (!impText.trim()) return;
    const r = await api('/api/boards/import', { method: 'POST', body: { json: impText } });
    setImpOpen(false);
    setImpText('');
    toast(`已导入：新建 ${r.created} 个看板、合并 ${r.merged} 个、匹配仓库 ${r.matched} 个`
      + (r.unmatched.length ? `；未匹配 ${r.unmatched.length} 条（见 CLI board import 输出）` : ''));
    await Promise.all([loadRepos(), loadBoards()]);
  });

  const doExport = () => guard(async () => {
    const r = await api('/api/boards/export');
    setExpText(JSON.stringify(r, null, 2));
  });

  const readImpFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImpText(await f.text());
  };

  if (boards === null) {
    return (
      <>
        <div className="muted" style={{ padding: 20 }}>读取中…</div>
        {dialogNode}
      </>
    );
  }

  const rowActs = {
    open: (r) => rowAct('open', r),
    edit: (r) => rowAct('edit', r),
    del: (r) => rowAct('del', r),
    note: (r) => {
      const mine = (r.boards || []).find((b) => b.id === filter);
      setNoteFor({
        id: r.id,
        repo: r.name,
        boardId: filter,
        boardName: filterBoard?.name || '',
        note: mine?.note || '',
      });
      setNoteText(mine?.note || '');
    },
  };

  return (
    <>
      <div className="page-head">
        <div className="title-block">
          <h2>仓库</h2>
          <div className="page-desc">
            本机 git 仓库的<strong>中心清单</strong>。看板 = <strong>领域分组</strong>
            （同一个仓库可同时归入多个）：看板的领域描述写这组仓库的侧重与配合关系，
            成员仓库还能写<strong>组内描述</strong>——它在组里的角色、关键路径与搜索关键词
            （筛选到看板后点行内「描述」）。加入是复制一份归属，仓库本体永远在清单里。
          </div>
        </div>
        <div className="acts">
          <button className="btn ghost" onClick={() => setScanOpen(true)}>扫描</button>
          <button className="btn" onClick={openAdd}>添加仓库</button>
        </div>
      </div>

      {scanResult ? (
        <div className="card">
          <div className="colhead"><h3>扫描结果</h3>
            <span className="muted" style={{ marginLeft: 'auto' }}>
              <button className="btn small ghost" onClick={() => setScanResult(null)}>关闭</button>
            </span>
          </div>
          <pre style={{ padding: 12 }}>{scanResult}</pre>
        </div>
      ) : null}

      {/* 看板筛选器：看板只是筛选维度，中心清单永远是那一张 */}
      <div className="rp-filters" data-testid="rp-filters">
        <button
          className={'rp-chip' + (filter ? '' : ' on')}
          onClick={() => setFilter('')}
          title="显示全部仓库（中心清单）"
        >
          全部 <b>{repos.length}</b>
        </button>
        {boardList.map((b) => (
          <button
            key={b.id}
            className={'rp-chip' + (filter === b.id ? ' on' : '')}
            onClick={() => setFilter(filter === b.id ? '' : b.id)}
            title={`只看「${b.name}」里的仓库（${b.repos.length} 个）`}
          >
            {b.name} <b>{b.repos.length}</b>
          </button>
        ))}
        <button className="rp-chip rp-chip-manage" onClick={() => setBoardsOpen(!boardsOpen)}>
          看板管理{boardsOpen ? ' ▾' : ' ▸'}
        </button>
      </div>

      {/* 看板上下文条：筛选到某个看板时，把它的领域描述亮出来 —— desc 写的是
          这个领域的侧重、谁配合谁（谁是中心/终端）、关键路径与搜索关键词。 */}
      {filterBoard ? (
        <div className="rp-context" data-testid="rp-context">
          <span className="rp-context-name">{filterBoard.name}</span>
          {filterBoard.desc ? (
            <span className="rp-context-desc" title={filterBoard.desc}>{filterBoard.desc}</span>
          ) : (
            <span className="muted rp-context-desc">
              还没有领域描述 —— 点「看板管理」补一句：侧重什么、谁配合谁、关键路径与搜索关键词在哪。
            </span>
          )}
          <span className="acts">
            <button className="btn small" onClick={() => setImpBoardId(filterBoard.id)}>导入仓库</button>
          </span>
        </div>
      ) : null}

      {/* 看板管理（次要）：建 / 改 / 删 / 导入 / 导出 */}
      {boardsOpen ? (
        <div className="card rp-boards-manage">
          <div className="colhead">
            <h3>看板</h3>
            <span className="muted">看板 = 领域分组，描述写给人和 agent 读：侧重、配合关系、关键路径与关键词。删一个看板，仓库全都在清单里，只是少了一份归属。</span>
            <span className="acts" style={{ marginLeft: 'auto' }}>
              <button className="btn small ghost" onClick={() => setBoardForm({ id: null, name: '', desc: '' })}>新建看板</button>
              <button className="btn small ghost" title="粘贴/选择看板 JSON，一个看板 = 一个主题" onClick={() => setImpOpen(true)}>导入看板</button>
              <button className="btn small ghost" onClick={doExport}>导出</button>
            </span>
          </div>
          <div className="rp-board-list">
            {boardList.map((b) => (
              <div className="rp-board-item" key={b.id}>
                <span className="rp-board-name">{b.name}</span>
                {b.desc ? <span className="muted rp-board-desc" title={b.desc}>{b.desc}</span> : null}
                <span className="rp-board-count">{b.repos.length} 个仓库</span>
                <span className="acts">
                  <button className="btn small ghost" title="点选加入/摘除这个看板的成员仓库" onClick={() => setImpBoardId(b.id)}>成员管理</button>
                  <button className="btn small ghost" onClick={() => setBoardForm({ id: b.id, name: b.name, desc: b.desc || '' })}>编辑</button>
                  <button className="btn small ghost" onClick={() => removeBoard(b)}>删除看板</button>
                </span>
              </div>
            ))}
            {!boardList.length ? <div className="muted">还没有看板 —— 建一个当标签用。</div> : null}
            {boardList.length && boards.unassigned?.length ? (
              <div className="rp-boards-unassigned">
                未分组 <b>{boards.unassigned.length}</b> 个 —— 不属于任何看板，只在「全部」里可见。
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 中心清单：扁平的仓库表，一行一个仓库，不分组 */}
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '32%' }}>仓库</th>
              <th scope="col" style={{ width: '42%' }}>路径</th>
              <th scope="col" style={{ width: '26%' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <RepoRow key={r.id} r={r} filterBoard={filterBoard} acts={rowActs} />
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan="3" className="muted rp-empty">
                  {repos.length
                    ? '这个看板还没有成员 —— 点上方「导入仓库」，从中心清单里点选加入。'
                    : '还没有登记仓库 —— 点「扫描」自动发现，或「添加仓库」手工登记。'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <CliHints module="repos" />

      {/* 添加 / 编辑仓库弹窗 */}
      {formOpen ? (
        <Modal title={editing ? `编辑仓库 · ${editing}` : '添加仓库'} onClose={resetForm}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="repo-path">仓库绝对路径 *</label>
              <input id="repo-path" placeholder="D:/code/my-project" spellCheck="false" value={form.path} onChange={set('path')} />
            </div>
            <div className="form-field">
              <label htmlFor="repo-name">名称</label>
              <input id="repo-name" placeholder="留空则用目录末段" value={form.name} onChange={set('name')} />
            </div>
            <div className="form-field">
              <label htmlFor="repo-desc">一句话描述</label>
              <input id="repo-desc" spellCheck="false" placeholder="这个仓库是干什么的" value={form.desc} onChange={set('desc')} />
            </div>
            <div className="form-field">
              <label htmlFor="repo-notes">备注</label>
              <textarea id="repo-notes" placeholder="补充信息（可选）" value={form.notes} onChange={set('notes')} />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={resetForm}>取消</button>
              <button className="btn" disabled={!form.path.trim()} onClick={submit}>
                {editing ? '保存修改' : '添加仓库'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 扫描弹窗 */}
      {scanOpen ? (
        <Modal title="扫描目录下的 git 仓库" onClose={() => setScanOpen(false)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="scan-root">扫描根目录</label>
              <input id="scan-root" placeholder="留空＝当前项目目录" spellCheck="false" value={scan.root}
                onChange={(e) => setScan({ ...scan, root: e.target.value })} />
            </div>
            <div className="form-field">
              <label htmlFor="scan-depth">深度</label>
              <input id="scan-depth" type="number" min="1" max="10" value={scan.depth}
                onChange={(e) => setScan({ ...scan, depth: e.target.value })} />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setScanOpen(false)}>取消</button>
              <button className="btn ghost" title="只列出发现的 git 仓库，不登记" onClick={() => doScan(true)}>只发现</button>
              <button className="btn" onClick={() => doScan(false)}>扫描登记</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 新建 / 编辑看板弹窗 */}
      {boardForm ? (
        <Modal title={boardForm.id ? '编辑看板' : '新建看板'} onClose={() => setBoardForm(null)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="bd-name">看板名称 *</label>
              <input
                id="bd-name"
                placeholder="如 前端 / AI 工具"
                value={boardForm.name}
                onChange={(e) => setBoardForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="bd-desc">领域描述</label>
              <textarea
                id="bd-desc"
                rows={4}
                spellCheck="false"
                placeholder={'这组仓库在这个环境里的侧重、配合关系、关键路径与搜索关键词。\n如：go-ah 是 OIDC 认证中心（issuer 192.0.2.47:8082），组内其余仓库都是它的接入终端。\n如：fr 组内仓库共享 API 契约（lib/api/），搜 fr_ 前缀。'}
                value={boardForm.desc}
                onChange={(e) => setBoardForm((f) => ({ ...f, desc: e.target.value }))}
              />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setBoardForm(null)}>取消</button>
              <button className="btn" disabled={!boardForm.name.trim()} onClick={saveBoard}>
                {boardForm.id ? '保存' : '新建看板'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 导入看板弹窗 */}
      {impOpen ? (
        <Modal title="导入看板 JSON" onClose={() => { setImpOpen(false); setImpText(''); }}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="bd-imp">看板 JSON</label>
              <div className="form-hint">
                结构 {'{ boards:[{ name, repos:[{ path|name }] }] }'} —— 按 path 或 name 匹配已登记仓库，匹配不上的会如实报告
              </div>
              <input
                id="bd-imp-file"
                type="file"
                accept=".json,application/json"
                onChange={readImpFile}
              />
              <textarea
                id="bd-imp"
                rows={10}
                spellCheck="false"
                placeholder='{"boards":[{"name":"前端","repos":[{"path":"D:/code/a_js/proj/nx-ft"}]}]}'
                value={impText}
                onChange={(e) => setImpText(e.target.value)}
              />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => { setImpOpen(false); setImpText(''); }}>取消</button>
              <button className="btn" disabled={!impText.trim()} onClick={doImport}>导入</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 导出结果 */}
      {expText ? (
        <Modal title="看板 JSON（可回灌给导入）" onClose={() => setExpText(null)}>
          <textarea className="bd-exp" rows={14} readOnly value={expText} spellCheck="false" />
        </Modal>
      ) : null}

      {/* 组内描述编辑：同一个仓库在不同看板里的角色各不相同，描述挂在成员关系上。
          agent 读看板时会把它带上（见 kv-repo skill），所以值得写关键路径与搜索词。 */}
      {noteFor ? (
        <Modal title={`组内描述 · ${noteFor.repo} @「${noteFor.boardName}」`} onClose={() => setNoteFor(null)}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="rp-note">「{noteFor.repo}」在看板「{noteFor.boardName}」里的角色</label>
              <div className="form-hint">
                写它在这个组里的特殊点与配合关系（谁是中心 / 终端、API 关联在哪），
                可多行、可含关键路径与搜索关键词。留空保存 = 清除。
              </div>
              <textarea
                id="rp-note"
                rows={5}
                spellCheck="false"
                placeholder={'如：OIDC 认证中心（issuer 192.0.2.47:8082），组内其余仓库都是它的接入终端；\nAPI 契约见 internal/middleware/oidc.go，搜 oidc_ 前缀。'}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setNoteFor(null)}>取消</button>
              <button className="btn" onClick={saveNote}>保存</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 成员管理弹窗：一个看板的全部候选仓库，点选加入 / 摘除 —— 批量导入
          不必回「全部」逐行找下拉。加/摘即存，弹窗保持打开，一次导一批。 */}
      {impBoard ? (
        <Modal title={`「${impBoard.name}」· 成员仓库`} onClose={() => setImpBoardId(null)}>
          {impBoard.desc ? <div className="rp-imp-desc">{impBoard.desc}</div> : null}
          <div className="rp-imp-list">
            {repos.map((r) => {
              const inBoard = (r.boards || []).some((b) => b.id === impBoard.id);
              return (
                <div className="rp-imp-item" key={r.id}>
                  <span className="rp-imp-name">{r.name}</span>
                  <span className="rp-imp-path" title={r.path}>{r.path}</span>
                  {inBoard ? (
                    <button className="btn small ghost" onClick={() => toggleMember(r, false)}>摘除</button>
                  ) : (
                    <button className="btn small" onClick={() => toggleMember(r, true)}>加入</button>
                  )}
                </div>
              );
            })}
            {!repos.length ? <div className="muted rp-empty">还没有登记仓库 —— 先「扫描」或「添加仓库」。</div> : null}
          </div>
        </Modal>
      ) : null}

      {dialogNode}
    </>
  );
}
