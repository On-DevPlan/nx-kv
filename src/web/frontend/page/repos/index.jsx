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
import { Button, DropdownButton } from '../../components/button/index.jsx';
// key 归一化与后端共用同一份纯函数（shared/repo-key.js 无 Node 依赖，可直接进前端包），
// 避免面板里显示/自动填充的 key 和后端登记时算出来的 key 不一致。
import { keyFromRemote, normalizeKey } from '../../../../shared/repo-key.js';

const EMPTY_FORM = { path: '', name: '', desc: '', notes: '', type: 'dev', remote: '', key: '' };

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
// 「参考」列：全局视图按组汇总（组名 · N，点一下筛到那个组）；
// 组筛选视图（命名空间）改成两类勋章——`组` = 本组共享的参考仓库，`自` = 这个
// 仓库自己直接绑定的参考仓库，去重后超过 4 个折叠。
function RefRepoChips({ chips, boardId, acts }) {
  const LIMIT = 4;
  const [open, setOpen] = useState(false);
  const shown = open ? chips : chips.slice(0, LIMIT);
  return (
    <>
      {shown.map((c) => (
        <span key={c.source + ':' + c.key} className={'rp-link-chip rp-link-chip-' + (c.source === 'group' ? 'group' : 'repo')}>
          <button
            className="rp-link-chip-main"
            title={c.source === 'group'
              ? [`组「${c.groupName}」共享的参考仓库`, c.note].filter(Boolean).join('\n')
              : ['本仓库直接绑定的参考仓库', c.note, '点击跳到这个参考仓库'].filter(Boolean).join('\n')}
            onClick={() => (c.source === 'group' ? acts.keepFilter(boardId) : acts.gotoRefRepo(c.key))}
          >
            <b>{c.source === 'group' ? '组' : '自'}</b>
            <span className="rp-link-chip-name">{c.name}</span>
          </button>
        </span>
      ))}
      {chips.length > LIMIT ? (
        <button className="rp-bind-more" title="展开本行全部参考仓库" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : `+${chips.length - LIMIT}`}
        </button>
      ) : null}
    </>
  );
}

