// 仓库管理页（平台化）：统一展示 **repo / 分组（看板）/ ref 文档** 三者的关联。
//
// **来历**：原本长在 nx-rh，2026-10-23 整体迁到 nx-kv（远程清单 topic=goal 的 #72）——
// 仓库登记是本机事实，它的价值是给「本地任务管理」当上下文，所以它跟着任务走。
// 每个按钮 = 一条 HTTP 路由 = 一条 CLI 命令（三者同源于模块的 action 声明）。
//
// 版面（自上而下 = 任务流）：
//   1. 头部：统计 chips（开发仓库/参考仓库/分组/文档）+ 主操作
//      （登记仓库 / 新建分组 / 扫描目录 / 参考仓库管理 / 导入导出）；
//   - 分组区块：看板升为一等公民的卡片网格（组介绍文档入口、成员 chips、操作）；
//   - 仓库主表：扁平中心清单，行内核心是**绑定的 ref 文档列表**
//     （主篇 + 补充篇，逐篇可点开、可摘除），另有参考仓库与所属分组 chips；
//   - 文档区块：全部自有文档 + 绑定关系反推（文档不记宿主，宿主关系在仓库/分组上）。
//
// 看板只存引用 → **加入分组是复制**，不是移动：同一个仓库可以同时在多个
// 分组里；取消某份副本只摘那个分组的引用，仓库本体纹丝不动。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { Copyable } from '../../components/ui.jsx';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog, Modal } from '../../components/popup/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import TransferPanel from '../../components/repos/transfer-panel.jsx';
import DocsModal from '../../components/Introduction/docs-modal.jsx';
import { useApp } from '../../app-context.jsx';
import { useWikiNav } from '../doc/index.jsx';

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

// 文档列入口（查看详情）：一行主篇摘要 + 数量，点击打开 DocsModal——
// 完整文档列表（主篇 / 补充 / reference / 组内）+ 复用编辑器就地编辑。
// 文档不再以 chip/tag 形式外显在行内（任务「简介文档优化」）；未写的主篇
// 显示「＋ 写项目介绍」虚态，点开同样进弹窗创建。
function DocsEntry({ docs, onOpen }) {
  const main = docs && docs.main;
  const links = (docs && docs.links) || [];
  const total = (main ? 1 : 0) + links.length;
  return (
    <button
      type="button"
      className="rp-docs-entry"
      title="查看完整文档列表（主篇 / 补充 / reference / 组内），可就地编辑"
      onClick={onOpen}
    >
      <span className={'rp-docs-entry-main' + (main && main.exists ? '' : ' ghost')}>
        {main && main.exists ? (main.summary || main.title) : '＋ 写项目介绍'}
      </span>
      <span className="rp-docs-entry-n">{total > 0 ? `${total} 篇 · 查看详情` : '查看详情'}</span>
    </button>
  );
}

// 仓库行 = 仓库信息（名称 + 路径）+ 文档入口（核心）+ 参考仓库 + 所属分组 + 操作。
// **文档列是这行的核心内容**：一个「查看详情」入口开 DocsModal——完整文档集
// （主篇 + 补充 + reference + 组内描述）就地看、就地编辑；行内不再铺 chip 外显。
// 所属分组 chips 点一下 = 筛到那个组（再点取消）；归属的增删走「成员管理」弹窗。
// 主表只放开发仓库（type=dev）——参考仓库有自己的大面板，两份名单不混。
// 「参考」列显示**绑定到这个开发仓库**的参考仓库（多对多：一个 dev 可挂多个 ref）。
function RepoRow({ r, filterBoard, refsOfRepo, acts }) {
  const refs = refsOfRepo.get(r.key) || [];
  return (
    <tr id={'rp-row-' + r.key}>
      <td className="rp-name">
        <strong>
          {r.icon ? <span className="rp-icon" aria-hidden>{r.icon}</span> : null}
          {r.name}
        </strong>
        <span className="mono rp-name-path"><RepoPath path={r.path} /></span>
      </td>
      {/* 文档列 = 这个仓库全部文档的入口：查看详情 → DocsModal（含组内描述） */}
      <td className="rp-cell-docs">
        <DocsEntry docs={r.descDocs} onOpen={() => acts.docs(r)} />
      </td>
      <td className="rp-refs">
        {refs.length ? refs.map((ref) => (
          <button key={ref.key} className="rp-ref-chip" title={`直接绑定：${ref.remote || ''}${ref.note ? '\n' + ref.note : ''}\n点击改绑定描述`}
            onClick={() => acts.refNote(ref, r)}>
            {ref.note ? <span className="rp-ref-chip-dot" /> : null}
            {ref.name}
          </button>
        )) : <span className="muted rp-refs-none">—</span>}
        <button className="btn small ghost rp-ref-bind" title="管理这个仓库绑定的参考仓库" onClick={() => acts.bind(r)}>绑定</button>
      </td>
      <td className="rp-cell-groups">
        {(r.boards || []).length ? r.boards.map((b) => (
          <button
            key={b.id}
            className={'rp-group-chip' + (filterBoard && filterBoard.id === b.id ? ' on' : '')}
            title={`只看「${b.name}」${b.note ? `\n组内描述：${b.note}` : ''}`}
            onClick={() => acts.filter(b.id)}
          >
            {b.name}
          </button>
        )) : <span className="muted rp-refs-none">—</span>}
      </td>
      <td className="rp-acts">
        <button className="btn small ghost" title="在文件管理器中打开" onClick={() => acts.open(r)}>打开</button>
        <button className="btn small ghost" title="对齐 remote：列出 git remote -v 的候选并检查远端是否存在"
          onClick={() => acts.remote(r)}>remote</button>
        <button className="btn small ghost" onClick={() => acts.edit(r)}>编辑</button>
        <button className="btn small ghost rp-del" onClick={() => acts.del(r)}>删除</button>
      </td>
    </tr>
  );
}

