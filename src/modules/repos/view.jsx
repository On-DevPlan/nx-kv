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

const EMPTY_FORM = { path: '', name: '', desc: '', notes: '', type: 'dev', remote: '' };

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
// 主表只放开发仓库（type=dev）——参考仓库有自己的大面板，两份名单不混。
// 「参考」列显示**绑定到这个开发仓库**的参考仓库（多对多：一个 dev 可挂多个 ref）。
function RepoRow({ r, filterBoard, refsOfRepo, acts }) {
  const note = filterBoard
    ? ((r.boards || []).find((b) => b.id === filterBoard.id)?.note || '')
    : null;
  const desc = note !== null ? (note || r.desc || '') : (r.desc || '');
  const descTitle = note !== null
    ? (note ? `组内描述：${note}` : `（组内描述未写，暂显示仓库描述）${r.desc || ''}`)
    : (r.desc || '');
  const refs = refsOfRepo.get(r.id) || [];
  return (
    <tr>
      <td className="rp-name">
        <strong>{r.name}</strong>
        {desc ? <div className="muted rp-desc" title={descTitle}>{desc}</div> : null}
      </td>
      <td className="mono rp-path"><RepoPath path={r.path} /></td>
      <td className="rp-refs">
        {refs.length ? refs.map((ref) => (
          <button key={ref.id} className="rp-ref-chip" title={`直接绑定：${ref.remote || ''}${ref.note ? '\n' + ref.note : ''}\n点击改绑定描述`}
            onClick={() => acts.refNote(ref, r)}>
            {ref.note ? <span className="rp-ref-chip-dot" /> : null}
            {ref.name}
          </button>
        )) : <span className="muted rp-refs-none">—</span>}
        <button className="btn small ghost rp-ref-bind" title="管理这个仓库绑定的参考仓库" onClick={() => acts.bind(r)}>绑定</button>
      </td>
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

  // ---- 参考仓库（type=ref）大面板状态 ----
  const [refOpen, setRefOpen] = useState(false);
  const [settingInfo, setSettingInfo] = useState(null); // gitRepoRoot / gitDevRoot 当前值
  const [rootsOpen, setRootsOpen] = useState(false);
  const [rootsForm, setRootsForm] = useState({ gitRepoRoot: '', gitDevRoot: '' });
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneForm, setCloneForm] = useState({ url: '', name: '', desc: '', depth: '1' });
  // 选项式绑定：克隆时勾选目标（{repoId:true, boardId:true}）；绑定管理弹窗复用同一形状
  const [cloneTargets, setCloneTargets] = useState({});
  const [refCheck, setRefCheck] = useState(null); // repo.ref.check 的结果（状态徽标的数据面）
  // 绑定管理弹窗：目标 ref（checkbox 列表 = 全部 dev 仓库 + 全部看板）
  const [bindFor, setBindFor] = useState(null); // ref 对象 | null
  const [bindSel, setBindSel] = useState({}); // { 'repo:<id>': bool, 'board:<id>': bool }
  // dev 侧绑定弹窗：某个开发仓库 → 勾选绑到它身上的参考
  const [bindRepoFor, setBindRepoFor] = useState(null); // dev 仓库对象 | null
  const [bindRepoSel, setBindRepoSel] = useState({}); // { refId: bool }
  // 绑定描述编辑：{ ref, kind:'repo'|'board', targetId, targetName, note } | null
  const [linkNoteFor, setLinkNoteFor] = useState(null);
  const [linkNoteText, setLinkNoteText] = useState('');
  // 布局导入导出
  const [impLayoutOpen, setImpLayoutOpen] = useState(false);
  const [impLayoutText, setImpLayoutText] = useState('');
  const [impLayoutPlan, setImpLayoutPlan] = useState(null); // plan:true 的预览
  const [impLayoutClone, setImpLayoutClone] = useState('none');
  const [impLayoutOnly, setImpLayoutOnly] = useState({}); // remoteKey -> bool（选择性克隆）
  const [expLayoutText, setExpLayoutText] = useState(null);

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setFormOpen(false); };

  const loadRepos = useCallback(async () => {
    setRepos((await api('/api/repos').catch(() => [])) || []);
  }, []);
  const loadBoards = useCallback(async () => {
    setBoards(await api('/api/boards').catch(() => null));
  }, []);
  useEffect(() => { loadRepos(); loadBoards(); }, [loadRepos, loadBoards]);

  // ---- 参考仓库：设置 / 检查 / 克隆 / 同步 / 布局导入导出 ----
  const loadSetting = useCallback(async () => {
    setSettingInfo(await api('/api/setting').catch(() => null));
  }, []);
  const loadRefCheck = useCallback(async () => {
    setRefCheck(await api('/api/repos/ref/check').catch(() => null));
  }, []);
  useEffect(() => { loadSetting(); loadRefCheck(); }, [loadSetting, loadRefCheck]);

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
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  const syncOne = (r) => guard(async () => {
    const d = await api('/api/repos/ref/sync', { method: 'POST', body: { id: r.id } });
    toast(d.status === 'updated' ? `已更新: ${d.name}` : d.status === 'upToDate' ? `${d.name} 已是最新` : `${d.name}: ${d.status} ${d.output || ''}`);
  });

  const syncAll = () => guard(async () => {
    const d = await api('/api/repos/ref/sync', { method: 'POST', body: { all: true } });
    const bad = d.results.filter((x) => x.status !== 'updated' && x.status !== 'upToDate');
    toast(`同步 ${d.synced} 个${bad.length ? `，${bad.length} 个有问题（见检查结果）` : '，全部完成'}`);
    await loadRefCheck();
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
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.id, [kind]: [id] } });
    }
    for (const k of oldKeys) {
      if (newKeys.has(k)) continue;
      const [kind, id] = k.split(':');
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.id, [kind]: [id], remove: true } });
    }
    setBindFor(null);
    await Promise.all([loadRepos(), loadRefCheck()]);
  });

  // dev 侧绑定保存：对比该仓库当前挂的参考，加/摘各一批
  const saveBindRepo = () => guard(async () => {
    if (!bindRepoFor) return;
    // 当前绑定：dev 侧反向引用优先，老数据回退扫 ref 侧
    const current = new Set();
    for (const l of bindRepoFor.linked || []) {
      if (l.kind === 'ref') current.add(l.id);
    }
    for (const x of refRepos) {
      if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === bindRepoFor.id)) current.add(x.id);
    }
    const want = new Set(Object.keys(bindRepoSel).filter((k) => bindRepoSel[k]));
    for (const rid of want) {
      if (current.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [bindRepoFor.id] } });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [bindRepoFor.id], remove: true } });
    }
    setBindRepoFor(null);
    await Promise.all([loadRepos(), loadRefCheck()]);
  });
  // 绑定描述：从 dev 行的参考 chip 或绑定管理弹窗进入
  const openLinkNote = (ref, kind, targetId, targetName) => {
    const link = (ref.linked || []).find((l) => l.kind === kind && l.id === targetId);
    setLinkNoteFor({ ref, kind, targetId, targetName });
    setLinkNoteText(link?.note || '');
  };
  const saveLinkNote = () => guard(async () => {
    const { ref, kind, targetId } = linkNoteFor;
    await api('/api/repos/ref/note', {
      method: 'POST',
      body: { id: ref.id, [kind]: targetId, note: linkNoteText },
    });
    setLinkNoteFor(null);
    await Promise.all([loadRepos(), loadRefCheck()]);
    toast('已保存绑定描述');
  });

  // 从某条绑定弹窗摘除单个目标（chip 上的 ×）
  const unbindOne = (ref, kind, targetId) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.id, [kind]: [targetId], remove: true } });
    await Promise.all([loadRepos(), loadRefCheck()]);
  });

  // 布局导入：先 plan 预览（零副作用），确认后带 only 执行
  const planLayout = () => guard(async () => {
    if (!impLayoutText.trim()) return;
    const d = await api('/api/repos/import', {
      method: 'POST',
      body: { json: impLayoutText, plan: true, clone: impLayoutClone },
    });
    setImpLayoutPlan(d);
    const preset = {};
    (d.repos || []).forEach((r) => { if (r.rkey) preset[r.rkey] = r.cloneWanted; });
    setImpLayoutOnly(preset);
  });

  const runLayout = () => guard(async () => {
    const only = Object.keys(impLayoutOnly).filter((k) => impLayoutOnly[k]);
    const d = await api('/api/repos/import', {
      method: 'POST',
      body: { json: impLayoutText, clone: impLayoutClone, only },
    });
    setImpLayoutOpen(false);
    setImpLayoutPlan(null);
    setImpLayoutText('');
    toast(`已导入：登记 ${d.created}、合并看板 ${d.merged}、克隆 ${(d.cloned || []).length}、关系 ${d.links}`
      + (d.unmatched.length ? `；未匹配 ${d.unmatched.length} 条` : ''));
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  const expLayout = () => guard(async () => {
    const d = await api('/api/repos/export');
    setExpLayoutText(JSON.stringify(d, null, 2));
  });

  const readImpLayoutFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImpLayoutText(await f.text());
    setImpLayoutPlan(null);
  };

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

  // 参考仓库（type=ref）与开发仓库（type=dev）：两份名单分开，多对多绑定靠 linked 连接。
  // 必须先于 shown 声明（shown 的 useMemo 里用到）——生产构建里会压成单字母变量，
  // 用在声明前就是 "Cannot access 'Z' before initialization" 这类白屏错误。
  const devRepos = useMemo(() => repos.filter((r) => (r.type || 'dev') !== 'ref'), [repos]);
  const refRepos = useMemo(() => repos.filter((r) => r.type === 'ref'), [repos]);

  // 筛选后的开发仓库清单：选某个看板时只显示该看板的成员（去重）。
  // 参考仓库不在主表 —— 它们有大面板（筛选器行的「参考仓库」入口）。
  const shown = useMemo(() => {
    if (!filter) return devRepos;
    return devRepos.filter((r) => (r.boards || []).some((b) => b.id === filter));
  }, [devRepos, filter]);

  // 当前筛选到的看板（用来显示领域描述上下文条）与成员管理弹窗的目标看板
  const filterBoard = useMemo(() => boardList.find((b) => b.id === filter) || null, [boardList, filter]);
  const impBoard = useMemo(() => boardList.find((b) => b.id === impBoardId) || null, [boardList, impBoardId]);

  const checkOf = useMemo(() => {
    const m = new Map();
    (refCheck?.refs || []).forEach((x) => m.set(x.id, x));
    return m;
  }, [refCheck]);

  // 直接绑定到各开发仓库的参考（dev 行内「参考」列的数据面）。
  // 绑定是双向记录的：dev 侧自带 {kind:'ref'} 反向引用，直接读它即可；
  // 老数据（只有 ref 侧）再回退扫一遍 ref 全表。
  const refsOfRepo = useMemo(() => {
    const m = new Map();
    const add = (devId, r, note) => {
      if (!m.has(devId)) m.set(devId, []);
      m.get(devId).push({ id: r.id, name: r.name, remote: r.remote || '', note: note || '' });
    };
    const byId = new Map(refRepos.map((r) => [r.id, r]));
    const seen = new Set();
    for (const d of devRepos) {
      for (const l of d.linked || []) {
        if (l.kind !== 'ref') continue;
        const r = byId.get(l.id);
        if (!r) continue;
        seen.add(d.id + ':' + r.id);
        add(d.id, r, l.note);
      }
    }
    for (const r of refRepos) {
      for (const l of r.linked || []) {
        if (l.kind !== 'repo') continue;
        if (seen.has(l.id + ':' + r.id)) continue;
        add(l.id, r, l.note);
      }
    }
    return m;
  }, [devRepos, refRepos]);

  // 筛选到看板时：绑定在该看板（命名空间本体）或其成员开发仓库上的参考仓库
  const boardRefs = useMemo(() => {
    if (!filterBoard) return [];
    const memberIds = new Set((filterBoard.repos || []).map((r) => r.id));
    return refRepos
      .map((r) => {
        const boardLink = (r.linked || []).find((l) => l.kind === 'board' && l.id === filterBoard.id);
        const repoLinks = (r.linked || []).filter((l) => l.kind === 'repo' && memberIds.has(l.id));
        if (!boardLink && !repoLinks.length) return null;
        return {
          ...r,
          boardNote: boardLink?.note || '',
          viaRepos: repoLinks.map((l) => (filterBoard.repos || []).find((x) => x.id === l.id)?.name || l.id),
        };
      })
      .filter(Boolean);
  }, [refRepos, filterBoard]);

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
      type: form.type === 'ref' ? 'ref' : 'dev',
      remote: form.remote.trim() || undefined,
    };
    if (editing) await api(`/api/repos/${encodeURIComponent(editing)}`, { method: 'PATCH', body });
    else await api('/api/repos', { method: 'POST', body });
    resetForm();
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
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
        type: r.type || 'dev',
        remote: r.remote || '',
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
      await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
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
    // 绑定管理：从开发仓库行进入 —— 勾选哪些参考绑到它身上（多对多的 dev 侧视角）
    bind: (r) => {
      const sel = {};
      // 优先读 dev 侧的反向引用（绑定双向记录）；老数据回退扫 ref 侧
      for (const l of r.linked || []) {
        if (l.kind !== 'ref') continue;
        sel[l.id] = true;
      }
      for (const x of refRepos) {
        if (sel[x.id]) continue;
        if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === r.id)) sel[x.id] = true;
      }
      setBindRepoSel(sel);
      setBindRepoFor(r);
    },
    refNote: (ref, devRepo) => {
      const full = refRepos.find((x) => x.id === ref.id);
      if (full) openLinkNote(full, 'repo', devRepo.id, devRepo.name);
    },
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
            本机 git 仓库的双名单：<strong>开发仓库</strong>（本表）与<strong>参考仓库</strong>
            （远程 clone 下来学习的，右上「参考仓库」面板）。看板 = <strong>领域分组</strong>，
            领域描述 + 组内描述写给人和 agent 读；参考仓库与开发仓库/看板<strong>多对多绑定</strong>，
            绑定描述写在关系上（同一份参考在不同组里的意义可以不同）。
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

      {/* 看板筛选器：主表 = 开发仓库；参考仓库走右侧大面板入口 */}
      <div className="rp-filters" data-testid="rp-filters">
        <button
          className={'rp-chip' + (filter ? '' : ' on')}
          onClick={() => setFilter('')}
          title="显示全部开发仓库"
        >
          开发仓库 <b>{devRepos.length}</b>
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
        <button className={'rp-chip rp-chip-manage' + (refOpen ? ' on' : '')} onClick={() => setRefOpen(!refOpen)}
          title="参考仓库大面板：克隆 / 绑定 / 同步 / 检查 / 布局导入导出">
          参考仓库 <b>{refRepos.length}</b>{refOpen ? ' ▾' : ' ▸'}
        </button>
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

      {/* 看板（项目组）绑定的参考仓库 —— 命名空间展示区。
          绑到看板本体的是「组级参考」（note 是它的命名空间描述）；
          绑到成员开发仓库的是仓库级参考（随成员带进来）。 */}
      {filterBoard ? (
        <div className="rp-ref-mounted" data-testid="rp-board-refs">
          <div className="rp-ref-mounted-head">
            <span className="rp-ref-mounted-label">「{filterBoard.name}」的参考仓库 <b>{boardRefs.length}</b></span>
            <span className="muted">组级参考 + 成员仓库各自的参考（多对多：一个参考可同时服务多个组/仓库）</span>
          </div>
          {boardRefs.length ? boardRefs.map((r) => {
            const c = checkOf.get(r.id);
            const boardLink = (r.linked || []).find((l) => l.kind === 'board' && l.id === filterBoard.id);
            return (
              <div className="rp-ref-mounted-item" key={r.id}>
                <span className={'rp-ref-dot' + (c ? (c.ok ? ' ok' : ' bad') : '')}
                  title={c ? (c.ok ? '检查通过' : c.issues.join('\n')) : '尚未检查'} />
                <Copyable text={r.remote || r.name} title="点击复制远程地址" className="rp-ref-mounted-name">{r.name}</Copyable>
                {r.desc ? <span className="muted rp-ref-mounted-desc" title={r.desc}>{r.desc}</span> : null}
                {r.boardNote ? (
                  <button className="rp-ref-note-chip" title={`${r.boardNote}\n点击编辑这条命名空间描述`}
                    onClick={() => openLinkNote(r, 'board', filterBoard.id, filterBoard.name)}>
                    {r.boardNote.split('\n')[0]}
                  </button>
                ) : (
                  <button className="btn small ghost" title={`写「${r.name}」在这个组里参考什么（命名空间描述）`}
                    onClick={() => openLinkNote(r, 'board', filterBoard.id, filterBoard.name)}>写描述</button>
                )}
                {r.viaRepos.length ? <span className="muted" title={'经由成员仓库: ' + r.viaRepos.join('、')}>经由 {r.viaRepos.join('、')}</span> : null}
                <span className="acts">
                  <button className="btn small ghost" onClick={() => syncOne(r)}>同步</button>
                  <button className="btn small ghost" onClick={() => rowAct('open', r)}>打开</button>
                  {boardLink ? (
                    <button className="btn small ghost rp-del" title="只从本组摘除（不影响其它绑定）"
                      onClick={() => unbindOne(r, 'board', filterBoard.id)}>移出本组</button>
                  ) : null}
                </span>
              </div>
            );
          }) : (
            <div className="muted rp-refs-none">这个组还没有绑定的参考仓库 —— 在下方参考仓库面板里点「绑定」勾选本组，或在成员仓库行上绑定。</div>
          )}
        </div>
      ) : null}

      {/* 参考仓库大面板：自己的表格（不与开发仓库混排）。
          每行：状态徽标 / 名称+描述 / 远程地址 / 绑定 chips（组级 + 仓库级，可点改描述、× 摘除）/ 操作。
          绑定一律选项式（「绑定」弹窗里勾选），不手填字符串。 */}
      {refOpen ? (
        <div className="card rp-ref-panel">
          <div className="colhead">
            <h3>参考仓库</h3>
            <span className="muted">
              远程 clone 下来学习/参考的仓库（type=ref），统一存放在 gitRepoRoot。
              与开发仓库<strong>多对多绑定</strong>：一个参考服务多个仓库/组，一个仓库/组挂多个参考；
              绑定描述写在关系上（同一条绑定在不同组里意义不同）。
            </span>
            <span className="acts" style={{ marginLeft: 'auto' }}>
              <button className="btn small" onClick={() => { setCloneTargets({}); setCloneOpen(true); }}>克隆参考仓库</button>
              <button className="btn small ghost" onClick={syncAll}>同步全部</button>
              <button className="btn small ghost" onClick={loadRefCheck}>检查</button>
              <button className="btn small ghost" onClick={() => { setImpLayoutOpen(true); setImpLayoutPlan(null); }}>导入布局</button>
              <button className="btn small ghost" onClick={expLayout}>导出布局</button>
              <button className="btn small ghost" onClick={() => {
                setRootsForm({ gitRepoRoot: settingInfo?.gitRepoRoot || '', gitDevRoot: settingInfo?.gitDevRoot || '' });
                setRootsOpen(true);
              }}>存储根</button>
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
                  <th scope="col" style={{ width: '18%' }}>参考仓库</th>
                  <th scope="col" style={{ width: '26%' }}>远程地址</th>
                  <th scope="col">绑定（组 / 仓库 · 点击写描述 · × 摘除）</th>
                  <th scope="col" style={{ width: '15%' }}>操作</th>
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
                        {r.desc ? <div className="muted rp-desc" title={r.desc}>{r.desc}</div> : null}
                      </td>
                      <td className="mono rp-ref-cell-remote">
                        <Copyable text={r.remote || ''} title="点击复制远程地址">{r.remote || '（无）'}</Copyable>
                      </td>
                      <td className="rp-ref-cell-links">
                        {links.length ? links.map((l) => {
                          const label = l.kind === 'board'
                            ? (boardList.find((b) => b.id === l.id)?.name || l.id)
                            : (devRepos.find((d) => d.id === l.id)?.name || l.id);
                          return (
                            <span className="rp-link-chip" key={l.kind + ':' + l.id}>
                              <button className="rp-link-chip-main" title={l.note ? `${l.note}\n点击编辑这条绑定描述` : `点击写「${r.name}」绑定到这里的描述`}
                                onClick={() => openLinkNote(r, l.kind, l.id, label)}>
                                <b>{l.kind === 'board' ? '组' : '仓'}</b> {label}
                                {l.note ? <i className="rp-link-chip-note" title={l.note}>{l.note.split('\n')[0]}</i> : null}
                              </button>
                              <button className="rp-link-chip-x" title={`摘除这条绑定（不影响其它）`}
                                onClick={() => unbindOne(r, l.kind, l.id)}>×</button>
                            </span>
                          );
                        }) : <span className="muted rp-refs-none">未绑定</span>}
                        <button className="btn small ghost rp-ref-bind" onClick={() => openBind(r)}>绑定…</button>
                      </td>
                      <td className="rp-acts">
                        <button className="btn small ghost" onClick={() => syncOne(r)}>同步</button>
                        <button className="btn small ghost" onClick={() => rowAct('open', r)}>打开</button>
                        <button className="btn small ghost" onClick={() => rowAct('edit', r)}>编辑</button>
                        <button className="btn small ghost rp-del" onClick={() => rowAct('del', r)}>删除</button>
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

      {/* 开发仓库主表：一行一个开发仓库；「参考」列 = 绑到它身上的参考仓库（多对多） */}
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '26%' }}>仓库</th>
              <th scope="col" style={{ width: '30%' }}>路径</th>
              <th scope="col">绑定的参考仓库</th>
              <th scope="col" style={{ width: '18%' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <RepoRow key={r.id} r={r} filterBoard={filterBoard} refsOfRepo={refsOfRepo} acts={rowActs} />
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan="4" className="muted rp-empty">
                  {devRepos.length
                    ? '这个看板还没有成员 —— 点上方「导入仓库」，从开发仓库里点选加入。'
                    : '还没有登记开发仓库 —— 点「扫描」自动发现，或「添加仓库」手工登记。参考仓库在「参考仓库」面板管理。'}
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
              <label htmlFor="repo-type">类型</label>
              <select id="repo-type" value={form.type} onChange={set('type')}>
                <option value="dev">开发仓库（本机开发的）</option>
                <option value="ref">参考仓库（远程 clone 下来的）</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="repo-remote">远程 git 地址</label>
              <input id="repo-remote" spellCheck="false" placeholder="https://github.com/me/x.git（导出时导它，不含本地路径）"
                value={form.remote} onChange={set('remote')} />
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
              <button className="btn ghost" onClick={() => { setCloneOpen(false); setCloneTargets({}); }}>取消</button>
              <button className="btn" disabled={!cloneForm.url.trim() || !settingInfo?.gitRepoRoot}
                title={settingInfo?.gitRepoRoot ? `克隆到 ${settingInfo.gitRepoRoot}` : '先在「存储根」设置 gitRepoRoot'}
                onClick={doClone}>克隆</button>
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
              <button className="btn ghost" onClick={() => setBindFor(null)}>取消</button>
              <button className="btn" onClick={saveBind}>保存绑定</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* dev 侧绑定弹窗：这个开发仓库挂哪些参考 */}
      {bindRepoFor ? (
        <Modal title={`「${bindRepoFor.name}」的参考仓库`} onClose={() => setBindRepoFor(null)}>
          <div className="form-grid">
            <div className="form-field">
              <div className="form-hint">
                勾选 = 绑到「{bindRepoFor.name}」，取消 = 摘除。组级参考（绑在看板上）自动对该组所有成员生效，不在这里重复勾。
              </div>
              <div className="rp-pick-list">
                <div className="rp-pick-group">
                  <span className="rp-pick-group-label">参考仓库</span>
                  {refRepos.map((r) => (
                    <label className="rp-pick-item" key={r.id}>
                      <input type="checkbox" checked={!!bindRepoSel[r.id]}
                        onChange={(e) => setBindRepoSel((m) => ({ ...m, [r.id]: e.target.checked }))} />
                      <span title={r.remote || ''}>{r.name}</span>
                      {r.desc ? <span className="muted rp-pick-desc">{r.desc}</span> : null}
                    </label>
                  ))}
                  {!refRepos.length ? <span className="muted">（还没有参考仓库 —— 先在参考面板里克隆）</span> : null}
                </div>
              </div>
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setBindRepoFor(null)}>取消</button>
              <button className="btn" onClick={saveBindRepo}>保存绑定</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 绑定描述弹窗：这条绑定关系上「参考什么」（挂在关系上，摘绑即清） */}
      {linkNoteFor ? (
        <Modal
          title={`绑定描述 · ${linkNoteFor.ref.name} @ ${linkNoteFor.kind === 'board' ? '「' + linkNoteFor.targetName + '」' : linkNoteFor.targetName}`}
          onClose={() => setLinkNoteFor(null)}
        >
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="link-note">
                「{linkNoteFor.ref.name}」{linkNoteFor.kind === 'board' ? '在这个组里' : '在这个仓库里'}参考什么
              </label>
              <div className="form-hint">
                写这条参考在此处的角色与用法（可多行、可含关键路径/搜索词）。留空保存 = 清除。
              </div>
              <textarea id="link-note" rows={5} spellCheck="false"
                placeholder={'如：project-graph 画布交互的实现参考；\n看 src/extensions/ 的注册方式，搜 registerExtension。'}
                value={linkNoteText} onChange={(e) => setLinkNoteText(e.target.value)} />
            </div>
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setLinkNoteFor(null)}>取消</button>
              <button className="btn" onClick={saveLinkNote}>保存</button>
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
              <button className="btn ghost" onClick={() => setRootsOpen(false)}>取消</button>
              <button className="btn" onClick={saveRoots}>保存</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 布局导入弹窗：先 plan 预览（分组/关系/每行克隆选择），确认后执行 */}
      {impLayoutOpen ? (
        <Modal title="导入仓库布局" onClose={() => { setImpLayoutOpen(false); setImpLayoutPlan(null); setImpLayoutText(''); }}>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="layout-imp">布局 JSON（repo export 的输出）</label>
              <div className="form-hint">
                含仓库（远程地址）、看板分组、参考关系。先「预览计划」确认整个布局，再选择性克隆执行。
              </div>
              <input id="layout-imp-file" type="file" accept=".json,application/json" onChange={readImpLayoutFile} />
              <textarea id="layout-imp" rows={8} spellCheck="false"
                placeholder='{"version":2,"repos":[{"remote":"…","name":"x","type":"dev"}],"boards":[…],"links":[…]}'
                value={impLayoutText} onChange={(e) => { setImpLayoutText(e.target.value); setImpLayoutPlan(null); }} />
            </div>
            <div className="form-field">
              <label htmlFor="layout-clone">克隆模式</label>
              <select id="layout-clone" value={impLayoutClone} onChange={(e) => { setImpLayoutClone(e.target.value); setImpLayoutPlan(null); }}>
                <option value="none">只登记，不克隆</option>
                <option value="ref">克隆参考仓库</option>
                <option value="dev">克隆开发仓库</option>
                <option value="all">全部克隆</option>
              </select>
            </div>
            {impLayoutPlan ? (
              <div className="form-field rp-layout-plan">
                <label>导入计划预览（未执行）</label>
                <div className="rp-layout-repos">
                  {impLayoutPlan.repos.map((r) => (
                    <label className="rp-layout-row" key={r.rkey || r.name}>
                      <input
                        type="checkbox"
                        disabled={!r.cloneWanted}
                        checked={!!r.cloneWanted && (r.rkey ? impLayoutOnly[r.rkey] !== false : false)}
                        onChange={(e) => r.rkey && setImpLayoutOnly((m) => ({ ...m, [r.rkey]: e.target.checked }))}
                      />
                      <span className="rp-layout-name">
                        {r.name || r.remote}{r.type === 'ref' ? ' [参考]' : ''}
                      </span>
                      <span className="muted rp-layout-state">
                        {r.action}{r.cloneWanted ? ' → 克隆' : r.blocked ? `（${r.blocked}）` : ''}
                      </span>
                    </label>
                  ))}
                  {impLayoutPlan.boards.map((b) => (
                    <div className="rp-layout-board" key={b.name}>
                      看板{b.action}：{b.name}（{b.members.length} 个成员）
                    </div>
                  ))}
                  {impLayoutPlan.links.map((l) => (
                    <div className="rp-layout-link" key={l.rkey}>
                      参考 {l.ref} → {l.to.map((t) => t.repo || `看板「${t.board}」`).join('、')}
                    </div>
                  ))}
                  {(impLayoutPlan.warnings || []).map((w) => (
                    <div className="rp-layout-warn" key={w}>⚠ {w}</div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="form-acts">
              <button className="btn ghost" onClick={() => { setImpLayoutOpen(false); setImpLayoutPlan(null); setImpLayoutText(''); }}>取消</button>
              <button className="btn ghost" disabled={!impLayoutText.trim()} onClick={planLayout}>预览计划</button>
              <button className="btn" disabled={!impLayoutPlan} onClick={runLayout}>执行导入</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 布局导出结果 */}
      {expLayoutText ? (
        <Modal title="仓库布局 JSON（远程地址 + 分组 + 参考关系；不含本地路径）" onClose={() => setExpLayoutText(null)}>
          <textarea className="bd-exp" rows={16} readOnly value={expLayoutText} spellCheck="false" />
        </Modal>
      ) : null}

      {dialogNode}
    </>
  );
}