function RepoRow({ r, filterBoard, groupRefRepoCounts, refRepoChipsByRepo, acts }) {
  const groups = groupRefRepoCounts.get(r.key) || [];
  const chips = filterBoard ? (refRepoChipsByRepo.get(r.key) || []) : null;
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
        {filterBoard ? (
          chips && chips.length
            ? <RefRepoChips chips={chips} boardId={filterBoard.id} acts={acts} />
            : <span className="muted rp-refs-none">—</span>
        ) : (groups.length ? groups.map((g) => (
          <button key={g.id} className={'rp-group-chip' + (filterBoard && filterBoard.id === g.id ? ' on' : '')}
            title={`组「${g.name}」绑定 ${g.count} 个参考仓库（组内共享）\n点击只看这个组`}
            onClick={() => acts.filter(g.id)}>
            {g.name} <b>{g.count}</b>
          </button>
        )) : <span className="muted rp-refs-none">—</span>)}
        <Button small className="rp-ref-bind" title="管理这个仓库所属组的参考仓库" onClick={() => acts.bind(r)}>绑定</Button>
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
        {/* #136：编辑 → 打开 → 更多 → 删除 */}
        <Button small onClick={() => acts.edit(r)}>编辑</Button>
        <Button small title="在文件管理器中打开" onClick={() => acts.open(r)}>打开</Button>
        <DropdownButton
          small
          label="更多"
          items={[{ key: 'remote', label: '对齐 remote' }]}
          onSelect={(k) => { if (k === 'remote') acts.remote(r); }}
        />
        <Button small danger onClick={() => acts.del(r)}>删除</Button>
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
  // key 是否被用户手动改过：没改过时跟随远程地址自动填充；改过就不再被覆盖。
  // 这不仅影响 UI，也决定提交时发不发 key —— 发 key 等于「固化为自定义」。
  const [keyManual, setKeyManual] = useState(false);
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
  // 远程地址变化时，只要用户没手动改过 key，就把归一化结果同步到 key 输入框。
  // 判定「没改过」= keyManual=false；这样粘贴 SSH/HTTPS 任一写法都会自动得到
  // github.com/owner/repo 这种统一 key，用户仍可再改。
  // 路径 → git remote 的探测结果（登记前自动填充；只读，不改库）：
  //   { loading } | { exists, isGit, recommended, key, remotes } | { error }
  const [detect, setDetect] = useState(null);
  // 远程地址是否被人改过：改过就不再用探测结果覆盖（编辑已有仓库时开箱为 true）
  const [remoteManual, setRemoteManual] = useState(false);
  const setRemote = (e) => {
    const remote = e.target.value;
    setRemoteManual(true);
    setDetect(null);
    setForm((f) => ({ ...f, remote, key: keyManual ? f.key : keyFromRemote(remote) }));
  };
  const setKey = (e) => {
    setKeyManual(true);
    setForm((f) => ({ ...f, key: e.target.value }));
  };

  // ---- 参考仓库（type=ref）大面板状态 ----
  const [refOpen, setRefOpen] = useState(false);
  // 从组筛选视图点「自」勋章跳过来时定位的参考仓库 key（滚动 + 高亮一行）
  const [refRepoFocus, setRefRepoFocus] = useState('');
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
  const [bindSel, setBindSel] = useState({}); // { 'repo:<key>': bool, 'board:<key>': bool }
  // 参考面板里每行绑定勋章的折叠状态（refId → 是否展开；默认只显示前几个）
  const [refBindOpen, setRefBindOpen] = useState({});
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

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setFormOpen(false);
    setKeyManual(false);
    setRemoteManual(false);
    setDetect(null);
  };

  // 填完路径自动问一次 git remote（400ms 防抖）；只在「远程地址没人动过」时覆盖，
  // 用户手填/编辑旧仓库时一律不动。目录不存在/不是 git/没 remote 只提示，不猜地址。
  useEffect(() => {
    if (!formOpen) return undefined;
    const p = form.path.trim();
    if (!p) { setDetect(null); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setDetect({ loading: true });
      try {
        const d = await api('/api/repos/detect', { method: 'POST', body: { path: p } });
        if (!alive) return;
        setDetect({ loading: false, ...d });
        if (d.recommended && !remoteManual) {
          setForm((f) => ({ ...f, remote: d.recommended, key: keyManual ? f.key : (d.key || f.key) }));
        }
      } catch (e) {
        if (alive) setDetect({ loading: false, error: e.message });
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [form.path, formOpen, remoteManual, keyManual]);

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

  // 组筛选视图点「自」勋章 → 打开参考仓库面板并滚到那一行（等面板挂载一帧再找）。
  useEffect(() => {
    if (!refOpen || !refRepoFocus) return undefined;
    let el = null;
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      el = document.getElementById('rp-refrepo-row-' + refRepoFocus);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('rp-row-flash');
      timer = setTimeout(() => el.classList.remove('rp-row-flash'), 1600);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (el) el.classList.remove('rp-row-flash');
    };
  }, [refOpen, refRepoFocus]);

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
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // dev 侧绑定保存：保持原语义（这个仓库所属组的参考，组内共享）。
  // 后端 --repo 现在写的是仓库级绑定，所以这里显式按 board 下发，避免语义漂移。
  const saveBindRepo = () => guard(async () => {
    if (!bindRepoFor) return;
    const current = new Set((groupRefReposByRepo.get(bindRepoFor.key) || []).map((x) => x.key));
    const want = new Set(Object.keys(bindRepoSel).filter((k) => bindRepoSel[k]));
    const groups = boardList.filter((b) => (b.repos || []).some((x) => x.key === bindRepoFor.key));
    if (!groups.length) {
      toast('这个仓库不属于任何组 —— 参考绑定挂在组上；先把它加入组');
      return;
    }
    for (const rid of want) {
      if (current.has(rid)) continue;
      for (const g of groups) await api('/api/repos/bind', { method: 'POST', body: { id: rid, board: [g.id] } });
    }
    for (const rid of current) {
      if (want.has(rid)) continue;
      for (const g of groups) await api('/api/repos/bind', { method: 'POST', body: { id: rid, board: [g.id], remove: true } });
    }
    setBindRepoFor(null);
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });
  // 绑定描述 = 组 ↔ 参考仓库这条关系上的描述
  const openLinkNote = (ref, groupId, groupName, note) => {
    setLinkNoteFor({ ref, groupId, groupName });
    setLinkNoteText(note || '');
  };
  const saveLinkNote = () => guard(async () => {
    const { ref, groupId } = linkNoteFor;
    await api('/api/repos/ref/note', {
      method: 'POST',
      body: { id: ref.key, board: groupId, note: linkNoteText },
    });
    setLinkNoteFor(null);
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
    toast('已保存组级绑定描述');
  });

  // 从某个组摘除这条参考绑定
  const unbindOne = (ref, groupId) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, board: [groupId], remove: true } });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // 从某个开发仓库摘除这条参考绑定（只摘仓库级，不影响组级）
  const unbindRepo = (ref, repoKey) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, repo: [repoKey], remove: true } });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
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
    (refCheck?.refRepos || []).forEach((x) => m.set(x.id, x));
    return m;
  }, [refCheck]);

  // 组级参考：仓库属于哪些组，就能看到这些组上绑定的参考仓库（组内共享，不折算成数量）。
  // 同一个参考仓库被多个组共享时只出一颗 chip，group 记第一个来源组（点 chip 改的就是它）。
  const groupRefReposByRepo = useMemo(() => {
    const m = new Map();
    const byKey = new Map(refRepos.map((r) => [r.key, r]));
    for (const b of boardList) {
      const bkey = b.key || `board/${b.name}`;
      for (const rk of (b.repos || []).map((x) => x.key)) {
        for (const l of b.refs || []) {
          const r = byKey.get(l.id);
          if (!r) continue;
          if (!m.has(rk)) m.set(rk, []);
          const arr = m.get(rk);
          const hit = arr.find((x) => x.key === r.key);
          if (hit) {
            if (hit.group && hit.group.name !== b.name) hit.alsoIn = [...(hit.alsoIn || []), b.name];
            continue;
          }
          arr.push({
            key: r.key,
            id: r.id,
            name: r.name,
            remote: r.remote || '',
            note: l.note || '',
            group: { id: b.id, key: bkey, name: b.name },
          });
        }
      }
    }
    return m;
  }, [boardList, refRepos]);

  // 主表「参考」列的汇总：仓库在哪些组、每组绑了几个参考（组内共享，不展开明细）。
  // 明细在组页的「组参考」区块里看——一行铺十几个 chip 会把表格撑爆。
  const groupRefRepoCounts = useMemo(() => {
    const m = new Map();
    for (const b of boardList) {
      const n = (b.refs || []).length;
      if (!n) continue;
      for (const x of b.repos || []) {
        if (!x || !x.key) continue;
        if (!m.has(x.key)) m.set(x.key, []);
        m.get(x.key).push({ id: b.id, name: b.name, count: n });
      }
    }
    return m;
  }, [boardList]);

  // 组筛选视图（group = 命名空间）的行内参考仓库：
  //   自 = 这个仓库自己直接绑的；组 = 本组共享、但这一行没有自己直接绑的。
  // 两类合并去重（同一个参考仓库在组里和仓库上都绑了 → 只出一颗，按「自」算），
  // 自在前——这一行最具体的信息先露出来，组共享的在折叠区里补全。
  // 全局视图不建这张表（那里仍按组汇总）。
  const refRepoChipsByRepo = useMemo(() => {
    const m = new Map();
    if (!filterBoard) return m;
    const byKey = new Map(refRepos.map((r) => [r.key, r]));
    const sharedAll = (filterBoard.refs || []).map((l) => {
      const r = byKey.get(l.id);
      return r ? { key: r.key, name: r.name, note: l.note || '', source: 'group', groupName: filterBoard.name } : null;
    }).filter(Boolean);
    for (const d of devRepos) {
      const own = (d.linked || [])
        .filter((l) => l && l.kind === 'ref')
        .map((l) => {
          const r = byKey.get(l.id);
          return r ? { key: r.key, name: r.name, note: l.note || '', source: 'repo' } : null;
        })
        .filter(Boolean);
      const ownKeys = new Set(own.map((c) => c.key));
      m.set(d.key, [...own, ...sharedAll.filter((c) => !ownKeys.has(c.key))]);
    }
    return m;
  }, [filterBoard, devRepos, refRepos]);

  // 仓库级直接绑定（反向索引）：参考仓库 key → 直接绑在它身上的开发仓库。
  // 与组级绑定并列展示，不用「组 + 成员数」去近似。
  const refRepoBackLinks = useMemo(() => {
    const m = new Map();
    for (const d of devRepos) {
      for (const l of d.linked || []) {
        if (!l || l.kind !== 'ref') continue;
        if (!m.has(l.id)) m.set(l.id, []);
        m.get(l.id).push({ repo: d, note: l.note || '' });
      }
    }
    return m;
  }, [devRepos]);

  // 筛选到组时：这个组上绑定的参考仓库（组内共享；不再有「经由成员仓库」）。
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
    setKeyManual(false);
    setRemoteManual(false);
    setDetect(null);
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

  // 参考面板里的勋章点击 = 关面板 → 跳到宿主（组 → 筛到该组；仓库 → 滚到那行并闪一下）
  const goBindTarget = (kind, target) => {
    setRefOpen(false);
    setQ('');
    setTimeout(() => docGo({ kind, target }), 60);
  };

  // 编辑弹窗里的「项目描述」= 这个仓库绑定的文档集（主篇 + 补充篇），不给字符串输入框
  const editingDocs = useMemo(() => {
    if (!editing) return null;
    const r = repos.find((x) => x.id === editing);
    return (r && r.descDocs) || null;
  }, [editing, repos]);

  const submit = () => guard(async () => {
    if (!form.path.trim()) return;
    const remote = form.remote.trim();
    const rawKey = form.key.trim();
    // key 只允许两个来源：用户填的，或远程地址归一化。两样都没有就不许保存。
    const nextKey = rawKey ? normalizeKey(rawKey) : keyFromRemote(remote);
    if (!nextKey) {
      toast('仓库 key 必填：没有远程 git 地址时必须手工填写 key（不会再自动生成 local/<目录名>）');
      return;
    }
    const body = {
      path: form.path.trim(),
      name: form.name.trim() || undefined,
      notes: form.notes,
      type: form.type === 'ref' ? 'ref' : 'dev',
      remote: remote || undefined,
    };
    if (editing) {
      const r = repos.find((x) => x.id === editing);
      const origKey = (r && r.key) || '';
      if (keyManual && rawKey === '') {
        // 清空 key = 放弃自定义，回到「跟随远程地址」；没有远程地址就没有身份可用。
        if (!remote) {
          toast('清空自定义 key 需要仓库有远程地址（否则 key 必填）');
          return;
        }
        body.key = '';
        body.keyCustom = false;
      } else if (keyManual && nextKey !== origKey) {
        // 改 key 是改身份：关系表会级联，但磁盘上的文档目录不会自己搬家。
        const ok = await dialog({
          title: '修改仓库 key',
          message: `key 是仓库身份，改掉会连锁影响：\n\n「${origKey || '(空)'}」→「${nextKey}」\n\n队列/看板/参考关系会跟随新 key 级联更新；docs/ 下按旧 key 生成的文档路径不会自动迁移，需要手动处理。确认修改？`,
          danger: true,
        });
        if (!ok) return;
        body.key = nextKey;
        body.keyCustom = true;
      }
      // 没手动改 key：不发 key。后端在 remote 变化且非自定义时会自动重算。
    } else {
      body.key = nextKey;
      if (keyManual) body.keyCustom = true;
    }
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
        key: r.key || '',
      });
      // 自定义 key 打开即视为「用户声明过」，编辑远程地址时不自动覆盖它；
      // 非自定义 key 仍跟着远程地址走（和编辑前行为一致）。
      setKeyManual(r.keyCustom === true);
      // 已有仓库的远程地址视为「已定」，不拿目录的 git remote 去覆盖它
      setRemoteManual(true);
      setDetect(null);
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
    // 组筛选视图里的「组」勋章：维持当前组筛选（不切换成取消）
    keepFilter: (id) => setFilter(id),
    // 组筛选视图的「自」勋章 = 跳到这个参考仓库（开参考仓库面板并定位到那一行）
    gotoRefRepo: (key) => { setRefRepoFocus(key); setRefOpen(true); },
    // 绑定管理：从开发仓库行进入 —— 勾选哪些参考绑到它所属的组（v4：组内共享）
    bind: (r) => {
      const sel = {};
      for (const x of groupRefReposByRepo.get(r.key) || []) sel[x.key] = true;
      setBindRepoSel(sel);
      setBindRepoFor(r);
    },
    // 组内描述文档收进 DocsModal（查看详情）——行内不再单列入口。
    // 给仓库再绑一篇文档同样在弹窗里「＋ 补充」。
  };

  return (
    <div className="rp-page">
      {/* 平台头部：标题 + 主操作。
          原工具栏动作（看板弹窗的建/导入/导出、参考面板入口、导入导出面板）全部收编到这里；
          「文档检索」的入口在下面的**列表搜索行**里（贴着搜索框，同一动作不摆第二颗）。
          #114 统计去交互、#116 去胶囊、#117 用户拍板整行删除——数量本身
          在表格/分组管理里都看得到，头部不再摆一排报数。 */}
      <div className="page-head">
        <div className="title-block">
          <h2>仓库管理</h2>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={openAdd}>登记仓库</Button>
          <Button title="分组管理：建组 / 成员 / 组介绍文档"
            onClick={() => setBoardAdminOpen(true)}>分组管理</Button>
          <Button title="参考仓库面板：克隆 / 绑定 / 同步 / 检查 / 存储根"
            onClick={() => setRefOpen(true)}>参考仓库管理</Button>
          {/* #114：「文档检索」入口在下面的**列表搜索行**里（贴着搜索框，
              同一动作不摆第二颗）——这里不再重复。 */}
          <Button title="布局与仓库的导入导出（逐条选择 / 冲突方案 / 差异检查）"
            onClick={() => setTransferOpen(true)}>导入导出</Button>
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
            <Button small onClick={prunePending}>
              清理无来源占位
            </Button>
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
                    <Button
                      small
                      title={`把组里这个位置指向本机仓库「${m.match.name}」（仓库身份不变）`}
                      onClick={() => bindPending(m, m.match.id)}
                    >
                      绑定到「{m.match.name}」
                    </Button>
                  ) : null}
                  {m.remote ? (
                    <Button small onClick={() => clonePending(m)}>克隆到本地</Button>
                  ) : null}
                  <Button small onClick={() => bindPendingPick(m)}>选本机仓库</Button>
                  <Button
                    small danger
                    title="只从组里摘掉这个位置，本机仓库与看板都不动"
                    onClick={() => removePending(m)}
                  >
                    移除
                  </Button>
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
          {q ? <Button small onClick={() => setQ('')}>清空</Button> : null}
          <span className="muted rp-search-count">{shown.length} / {devRepos.length}</span>
          <Button small title="按仓库 / 组内 / 分组三档检索文档"
            onClick={() => setDocOpen(true)}>文档检索</Button>
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
            <Button small title="打开这个分组的组介绍文档"
              onClick={() => openBoardDoc(filterBoard)}>组介绍文档 ✎</Button>
            <a className="btn small ghost" href={'#/group/' + encodeURIComponent(filterBoard.id)}
              title="组页里看这个组的成员与任务">组页 ↗</a>
            <Button small onClick={() => setImpBoardId(filterBoard.id)}>添加成员</Button>
          </span>
        </div>
      ) : null}

      {/* 组（项目组）绑定的参考仓库 —— 组内所有仓库共享（v4）。 */}
      {filterBoard ? (
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
                    onClick={() => openLinkNote(r, filterBoard.id, filterBoard.name, r.boardNote)}>
                    {r.boardNote.split('\n')[0]}
                  </button>
                ) : (
                  <Button small title={`写「${r.name}」在这个组里参考什么（组级描述）`}
                    onClick={() => openLinkNote(r, filterBoard.id, filterBoard.name, '')}>写描述</Button>
                )}
                <span className="acts">
                  <Button small onClick={() => syncOne(r)}>同步</Button>
                  <Button small onClick={() => rowAct('open', r)}>打开</Button>
                  <Button small danger title="只从本组摘除（不影响其它组）"
                    onClick={() => unbindOne(r, filterBoard.id)}>移出本组</Button>
                </span>
              </div>
            );
          }) : null}
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
              <Button small onClick={() => { setCloneTargets({}); setCloneOpen(true); }}>克隆参考仓库</Button>
              <Button small onClick={syncAll}>同步全部</Button>
              <Button small onClick={loadRefCheck}>检查</Button>
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
                        <DocsEntry docs={r.descDocs} onOpen={() => rowActs.docs(r)} />
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
                                        onClick={() => goBindTarget('board', l.board.id)}>
                                        <b>组</b>
                                        <span className="rp-link-chip-name">{l.board.name}</span>
                                      </button>
                                      <button className="rp-link-chip-note-btn"
                                        title={l.note ? `编辑组级描述：${l.note}` : '写这条组级描述（这个组里参考什么）'}
                                        onClick={() => openLinkNote(r, l.board.id, l.board.name, l.note)}>
                                        {l.note ? l.note.split('\n')[0] : '＋'}
                                      </button>
                                      <button className="rp-link-chip-x" title="从本组摘除（不影响其它组、也不动仓库级绑定）"
                                        onClick={() => unbindOne(r, l.board.id)}>×</button>
                                    </span>
                                  ))}
                                  {!open && groups.length > LIMIT ? (
                                    <button className="rp-bind-more" title="展开本行全部绑定"
                                      onClick={() => setRefBindOpen((m) => ({ ...m, [r.id]: true }))}>
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
                                        onClick={() => goBindTarget('repo', d.repo.key)}>
                                        <b>仓</b>
                                        <span className="rp-link-chip-name">{d.repo.name}</span>
                                        <span className="mono rp-link-chip-key">{d.repo.key}</span>
                                      </button>
                                      {d.note ? <i className="rp-link-chip-note" title={d.note}>{d.note.split('\n')[0]}</i> : null}
                                      <button className="rp-link-chip-x" title="从这个仓库摘除（不影响组级绑定）"
                                        onClick={() => unbindRepo(r, d.repo.key)}>×</button>
                                    </span>
                                  ))}
                                  {!open && direct.length > LIMIT ? (
                                    <button className="rp-bind-more" title="展开本行全部绑定"
                                      onClick={() => setRefBindOpen((m) => ({ ...m, [r.id]: true }))}>
                                      +{direct.length - LIMIT}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {collapsible ? (
                                <button className="rp-bind-toggle"
                                  onClick={() => setRefBindOpen((m) => ({ ...m, [r.id]: !open }))}>
                                  {open ? '收起' : `展开全部 ${groups.length + direct.length}`}
                                </button>
                              ) : null}
                              <Button small className="rp-ref-bind" onClick={() => openBind(r)}>绑定…</Button>
                            </>
                          );
                        })()}
                      </td>
                      <td className="rp-acts">
                        <Button small onClick={() => syncOne(r)}>同步</Button>
                        <Button small onClick={() => rowAct('open', r)}>打开</Button>
                        <Button small onClick={() => rowAct('edit', r)}>编辑</Button>
                        <Button small danger onClick={() => rowAct('del', r)}>删除</Button>
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
              <RepoRow key={r.id} r={r} filterBoard={filterBoard} groupRefRepoCounts={groupRefRepoCounts} refRepoChipsByRepo={refRepoChipsByRepo} acts={rowActs} />
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan="5" className="muted rp-empty">
                  {devRepos.length ? (
                    <>
                      这个分组还没有成员{' '}
                      {filterBoard ? (
                        <Button small onClick={() => setImpBoardId(filterBoard.id)}>添加成员</Button>
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
            {docKw ? <Button small onClick={() => setDocKw('')}>清空</Button> : null}
            <span className="acts">
              <Button small onClick={createDoc}>新建文档</Button>
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
                      <Button small onClick={() => openByDocId(d.docId)}>打开编辑</Button>
                      <Button small danger onClick={() => delDoc(d)}>删除</Button>
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
              <Button small onClick={() => setBoardForm({ id: null, name: '', desc: '' })}>新建分组</Button>
              <Button small title="粘贴/选择看板 JSON" onClick={() => setImpOpen(true)}>导入</Button>
              <Button small title="导出全部看板为 JSON" onClick={doExport}>导出</Button>
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
                      <Button small title="打开组介绍文档"
                        onClick={() => openBoardDoc(b)}>组介绍 ✎</Button>
                      {b.docLinks && b.docLinks.length ? <span className="muted">+{b.docLinks.length}</span> : null}
                    </span>
                    <span className="rp-board-admin-acts">
                      <a className="btn small ghost" href={'#/group/' + encodeURIComponent(b.id)} title="组页：成员与任务">组页 ↗</a>
                      <Button small onClick={() => setImpBoardId(b.id)}>成员</Button>
                      <Button small onClick={() => setBoardForm({ id: b.id, name: b.name, desc: b.desc || '' })}>编辑</Button>
                      <Button small danger onClick={() => removeBoard(b)}>删除</Button>
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
                value={form.remote} onChange={setRemote} />
              {detect ? (
                <div className="form-hint">
                  {detect.loading ? '正在从目录读取 git remote…'
                    : detect.error ? `读取 git remote 失败：${detect.error}`
                    : detect.recommended
                      ? `已按目录 git remote 自动填入${detect.remotes.length > 1 ? `（另有 ${detect.remotes.length - 1} 条候选）` : ''}`
                      : detect.exists === false ? '该路径不存在 —— 请检查后重填'
                      : detect.isGit ? '目录是 git 仓库，但没有配置 remote —— 请手工填写'
                      : '目录不是 git 仓库 —— 请手工填写'}
                </div>
              ) : null}
              <div className="form-hint">
                有远程地址时，下面的 key 会按它自动归一化：ssh / https / 带 .git / 带 user 的写法
                都归一成 host/owner/repo（如 github.com/on-devplan/nx-kv）。
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="repo-key">仓库 key *（全局唯一身份）</label>
              <input id="repo-key" spellCheck="false" placeholder="github.com/on-devplan/nx-kv"
                value={form.key} onChange={setKey} />
              <div className="form-hint">
                没有远程地址时必须手工填写；已有仓库可查看，改 key 会波及引用它的队列 / 看板 / 关系。
              </div>
            </div>
            <div className="form-field">
              <label htmlFor="repo-notes">备注</label>
              <textarea id="repo-notes" placeholder="补充信息（可选）" value={form.notes} onChange={set('notes')} />
            </div>
            <div className="form-acts">
              <Button  onClick={resetForm}>取消</Button>
              <Button  disabled={!form.path.trim() || (!form.key.trim() && !form.remote.trim())} onClick={submit}>
                {editing ? '保存修改' : '添加仓库'}
              </Button>
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
              <Button  onClick={() => setBoardForm(null)}>取消</Button>
              <Button  disabled={!boardForm.name.trim()} onClick={saveBoard}>
                {boardForm.id ? '保存' : '新建看板'}
              </Button>
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
              <Button  onClick={() => { setImpOpen(false); setImpText(''); }}>取消</Button>
              <Button  disabled={!impText.trim()} onClick={doImport}>导入</Button>
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
              <Button  onClick={() => { setCloneOpen(false); setCloneTargets({}); }}>取消</Button>
              <Button  disabled={!cloneForm.url.trim() || !settingInfo?.gitRepoRoot}
                title={settingInfo?.gitRepoRoot ? `克隆到 ${settingInfo.gitRepoRoot}` : '先在「存储根」设置 gitRepoRoot'}
                onClick={doClone}>克隆</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 绑定管理弹窗（参考侧）：这个参考绑到哪些组 / 哪些单独仓库 —— 两类并列勾选 */}
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

      {/* dev 侧绑定弹窗：这个开发仓库所属组上的参考（组内共享） */}
      {bindRepoFor ? (
        <Modal title={`「${bindRepoFor.name}」的参考仓库`} onClose={() => setBindRepoFor(null)}>
          <div className="form-grid">
            <div className="form-field">
              <div className="form-hint">
                参考仓库绑定在组上，勾选 = 绑到「{bindRepoFor.name}」所属的组，组内所有仓库共享。仓库不属于任何组时请先把它加入组。
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
              <Button  onClick={() => setBindRepoFor(null)}>取消</Button>
              <Button  onClick={saveBindRepo}>保存绑定</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* 绑定描述弹窗：组 ↔ 参考仓库这条关系上「参考什么」（摘绑即清） */}
      {linkNoteFor ? (
        <Modal
          title={`组级绑定描述 · ${linkNoteFor.ref.name} @ 「${linkNoteFor.groupName}」`}
          onClose={() => setLinkNoteFor(null)}
        >
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="link-note">
                「{linkNoteFor.ref.name}」在这个组里参考什么
              </label>
              <div className="form-hint">
                写这条参考在此处的角色与用法（可多行、可含关键路径/搜索词）。留空保存 = 清除。
              </div>
              <textarea id="link-note" rows={5} spellCheck="false"
                placeholder={'如：project-graph 画布交互的实现参考；\n看 src/extensions/ 的注册方式，搜 registerExtension。'}
                value={linkNoteText} onChange={(e) => setLinkNoteText(e.target.value)} />
            </div>
            <div className="form-acts">
              <Button  onClick={() => setLinkNoteFor(null)}>取消</Button>
              <Button  onClick={saveLinkNote}>保存</Button>
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
                        <Button small onClick={() => pickRemote(rm.url)}>对齐这条</Button>
                      ) : null}
                      <Button small onClick={() => checkRemote(rm.url)}>检查</Button>
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
              <Button  onClick={() => setRemoteOpen(false)}>关闭</Button>
              <Button  onClick={() => checkRemote('')}>检查当前 remote</Button>
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