export default function ReposView() {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp() || {};
  // 描述是文档 → 行内点标题要能开文档页签（useWikiNav 内部拿 app.model + 文档索引）
  const { openByDocId } = useWikiNav();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  // 成员管理弹窗：打开时 = 正在往这个看板里点选导入 / 摘除仓库
  const [impBoardId, setImpBoardId] = useState(null);

  // 看板（只作筛选与标签）
  const [boards, setBoards] = useState(null); // { boards: [...], unassigned: [...] }
  const [filter, setFilter] = useState(''); // '' = 全部（中心清单）
  // 检索框：一个输入同时搜仓库名/路径、分组名、文档标题/rel —— 管理页不该靠长列表找人
  const [q, setQ] = useState('');
  // 分组管理是「隔一阵维护一次」的东西：弹窗列表，不占主版面
  const [boardAdminOpen, setBoardAdminOpen] = useState(false);
  // 文档检索：按 仓库 / 组内 / 分组 三档筛，不铺全量长列表
  const [docOpen, setDocOpen] = useState(false);
  const [boardForm, setBoardForm] = useState(null); // null | { id?, name, desc }
  const [impOpen, setImpOpen] = useState(false);
  const [impText, setImpText] = useState('');
  const [expText, setExpText] = useState(null);

  // 仓库中心清单（扁平；每条带 boards）
  const [repos, setRepos] = useState([]);
  // 全部自有文档（文档区块的数据面：GET /api/docs）
  const [docs, setDocs] = useState([]);
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
  // 布局导入导出：全屏面板（自己的 Tab 内维护全部临时状态）
  const [transferOpen, setTransferOpen] = useState(false);
  // 「对齐 remote」：key 是本地身份，remote 是协作的标准单位——两者要对齐，
  // 但对齐方向由人定（自动的 SSH 优先只是默认值）。数据面来自 git remote -v。
  const [remoteInfo, setRemoteInfo] = useState(null); // { key, name, current, remotes:[…] }
  const [remoteCheck, setRemoteCheck] = useState(null); // { url, status, detail }
  const [remoteOpen, setRemoteOpen] = useState(false); // 对齐 remote 的弹窗
  // 查看详情（文档集弹窗）：{ kind:'repo', owner } —— 行内「查看详情」入口
  const [docsFor, setDocsFor] = useState(null);

  const resetForm = () => { setForm(EMPTY_FORM); setEditing(null); setFormOpen(false); };

  const loadRepos = useCallback(async () => {
    setRepos((await api('/api/repos').catch(() => [])) || []);
  }, []);
  const loadBoards = useCallback(async () => {
    setBoards(await api('/api/boards').catch(() => null));
  }, []);
  const loadDocs = useCallback(async () => {
    const d = await api('/api/docs').catch(() => null);
    setDocs((d && d.docs) || []);
  }, []);
  useEffect(() => { loadRepos(); loadBoards(); loadDocs(); }, [loadRepos, loadBoards, loadDocs]);

  // 从别处跳进来的定位：#/repos?board=<组id>&add=1
  // （组详情页的「添加成员」走这条：不在组页内嵌弹窗，直接落到仓库页对应分组的成员管理）
  useEffect(() => {
    const applyHash = () => {
      const q = location.hash.split('?')[1] || '';
      if (!q) return;
      const params = new URLSearchParams(q);
      const bid = params.get('board');
      if (!bid) return;
      setFilter(bid);
      if (params.get('add')) setImpBoardId(bid);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

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
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, [kind]: [id] } });
    }
    for (const k of oldKeys) {
      if (newKeys.has(k)) continue;
      const [kind, id] = k.split(':');
      await api('/api/repos/bind', { method: 'POST', body: { id: bindFor.key, [kind]: [id], remove: true } });
    }
    setBindFor(null);
    await Promise.all([loadRepos(), loadRefCheck()]);
  });

  // dev 侧绑定保存：对比该仓库当前挂的参考，加/摘各一批
  const saveBindRepo = () => guard(async () => {
    if (!bindRepoFor) return;
    // 当前绑定：dev 侧反向引用优先，老数据回退扫 ref 侧（全部按 key）
    const current = new Set();
    for (const l of bindRepoFor.linked || []) {
      if (l.kind === 'ref') current.add(l.id);
    }
    for (const x of refRepos) {
      if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === bindRepoFor.key)) current.add(x.key);
    }
    const want = new Set(Object.keys(bindRepoSel).filter((k) => bindRepoSel[k]));
    for (const rid of want) {
      if (current.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [bindRepoFor.key] } });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      await api('/api/repos/bind', { method: 'POST', body: { id: rid, repo: [bindRepoFor.key], remove: true } });
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
      body: { id: ref.key, [kind]: targetId, note: linkNoteText },
    });
    setLinkNoteFor(null);
    await Promise.all([loadRepos(), loadRefCheck()]);
    toast('已保存绑定描述');
  });

  // 从某条绑定弹窗摘除单个目标（chip 上的 ×）
  const unbindOne = (ref, kind, targetId) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, [kind]: [targetId], remove: true } });
    await Promise.all([loadRepos(), loadRefCheck()]);
  });

  // 布局导入导出：整块交给全屏面板（transfer-panel.jsx）。
  // 面板自己调 /api/repos/export 与 /api/repos/import*，执行完通过 onChanged 让本页刷新。
  const onTransferDone = useCallback(async () => {
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  }, [loadRepos, loadBoards, loadRefCheck]);

  // ---- 对齐 remote ----
  // key 是本地身份，remote 是协作的标准单位——两者要对齐，但方向由人定
  // （自动的 SSH 优先只是默认值）。这里给出「列候选 / 人工换一条 / 查存在性」。
  const openRemote = async (r) => {
    const key = r && r.key ? r.key : '';
    if (!key) {
      toast('这个仓库还没有 key —— 先 nx-kv repo key set <id> <key>');
      return;
    }
    try {
      const d = await api('/api/repos/remote/list?id=' + encodeURIComponent(key));
      if (!d || !Array.isArray(d.remotes)) throw new Error('远程地址读取失败');
      setRemoteInfo(d);
      setRemoteCheck(null);
      setRemoteOpen(true);
    } catch (e) {
      toast(String((e && e.message) || e));
    }
  };
  const pickRemote = (url) => guard(async () => {
    await api('/api/repos/remote/pick', {
      method: 'POST',
      body: { id: remoteInfo.key, url },
    });
    setRemoteOpen(false);
    toast('已对齐 remote');
    await Promise.all([loadRepos(), loadRefCheck()]);
  });
  // 存在性检查：git ls-remote 要几秒，期间不给任何反馈会像「点了没反应」。
  // 错误直接写进弹窗（remoteCheck.detail），不靠 toast —— toast 会一闪而过。
  const checkRemote = async (url) => {
    const key = remoteInfo ? remoteInfo.key : '';
    if (!key) {
      setRemoteCheck({ url: '', status: 'unreachable', detail: '没有仓库标识' });
      return;
    }
    setRemoteCheck({ url: url || remoteInfo.current || '', status: 'checking', detail: '检查中…' });
    try {
      const d = await api('/api/repos/remote/check?id=' + encodeURIComponent(key)
        + (url ? '&url=' + encodeURIComponent(url) : ''));
      setRemoteCheck(d);
    } catch (e) {
      setRemoteCheck({
        url: url || remoteInfo.current || '',
        status: 'unreachable',
        detail: String((e && e.message) || e),
      });
    }
  };


  // 看板清单（用来做「+ 看板」下拉与筛选器）
  const boardList = useMemo(() => (boards && boards.boards) || [], [boards]);

  // 参考仓库（type=ref）与开发仓库（type=dev）：两份名单分开，多对多绑定靠 linked 连接。
  // 必须先于 shown 声明（shown 的 useMemo 里用到）——生产构建里会压成单字母变量，
  // 用在声明前就是 "Cannot access 'Z' before initialization" 这类白屏错误。
  const devRepos = useMemo(() => repos.filter((r) => (r.type || 'dev') !== 'ref'), [repos]);
  const refRepos = useMemo(() => repos.filter((r) => r.type === 'ref'), [repos]);

  // 筛选后的开发仓库清单：选某个看板时只显示该看板的成员（去重）；
  // 检索词命中仓库名/路径/分组名/文档标题（含 rel）时也收窄到命中的行。
  // 参考仓库不在主表 —— 它们有大面板（筛选器行的「参考仓库」入口）。
  const shown = useMemo(() => {
    let list = devRepos;
    if (filter) list = list.filter((r) => (r.boards || []).some((b) => b.id === filter));
    const kw = q.trim().toLowerCase();
    if (!kw) return list;
    // 文档命中：主篇 / 补充篇的标题、rel、tag、note 任一含关键词
    const docHit = (r) => {
      const main = r.descDocs && r.descDocs.main;
      if (main && [main.title, main.summary, main.rel].some((s) => s && String(s).toLowerCase().includes(kw))) return true;
      return ((r.descDocs && r.descDocs.links) || []).some((l) =>
        [l.title, l.tag, l.note, l.rel].some((s) => s && String(s).toLowerCase().includes(kw)));
    };
    return list.filter((r) =>
      [r.name, r.key, r.path, r.desc].some((s) => s && String(s).toLowerCase().includes(kw))
      || (r.boards || []).some((b) => String(b.name || '').toLowerCase().includes(kw))
      || docHit(r));
  }, [devRepos, filter, q]);

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
    // 索引按 **key**（关系的身份）：dev 仓库的 key → 挂在它身上的参考仓库列表
    const add = (devKey, r, note) => {
      if (!m.has(devKey)) m.set(devKey, []);
      m.get(devKey).push({ key: r.key, id: r.id, name: r.name, remote: r.remote || '', note: note || '' });
    };
    const byKey = new Map(refRepos.map((r) => [r.key, r]));
    const seen = new Set();
    for (const d of devRepos) {
      for (const l of d.linked || []) {
        if (l.kind !== 'ref') continue;
        const r = byKey.get(l.id);
        if (!r) continue;
        seen.add(d.key + ':' + r.key);
        add(d.key, r, l.note);
      }
    }
    for (const r of refRepos) {
      for (const l of r.linked || []) {
        if (l.kind !== 'repo') continue;
        if (seen.has(l.id + ':' + r.key)) continue;
        add(l.id, r, l.note);
      }
    }
    return m;
  }, [devRepos, refRepos]);

  // 筛选到看板时：绑定在该看板（命名空间本体）或其成员开发仓库上的参考仓库
  // 关系引用一律按 key（看板 key = board/<名称>，仓库 key = 归一化远程地址）
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

  // 文档 → 绑定宿主 反推表（文档区块用）：一篇文档被哪些仓库/分组引用。
  // 文档自己不记宿主，宿主关系散落在仓库与分组的绑定字段上：
  //   repo.descDocs.main.rel（主篇）/ repo.descDocs.links[].docId（补充篇，'rel:' 前缀）
  //   repo.boards[].noteDocRel（组内描述，仓库侧冗余）
  //   board.docRel（组介绍）/ board.docLinks[].rel（组补充）/ board.repos[].noteDocRel（组内描述）
  // kind 用来筛「仓库 / 分组 / 组内」三档；target 是点击跳转的落点（仓库 key 或分组 id）。
  const docHosts = useMemo(() => {
    const m = new Map(); // rel → [{ key, kind, label, tip, target }]
    const add = (rel, kind, label, tip, target) => {
      if (!rel) return;
      if (!m.has(rel)) m.set(rel, []);
      const arr = m.get(rel);
      if (arr.some((x) => x.label === label)) return;
      arr.push({ key: rel + '|' + label, kind, label, tip: tip || label, target });
    };
    for (const r of repos) {
      const main = r.descDocs && r.descDocs.main;
      if (main && main.rel) add(main.rel, 'repo', `仓：${r.name}`, `「${r.name}」的项目介绍主篇`, r.key);
      for (const l of (r.descDocs && r.descDocs.links) || []) {
        const rel = String(l.docId || '').startsWith('rel:') ? String(l.docId).slice(4) : '';
        add(rel, 'repo', `仓：${r.name}`, `「${r.name}」的补充文档${l.tag ? `（${l.tag}）` : ''}`, r.key);
      }
      for (const b of r.boards || []) {
        add(b.noteDocRel, 'scoped', `组内：${b.name} / ${r.name}`, `「${r.name}」在组「${b.name}」里的组内描述`, b.id);
      }
    }
    for (const b of boardList) {
      if (b.docRel) add(b.docRel, 'board', `组：${b.name}`, `组「${b.name}」的介绍文档`, b.id);
      for (const l of b.docLinks || []) add(l.rel, 'board', `组：${b.name}`, `组「${b.name}」的补充文档`, b.id);
      for (const mb of b.repos || []) {
        add(mb.noteDocRel, 'scoped', `组内：${b.name} / ${mb.name || mb.key}`, `组「${b.name}」里的组内描述`, b.id);
      }
    }
    return m;
  }, [repos, boardList]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setFormOpen(true);
  };

  // 文档检索的分档：仓库文档 / 分组文档 / 组内文档 / 未绑定。
  // 这三档正是「repo、repo+group、group」三层 key —— 分开看才看得清关联。
  const [docScope, setDocScope] = useState('all');
  const [docKw, setDocKw] = useState('');
  const docRows = useMemo(() => {
    const kw = docKw.trim().toLowerCase();
    const rows = docs.map((d) => ({ d, hosts: docHosts.get(d.rel) || [] }));
    const hit = (x) => {
      if (!kw) return true;
      return [x.d.title, x.d.name, x.d.rel]
        .some((s) => s && String(s).toLowerCase().includes(kw))
        || x.hosts.some((h) => h.label.toLowerCase().includes(kw));
    };
    const list = rows.filter(hit);
    if (docScope === 'orphan') return list.filter((x) => !x.hosts.length);
    if (docScope === 'all') return list;
    return list.filter((x) => x.hosts.some((h) => h.kind === docScope));
  }, [docs, docHosts, docScope, docKw]);
  const docScopeCounts = useMemo(() => {
    const c = { all: docs.length, repo: 0, board: 0, scoped: 0, orphan: 0 };
    for (const d of docs) {
      const hosts = docHosts.get(d.rel) || [];
      if (!hosts.length) c.orphan += 1;
      for (const k of ['repo', 'board', 'scoped']) {
        if (hosts.some((h) => h.kind === k)) c[k] += 1;
      }
    }
    return c;
  }, [docs, docHosts]);

  // 区块跳转：统计 chip / 文档绑定 chip 用（滚动到目标区块，不改变页面状态）。
  // 不用 scrollIntoView —— 面板内容挂在 FlexLayout 的 tab 里（.flexlayout__tab_moveable
  // 才是真正的滚动容器），这条链上的 scrollIntoView 实测无效，必须手动算 scrollTop。
  const scrollToEl = (el, block = 'start') => {
    if (!el) return;
    let box = el.parentElement;
    while (box) {
      const st = getComputedStyle(box);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    if (!box) box = document.scrollingElement || document.documentElement;
    const base = box.getBoundingClientRect ? box.getBoundingClientRect().top : 0;
    const offset = el.getBoundingClientRect().top - base;
    const pad = block === 'center' ? (box.clientHeight - el.offsetHeight) / 2 : 12;
    box.scrollTop = Math.max(0, box.scrollTop + offset - pad);
  };
  const jumpTo = (id) => scrollToEl(document.getElementById(id));

  // 绑定 chip 点击 = 跳到宿主：分组 → 筛到该组；仓库/组内 → 滚到那行并闪一下
  const docGo = (h) => {
    if (!h || !h.target) return;
    if (h.kind === 'board') {
      setFilter(h.target);
      jumpTo('rp-repos');
      return;
    }
    setFilter('');
    const row = document.getElementById('rp-row-' + h.target);
    if (!row) { jumpTo('rp-repos'); return; }
    scrollToEl(row, 'center');
    row.classList.add('rp-row-flash');
    setTimeout(() => row.classList.remove('rp-row-flash'), 1400);
  };

  // 编辑弹窗里的「项目描述」= 这个仓库绑定的文档集（主篇 + 补充篇），不给字符串输入框
  const editingDocs = useMemo(() => {
    if (!editing) return null;
    const r = repos.find((x) => x.id === editing);
    return (r && r.descDocs) || null;
  }, [editing, repos]);

  const submit = () => guard(async () => {
    if (!form.path.trim()) return;
    const body = {
      path: form.path.trim(),
      name: form.name.trim() || undefined,
      notes: form.notes,
      type: form.type === 'ref' ? 'ref' : 'dev',
      remote: form.remote.trim() || undefined,
    };
    if (editing) await api(`/api/repos/${encodeURIComponent(editing)}`, { method: 'PATCH', body });
    else await api('/api/repos', { method: 'POST', body });
    resetForm();
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
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
  // 行内的加/摘入口收在「成员管理」弹窗（MemberPicker：项目 + 项目组，可搜索）。

  // ---- 看板管理 ----
  const saveBoard = () => guard(async () => {
    const body = { name: boardForm.name.trim() };
    if (!body.name) return;
    // 描述是文档：编辑时不再提交 desc（领域描述在组介绍文档里写）；
    // 新建时给的那段仍是「初始正文」，后端落成 board/<组>.md
    if (!boardForm.id) body.desc = boardForm.desc.trim() || undefined;
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

  // 待初始化：组里引用了、本机却还没有登记的仓库（导入布局带进来的占位）。
  // 按 **key** 认领（key 是仓库与仓库组链接的唯一方式）：
  //   克隆到本地（占位带 remote 时）/ 用本机已有仓库接管（把它的 key 改成占位 key）。
  const pendingInit = useMemo(() => {
    // 自动匹配候选：占位往往只剩一个 key（末段就是它唯一的名字），
    // 本机同名仓库 / 同名目录都可以是它的真身——先给一个「一键绑定」，
    // 不要让人手工去翻 key。
    const byName = new Map();
    for (const r of [...devRepos, ...refRepos]) {
      const base = String(r.path || '').split(/[\\/]/).filter(Boolean).pop() || '';
      for (const n of [r.name, base]) {
        const k = String(n || '').toLowerCase();
        if (k && !byName.has(k)) byName.set(k, r);
      }
    }
    const out = [];
    for (const b of (boards && boards.boards) || []) {
      for (const m of b.repos || []) {
        if (m.present !== false) continue;
        const tail = String(m.key || '').split('/').filter(Boolean).pop() || '';
        const match =
          byName.get(String(m.name || '').toLowerCase()) ||
          byName.get(tail.toLowerCase()) ||
          null;
        out.push({ ...m, board: b.name, boardId: b.id, match });
      }
    }
    return out;
  }, [boards, devRepos, refRepos]);

  if (boards === null) {
    return (
      <div className="rp-page">
      <RouteBreadcrumb />
        <div className="muted" style={{ padding: 20 }}>读取中…</div>
        {dialogNode}
      </div>
    );
  }

  const clonePending = (m) =>
    guard(async () => {
      await api('/api/repos/clone', {
        method: 'POST',
        body: { remote: m.remote, key: m.key, name: m.name || undefined, type: 'dev' },
      });
      toast(`已克隆并登记：${m.name || m.key}`);
      loadRepos();
      loadBoards();
    });

  // 重绑 = 改**关系**：把组里那个假 key 换成本机仓库的真 key。
  // 以前的「接管」改的是本机仓库的 key（PATCH /api/repos/:id {key}）——
  // 那样会把真实身份降级成 local/xxx，再导出就把假 key 传播出去。
  const bindPending = (m, target) =>
    guard(async () => {
      await api('/api/boards/rekey', { method: 'POST', body: { from: m.key, to: target } });
      toast(`已把「${m.name || m.key}」这个位置接到本机仓库`);
      loadRepos();
      loadBoards();
    });

  const bindPendingPick = (m) =>
    guard(async () => {
      const which = await dialog({
        title: `把「${m.name || m.key}」接到哪个本机仓库？`,
        input: true,
        placeholder: '本机仓库：id / key / 名称 / 绝对路径',
      });
      if (!which) return;
      await api('/api/boards/rekey', { method: 'POST', body: { from: m.key, to: which } });
      toast('已重绑——这个位置现在指向本机仓库');
      loadRepos();
      loadBoards();
    });

  const removePending = (m) =>
    guard(async () => {
      if (!confirm(`把「${m.name || m.key}」从组「${m.board}」里移除？\n\n只摘这个组里的位置：本机仓库与看板本身都不动。`)) return;
      await api('/api/boards/assign', {
        method: 'POST',
        body: { key: m.key, board: m.boardId, remove: true },
      });
      toast(`已从组「${m.board}」移除`);
      loadBoards();
    });

  // 批量清理：只清**没有任何线索**的占位（没有远程地址 → 克隆不回来 → 永远转不了正）。
  // 先预览再落盘，清单给到人看。
  const prunePending = () =>
    guard(async () => {
      const dry = await api('/api/boards/prune', { method: 'POST', body: { apply: false } });
      if (!dry?.total) {
        toast('没有可清理的占位（有远程地址的那些留着等 clone）');
        return;
      }
      const names = dry.items.map((i) => `· ${i.name}（组 ${i.board}）`).join('\n');
      if (!confirm(`清理 ${dry.total} 个无来源占位？\n\n${names}\n\n它们没有远程地址，克隆不回来，只能删。`)) return;
      await api('/api/boards/prune', { method: 'POST', body: { apply: true } });
      toast(`已清理 ${dry.total} 个占位`);
      loadBoards();
    });

  // 描述 = 文档：点开主篇/组内描述。还没写过（约定路径上没有文件）就先建一个空文档，
  // 打开即写——否则「未写」是个死链，人得先去命令行 docs add 才能写描述。
  // create 失败（已存在 / 并发）一律当成功：下一步是打开，存在与否由文档页自己判断。
  const openDescDoc = (rel, title) => guard(async () => {
    if (!rel) return;
    await api('/api/docs/item', { method: 'POST', body: { rel, body: `# ${title || rel}\n\n` } }).catch(() => {});
    openByDocId('rel:' + rel);
    loadRepos();
    loadDocs();
  });

  // 组介绍文档入口：docPath（绝对路径落盘的）直接开；
  // 否则按约定 rel（board/<组>.md）先建空文档再开——点开即写，不让「未写」成死链。
  const openBoardDoc = (b) => {
    if (b.docPath) return openByDocId('path:' + b.docPath);
    return openDescDoc(b.docRel, `${b.name} · 组介绍`);
  };

  // 「新建文档」不先逼人取名：点＋直接用默认路径落盘并打开编辑器，
  // 想改名在文档页「更多 → 重命名」里改（#49）。重名自动加序号，不覆盖已有文件。
  const nextDocRel = (base) => {
    const taken = new Set((docs || []).map((d) => String(d.rel || '').toLowerCase()));
    let rel = `${base}.md`;
    if (!taken.has(rel.toLowerCase())) return rel;
    for (let i = 2; ; i += 1) {
      rel = `${base}-${i}.md`;
      if (!taken.has(rel.toLowerCase())) return rel;
    }
  };

  // 新建文档：默认路径 → 落空文档 → 打开编辑器（一步到位，不弹命名框）
  const createDoc = () => guard(async () => {
    const rel = nextDocRel('note/untitled');
    await api('/api/docs/item', { method: 'POST', body: { rel, body: '' } }).catch(() => {});
    setDocOpen(false); // 从「文档检索」弹窗里建的：先关弹窗，落点是编辑器
    openByDocId('rel:' + rel);
    await loadDocs();
  });

  // 删文档：文件本体删掉（入参 ref = docId）。它仍被引用时先把引用数摆出来让人知情。
  const delDoc = (d) => guard(async () => {
    const hosts = docHosts.get(d.rel) || [];
    const ok = await dialog({
      message: `删除文档「${d.title || d.rel}」？磁盘文件会被删除。`
        + (hosts.length ? `它正被 ${hosts.length} 处引用（${hosts.map((h) => h.label).join('、')}）。` : ''),
      danger: true,
    });
    if (!ok) return;
    await api('/api/docs/item', { method: 'DELETE', body: { ref: d.docId } });
    toast(`已删除：${d.rel}`);
    await Promise.all([loadDocs(), loadRepos(), loadBoards()]);
  });

  const rowActs = {
    open: (r) => rowAct('open', r),
    edit: (r) => rowAct('edit', r),
    del: (r) => rowAct('del', r),
    remote: (r) => openRemote(r),
    // 查看详情：完整文档集弹窗（主篇 / 补充 / reference / 组内，就地编辑）
    // onChanged 回灌仓库与文档两份数据（descDocs 摘要与文档检索都靠它们）
    docs: (r) => setDocsFor({ kind: 'repo', owner: r }),
    // 行内分组 chip = 快捷筛选（再点一次取消）
    filter: (id) => setFilter((f) => (f === id ? '' : id)),
    // 绑定管理：从开发仓库行进入 —— 勾选哪些参考绑到它身上（多对多的 dev 侧视角）
    bind: (r) => {
      const sel = {};
      // 优先读 dev 侧的反向引用（绑定双向记录）；老数据回退扫 ref 侧（全部按 key）
      for (const l of r.linked || []) {
        if (l.kind !== 'ref') continue;
        sel[l.id] = true;
      }
      for (const x of refRepos) {
        if (sel[x.key]) continue;
        if ((x.linked || []).some((l) => l.kind === 'repo' && l.id === r.key)) sel[x.key] = true;
      }
      setBindRepoSel(sel);
      setBindRepoFor(r);
    },
    refNote: (ref, devRepo) => {
      const full = refRepos.find((x) => x.key === ref.key);
      if (full) openLinkNote(full, 'repo', devRepo.key, devRepo.name);
    },
    // 组内描述文档收进 DocsModal（查看详情）——行内不再单列入口。
    // 给仓库再绑一篇文档同样在弹窗里「＋ 补充」。
  };

  return (
    <div className="rp-page">
      {/* 平台头部：标题 + 统计 chips + 主操作。
          原工具栏动作（看板弹窗的建/导入/导出、参考面板入口、导入导出面板）全部收编到这里。 */}
      <div className="page-head">
        <div className="title-block">
          <h2>仓库管理</h2>
          {/* 统计 chip = 跳转入口：点一下到对应区块（参考仓库直接开面板） */}
          <div className="rp-stats">
            <button className="rp-stat" title="跳到开发仓库列表"
              onClick={() => { setFilter(''); jumpTo('rp-repos'); }}>
              开发仓库 <b>{devRepos.length}</b>
            </button>
            <button className="rp-stat" title="打开参考仓库面板"
              onClick={() => setRefOpen(true)}>
              参考仓库 <b>{refRepos.length}</b>
            </button>
            <button className="rp-stat" title="打开分组管理"
              onClick={() => setBoardAdminOpen(true)}>
              分组 <b>{boardList.length}</b>
            </button>
            <button className="rp-stat" title="文档检索：按仓库 / 组内 / 分组筛"
              onClick={() => setDocOpen(true)}>
              文档 <b>{docs.length}</b>
            </button>
          </div>
        </div>
        <div className="acts">
          <button className="btn" onClick={openAdd}>登记仓库</button>
          <button className="btn ghost" title="分组管理：建组 / 成员 / 组介绍文档"
            onClick={() => setBoardAdminOpen(true)}>分组管理</button>
          <button className="btn ghost" title="参考仓库面板：克隆 / 绑定 / 同步 / 检查 / 存储根"
            onClick={() => setRefOpen(true)}>参考仓库管理</button>
          <button className="btn ghost" title="布局与仓库的导入导出（逐条选择 / 冲突方案 / 差异检查）"
            onClick={() => setTransferOpen(true)}>导入导出</button>
        </div>
      </div>

      {/* 待初始化：组里引用、本机未登记的仓库（导入布局带进来的占位）。
          三条出口：接到本机仓库（改关系，不动身份）/ 克隆到本地 / 直接移除。
          「无远程地址」的占位克隆不回来，只能清 —— 所以给一条批量清理。 */}
      {pendingInit.length > 0 && (
        <section className="rp-pending" data-testid="rp-pending-init">
          <header className="rp-pending-head">
            <div className="rp-pending-head-main">
              <h3>
                待初始化<span className="rp-pending-count">{pendingInit.length}</span>
              </h3>
              <p>组里有位置、本机没有登记。接到本机仓库、克隆下来，或者直接移除。</p>
            </div>
            <button className="btn small ghost" onClick={prunePending}>
              清理无来源占位
            </button>
          </header>
          <div className="rp-pending-list">
            {pendingInit.map((m) => (
              <article className="rp-pending-card" key={m.key + '@' + m.boardId}>
                <div className="rp-pending-info">
                  <div className="rp-pending-title">
                    <strong>{m.name || m.key}</strong>
                    <span className="rp-pending-board">组 · {m.board}</span>
                    {m.remote ? null : <span className="rp-pending-tag">无远程地址</span>}
                  </div>
                  <code className="rp-pending-key">{m.key}</code>
                  {m.desc ? <p className="rp-pending-desc">{m.desc}</p> : null}
                </div>
                <div className="rp-pending-acts">
                  {m.match ? (
                    <button
                      className="btn small"
                      title={`把组里这个位置指向本机仓库「${m.match.name}」（仓库身份不变）`}
                      onClick={() => bindPending(m, m.match.id)}
                    >
                      绑定到「{m.match.name}」
                    </button>
                  ) : null}
                  {m.remote ? (
                    <button className="btn small ghost" onClick={() => clonePending(m)}>克隆到本地</button>
                  ) : null}
                  <button className="btn small ghost" onClick={() => bindPendingPick(m)}>选本机仓库</button>
                  <button
                    className="btn small ghost rp-del"
                    title="只从组里摘掉这个位置，本机仓库与看板都不动"
                    onClick={() => removePending(m)}
                  >
                    移除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 分组不占主版面：它是筛选维度 + 弹窗里的维护对象。
          分组管理（建组 / 成员 / 组介绍文档 / 导入导出）统一收进「分组管理」弹窗。 */}

      {/* 分组筛选器：主表 = 开发仓库；点 chip 只看那个组的成员（再点取消）。
          行内的分组 chips 也会落到同一个 filter 上。 */}
      <div className="rp-filters" data-testid="rp-filters">
        <div className="rp-filters-main">
          <button
            className={'rp-chip' + (filter ? '' : ' on')}
            onClick={() => setFilter('')}
            title="显示全部开发仓库"
          >
            全部 <b>{devRepos.length}</b>
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
        </div>
        <div className="rp-filters-side">
          <input
            className="rp-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜仓库 / 路径 / 分组 / 文档…"
            aria-label="检索仓库与文档"
          />
          {q ? <button className="btn small ghost" onClick={() => setQ('')}>清空</button> : null}
          <span className="muted rp-search-count">{shown.length} / {devRepos.length}</span>
          <button className="btn small ghost" title="按仓库 / 组内 / 分组三档检索文档"
            onClick={() => setDocOpen(true)}>文档检索</button>
        </div>
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
              还没有领域描述 —— 点「组介绍文档」补一段：侧重什么、谁配合谁、关键路径与搜索关键词在哪。
            </span>
          )}
          <span className="acts">
            <button className="btn small ghost" title="打开这个分组的组介绍文档"
              onClick={() => openBoardDoc(filterBoard)}>组介绍文档 ✎</button>
            <a className="btn small ghost" href={'#/group/' + encodeURIComponent(filterBoard.id)}
              title="组页里看这个组的成员与任务">组页 ↗</a>
            <button className="btn small" onClick={() => setImpBoardId(filterBoard.id)}>添加成员</button>
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
            const boardLink = (r.linked || []).find((l) => l.kind === 'board' && l.id === (filterBoard.key || `board/${filterBoard.name}`));
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

      {/* 参考仓库：独立弹窗（宽表）。与开发仓库分表——主表只放 dev，行内「参考」列
          显示绑到它的 ref。每行：状态徽标 / 名称+描述 / 远程地址 / 绑定 chips / 操作。
          绑定一律选项式（「绑定」弹窗里勾选），不手填字符串。
          做成弹窗：它是「隔一阵来维护一次」的东西，平铺会把开发仓库主表顶到两屏之外。 */}
      {refOpen ? (
        <Modal size="wide" title={`参考仓库 · ${refRepos.length}`} onClose={() => setRefOpen(false)}>
          <div className="rp-modal-bar">
            <span className="acts">
              <button className="btn small" onClick={() => { setCloneTargets({}); setCloneOpen(true); }}>克隆参考仓库</button>
              <button className="btn small ghost" onClick={syncAll}>同步全部</button>
              <button className="btn small ghost" onClick={loadRefCheck}>检查</button>
              <button className="btn small ghost" onClick={() => setTransferOpen(true)}>导入导出</button>
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
                        <DocsEntry docs={r.descDocs} onOpen={() => rowActs.docs(r)} />
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
        </Modal>
      ) : null}

      {/* 开发仓库主表：一行一个开发仓库。核心列是「文档」——项目文档（主篇 + 补充篇）
          与每个所属分组的组内文档，逐篇可点开/可摘除；「参考」列 = 绑到它身上的
          参考仓库（多对多）；「分组」列 chips 点一下即筛到那个组。 */}
      <div className="rp-table-wrap" id="rp-repos">
        <table className="rp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: '19%' }}>仓库</th>
              <th scope="col">
                文档
                <span className="rp-th-hint">主篇摘要 · 查看详情打开完整文档列表</span>
              </th>
              <th scope="col" style={{ width: '16%' }}>参考仓库</th>
              <th scope="col" style={{ width: '13%' }}>分组</th>
              <th scope="col" style={{ width: '215px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <RepoRow key={r.id} r={r} filterBoard={filterBoard} refsOfRepo={refsOfRepo} acts={rowActs} />
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan="5" className="muted rp-empty">
                  {devRepos.length ? (
                    <>
                      这个分组还没有成员{' '}
                      {filterBoard ? (
                        <button className="btn small" onClick={() => setImpBoardId(filterBoard.id)}>添加成员</button>
                      ) : null}
                    </>
                  ) : (
                    '还没有登记开发仓库 —— 点右上「登记仓库」加一条。'
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* 文档检索（弹窗）：不铺全量长列表 —— 先按「仓库 / 组内 / 分组 / 未绑定」分档，
          再叠加关键词过滤；绑定 chip 可点，直接跳到宿主。
          文档自己不记宿主，宿主关系散在仓库/分组的绑定字段上（见 docHosts）。 */}
      {docOpen ? (
        <Modal size="wide" title={`文档检索 · ${docs.length}`} onClose={() => setDocOpen(false)}>
          <div className="rp-modal-bar rp-doc-bar">
            <input
              className="rp-search"
              type="search"
              value={docKw}
              onChange={(e) => setDocKw(e.target.value)}
              placeholder="搜标题 / 路径 / 组名 / 仓库名…"
              aria-label="检索文档"
            />
            {docKw ? <button className="btn small ghost" onClick={() => setDocKw('')}>清空</button> : null}
            <span className="acts">
              <button className="btn small" onClick={createDoc}>新建文档</button>
            </span>
          </div>
          {docs.length ? (
            <>
              <div className="rp-doc-scopes">
                {[
                  ['all', '全部', docScopeCounts.all],
                  ['repo', '仓库文档', docScopeCounts.repo],
                  ['scoped', '组内文档', docScopeCounts.scoped],
                  ['board', '分组文档', docScopeCounts.board],
                  ['orphan', '未绑定', docScopeCounts.orphan],
                ].map(([id, label, n]) => (
                  <button
                    key={id}
                    className={'rp-chip' + (docScope === id ? ' on' : '')}
                    onClick={() => setDocScope(id)}
                  >
                    {label} <b>{n}</b>
                  </button>
                ))}
              </div>
              <div className="rp-doc-rows rp-doc-rows-modal">
                {docRows.map(({ d, hosts }) => (
                  <div className="rp-doc-row" key={d.docId}>
                    <button
                      type="button"
                      className="rp-doc-row-title"
                      title={`打开「${d.title || d.rel}」`}
                      onClick={() => openByDocId(d.docId)}
                    >
                      {d.title || d.name || d.rel}
                    </button>
                    <code className="rp-doc-row-rel" title={d.rel}>{d.rel}</code>
                    <span className="rp-doc-row-hosts">
                      {hosts.length ? hosts.map((h) => (
                        <button
                          type="button"
                          className={'rp-bind-chip ' + h.kind}
                          key={h.key}
                          title={`${h.tip}\n点击跳到这个宿主`}
                          onClick={() => { docGo(h); setDocOpen(false); }}
                        >
                          {h.label}
                        </button>
                      )) : <span className="rp-bind-chip none">未绑定</span>}
                    </span>
                    <span className="rp-doc-row-acts">
                      <button className="btn small ghost" onClick={() => openByDocId(d.docId)}>打开编辑</button>
                      <button className="btn small ghost rp-del" onClick={() => delDoc(d)}>删除</button>
                    </span>
                  </div>
                ))}
                {!docRows.length ? (
                  <div className="rp-board-empty muted">这一档没有匹配的文档。</div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="rp-board-empty muted">
              还没有文档 —— 点「新建文档」给一个相对路径（如 note/inbox.md）就开写；
              或在仓库行上点「＋ 写项目介绍」。
            </div>
          )}
        </Modal>
      ) : null}

      {/* 分组管理（弹窗）：分组是筛选维度与「思考模型」，维护动作不需要占主版面。
          每行 = 组名 + 成员 + 组介绍文档 + 操作；筛选/组页/成员/编辑/删除都在行上。 */}
      {boardAdminOpen ? (
        <Modal size="wide" title={`分组管理 · ${boardList.length}`} onClose={() => setBoardAdminOpen(false)}>
          <div className="rp-modal-bar">
            <span className="acts">
              <button className="btn small" onClick={() => setBoardForm({ id: null, name: '', desc: '' })}>新建分组</button>
              <button className="btn small ghost" title="粘贴/选择看板 JSON" onClick={() => setImpOpen(true)}>导入</button>
              <button className="btn small ghost" title="导出全部看板为 JSON" onClick={doExport}>导出</button>
            </span>
            <span className="muted">一个分组 = 一个主题；同一个仓库可以同时在多个分组里。</span>
          </div>
          {boardList.length ? (
            <div className="rp-board-admin">
              <div className="rp-board-admin-head">
                <span>分组</span><span>成员</span><span>组介绍</span><span>操作</span>
              </div>
              {boardList.map((b) => {
                const members = (b.repos || []).filter((m) => m.present !== false);
                const missing = (b.repos || []).filter((m) => m.present === false);
                return (
                  <div className="rp-board-admin-row" key={b.id}>
                    <span className="rp-board-admin-name">
                      {b.name}
                      <button
                        className="rp-mini-link"
                        title={`只看「${b.name}」里的仓库`}
                        onClick={() => { setFilter(b.id); setBoardAdminOpen(false); }}
                      >
                        筛选
                      </button>
                    </span>
                    <span className="rp-board-admin-members">
                      {members.slice(0, 4).map((m) => (
                        <span className="rp-board-mchip" key={m.key} title={m.note || m.key}>{m.name || m.key}</span>
                      ))}
                      {members.length > 4 ? <span className="rp-board-more">+{members.length - 4}</span> : null}
                      {missing.length ? <span className="rp-board-missing">{missing.length} 待初始化</span> : null}
                      {!b.repos.length ? <span className="muted">—</span> : null}
                    </span>
                    <span className="rp-board-admin-doc">
                      <button className="btn small ghost" title="打开组介绍文档"
                        onClick={() => openBoardDoc(b)}>组介绍 ✎</button>
                      {b.docLinks && b.docLinks.length ? <span className="muted">+{b.docLinks.length}</span> : null}
                    </span>
                    <span className="rp-board-admin-acts">
                      <a className="btn small ghost" href={'#/group/' + encodeURIComponent(b.id)} title="组页：成员与任务">组页 ↗</a>
                      <button className="btn small ghost" onClick={() => setImpBoardId(b.id)}>成员</button>
                      <button className="btn small ghost" onClick={() => setBoardForm({ id: b.id, name: b.name, desc: b.desc || '' })}>编辑</button>
                      <button className="btn small ghost rp-del" onClick={() => removeBoard(b)}>删除</button>
                    </span>
                  </div>
                );
              })}
              {boards.unassigned?.length ? (
                <div className="rp-boards-unassigned">
                  未分组 <b>{boards.unassigned.length}</b> 个 —— 不属于任何分组，只在「全部」里可见。
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rp-board-empty muted">
              还没有分组 —— 点「新建分组」建一个当主题用（如「前端」「AI 工具」），再把仓库点选进去。
            </div>
          )}
        </Modal>
      ) : null}

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
            {/* 描述不是一段字符串，是绑定的文档：这里只显示主篇（点开即编辑），
                补充篇在文档页里管理。新建时还没有文档，等落地后从行内点进去写。 */}
            {editingDocs ? (
              <div className="form-field">
                <label>项目描述（文档）</label>
                <div className="rp-docpick">
                  <button type="button" className="rp-doc" onClick={() => { setFormOpen(false); openByDocId(editingDocs.main.docId); }}>
                    {editingDocs.main.title}
                    {editingDocs.main.exists ? null : <span className="rp-doc-todo">未写</span>}
                  </button>
                  {editingDocs.links.length ? (
                    <span className="muted">另有 {editingDocs.links.length} 篇补充文档</span>
                  ) : null}
                </div>
              </div>
            ) : null}
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
            {boardForm.id ? (
              <div className="form-field">
                <label>领域描述（文档）</label>
                <div className="rp-docpick">
                  <button
                    type="button"
                    className={'rp-doc' + (boardForm.desc ? '' : ' ghost')}
                    title="打开组介绍文档"
                    onClick={() => {
                      const b = boardList.find((x) => x.id === boardForm.id);
                      setBoardForm(null);
                      if (b && (b.docRel || (b.doc && b.doc.rel))) openByDocId('rel:' + (b.docRel || b.doc.rel));
                    }}
                  >
                    {boardForm.desc || '未写'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-field">
                <label htmlFor="bd-desc">初始描述</label>
                <textarea
                  id="bd-desc"
                  rows={3}
                  spellCheck="false"
                  placeholder={'新建时给的介绍正文（之后以 board/<组>.md 文档为准）。\n如：这组仓库在这个环境里的侧重、配合关系、关键路径与搜索关键词。'}
                  value={boardForm.desc}
                  onChange={(e) => setBoardForm((f) => ({ ...f, desc: e.target.value }))}
                />
              </div>
            )}
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
        <Modal title="导入看板 JSON" size="lg" onClose={() => { setImpOpen(false); setImpText(''); }}>
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
        <Modal title="看板 JSON（可回灌给导入）" size="lg" onClose={() => setExpText(null)}>
          <textarea className="bd-exp" rows={14} readOnly value={expText} spellCheck="false" />
        </Modal>
      ) : null}

      {/* 成员管理：项目 + 项目组，可搜索 —— 与组面板「添加成员」同一个组件 */}
      {impBoard ? (
        <MemberPicker
          board={impBoard}
          boards={boardList}
          repos={repos}
          onClose={() => setImpBoardId(null)}
          onChanged={async () => { await Promise.all([loadRepos(), loadBoards()]); }}
        />
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
                    <label className="rp-pick-item" key={r.key}>
                      <input type="checkbox" checked={!!bindRepoSel[r.key]}
                        onChange={(e) => setBindRepoSel((m) => ({ ...m, [r.key]: e.target.checked }))} />
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

      {/* 导入导出：全屏覆盖层面板（逐条选择 / 冲突方案 / 差异检查） */}
      {transferOpen ? (
        <TransferPanel
          onClose={() => setTransferOpen(false)}
          onChanged={onTransferDone}
          repos={repos}
          boards={boardList}
        />
      ) : null}

      {/* 对齐 remote：key 是本地身份，remote 是协作的标准单位。
          候选来自 git remote -v，当前采纳的打勾；点另一条即对齐过去。 */}
      {remoteOpen && remoteInfo ? (
        <Modal title={`对齐 remote · ${remoteInfo.name}`} onClose={() => setRemoteOpen(false)}>
          <div className="form-grid" data-testid="rp-remote-modal">
            <div className="form-field">
              <div className="form-hint">
                当前采纳：<b>{remoteInfo.current || '（无）'}</b>。换一条即对齐（key 随之重算；自定义 key 不动）。
              </div>
              <div className="rp-remote-list">
                {remoteInfo.remotes.map((rm) => (
                  <div className="rp-remote-item" key={rm.name + '|' + rm.url}>
                    <span className="rp-remote-name">{rm.name}</span>
                    <span className="mono rp-remote-url">{rm.url}</span>
                    <span className="rp-remote-kind">{rm.kind}</span>
                    {rm.current ? <span className="rp-remote-on">当前</span> : null}
                    <span className="acts">
                      {!rm.current ? (
                        <button className="btn small" onClick={() => pickRemote(rm.url)}>对齐这条</button>
                      ) : null}
                      <button className="btn small ghost" onClick={() => checkRemote(rm.url)}>检查</button>
                    </span>
                  </div>
                ))}
                {!remoteInfo.remotes.length ? (
                  <div className="muted">这个仓库没有配置 remote —— 先在 git 里 git remote add</div>
                ) : null}
              </div>
            </div>
            {remoteCheck ? (
              <div className="form-field">
                <label>存在性检查</label>
                <div className="rp-remote-check">
                  <span className={'rp-status ' + (remoteCheck.status === 'exists' ? 'same' : remoteCheck.status === 'missing' ? 'new' : remoteCheck.status === 'checking' ? 'checking' : 'missing')}>
                    {remoteCheck.status === 'exists' ? '存在'
                      : remoteCheck.status === 'missing' ? '不存在'
                      : remoteCheck.status === 'checking' ? '检查中'
                      : '不可达'}
                  </span>
                  <span className="mono rp-remote-url">{remoteCheck.url}</span>
                  <span className="muted">{remoteCheck.detail}</span>
                </div>
              </div>
            ) : null}
            <div className="form-acts">
              <button className="btn ghost" onClick={() => setRemoteOpen(false)}>关闭</button>
              <button className="btn" onClick={() => checkRemote('')}>检查当前 remote</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 查看详情（文档集弹窗）：完整列表 + 复用编辑器就地编辑；
          增删改标签后回灌仓库与文档数据（行内摘要与文档检索同步更新）。
          model 必须传：弹窗里「更多 → 文字列表」要在工作区开 refs 右侧栏。 */}
      {docsFor ? (
        <DocsModal
          kind={docsFor.kind}
          owner={docsFor.owner}
          model={app.model}
          onClose={() => setDocsFor(null)}
          onChanged={() => { loadRepos(); loadDocs(); }}
        />
      ) : null}

      {dialogNode}
    </div>
  );
}
