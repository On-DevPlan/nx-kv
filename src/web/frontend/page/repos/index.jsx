// 仓库管理页（平台化）：统一展示 **repo / 分组（看板）/ ref 文档** 三者的关联。
//
// **来历**：原本长在 nx-rh，2026-10-23 整体迁到 nx-kv（远程清单 topic=goal 的 #72）——
// 仓库登记是本机事实，它的价值是给「本地任务管理」当上下文，所以它跟着任务走。
// 每个按钮 = 一条 HTTP 路由 = 一条 CLI 命令（三者同源于模块的 action 声明）。
//
// 版面（自上而下 = 任务流）：头部主操作 → 待初始化 → 筛选器 → 看板上下文/参考 →
// 开发仓库主表；维护类动作（参考面板 / 分组管理 / 文档检索 / 各绑定弹窗）全收弹窗。
// 视图区块按职责拆在同目录兄弟文件里，本文件只留数据面、共享动作与拼装：
//   repo-table（主表行）/ filters-bar（筛选行）/ board-refs（看板上下文+参考）/
//   pending-section（待初始化）/ ref-panel（参考面板）/ doc-search-modal（文档检索）/
//   board-admin（分组管理）/ repo-form-modal（登记编辑）/ bind-modals（绑定）/ remote-modal（对齐 remote）。
//
// 看板只存引用 → **加入分组是复制**，不是移动：同一个仓库可以同时在多个
// 分组里；取消某份副本只摘那个分组的引用，仓库本体纹丝不动。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import TransferPanel from '../../components/repos/transfer-panel.jsx';
import GetLoopModal from '../../components/repos/get-loop-modal.jsx';
import DocsModal from '../../components/Introduction/docs-modal.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import { useApp } from '../../app-context.jsx';
import { useWikiNav } from '../doc/index.jsx';
import RepoTable from './repo-table.jsx';
import FiltersBar from './filters-bar.jsx';
import BoardRefs from './board-refs.jsx';
import PendingSection from './pending-section.jsx';
import RefPanel from './ref-panel.jsx';
import DocSearchModal from './doc-search-modal.jsx';
import BoardAdminModal from './board-admin.jsx';
import RepoFormModal from './repo-form-modal.jsx';
import BindRepoModal, { LinkNoteModal } from './bind-modals.jsx';
import RemoteModal from './remote-modal.jsx';

export default function ReposView() {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp() || {};
  // 描述是文档 → 行内点标题要能开文档页签（useWikiNav 内部拿 app.model + 文档索引）
  const { openByDocId } = useWikiNav();

  // ---- 数据面：仓库中心清单（扁平；每条带 boards）+ 看板 + 参考检查 ----
  const [repos, setRepos] = useState([]);
  const [boards, setBoards] = useState(null); // { boards: [...], unassigned: [...] }
  const [refCheck, setRefCheck] = useState(null); // repo.ref.check 的结果（状态徽标的数据面）
  const loadRepos = useCallback(async () => {
    setRepos((await api('/api/repos').catch(() => [])) || []);
  }, []);
  const loadBoards = useCallback(async () => {
    setBoards(await api('/api/boards').catch(() => null));
  }, []);
  const loadRefCheck = useCallback(async () => {
    setRefCheck(await api('/api/repos/ref/check').catch(() => null));
  }, []);
  useEffect(() => { loadRepos(); loadBoards(); loadRefCheck(); }, [loadRepos, loadBoards, loadRefCheck]);

  // 各区块共享的刷新入口（子组件按动作语义各取所需）
  const reload = useMemo(() => ({
    repos: loadRepos,
    boards: loadBoards,
    refCheck: loadRefCheck,
    all: async () => { await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]); },
  }), [loadRepos, loadBoards, loadRefCheck]);

  // ---- 视图状态：筛选 + 检索（一个输入同时搜仓库名/路径、分组名、文档标题/rel） ----
  const [filter, setFilter] = useState(''); // '' = 全部（中心清单）
  const [q, setQ] = useState('');

  // ---- 弹窗开关（打开即挂载对应自包含组件，关掉即卸载） ----
  const [formFor, setFormFor] = useState(undefined); // undefined=关 | null=新建 | 仓库 id=编辑
  const [boardAdminOpen, setBoardAdminOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  // 从组筛选视图点「自」勋章跳过来时定位的参考仓库 key（滚动 + 高亮一行）
  const [refRepoFocus, setRefRepoFocus] = useState('');
  // 参考面板里每行绑定勋章的折叠状态（refId → 是否展开；默认只显示前几个）
  const [refBindOpen, setRefBindOpen] = useState({});
  const [docOpen, setDocOpen] = useState(false);
  // 成员管理弹窗：打开时 = 正在往这个看板里点选导入 / 摘除仓库
  const [impBoardId, setImpBoardId] = useState(null);
  // 布局导入导出：全屏面板（自己的 Tab 内维护全部临时状态）
  const [transferOpen, setTransferOpen] = useState(false);
  // 持续 get 配置弹窗（#145）：设置页「项目级设置」删除后，配置落到行内「更多」
  const [glFor, setGlFor] = useState(null);
  // 查看详情（文档集弹窗）：{ kind:'repo', owner } —— 行内「查看详情」入口
  const [docsFor, setDocsFor] = useState(null);
  const [remoteFor, setRemoteFor] = useState(null); // 对齐 remote 的目标仓库
  const [bindRepoFor, setBindRepoFor] = useState(null); // dev 侧绑定弹窗的目标仓库
  // 绑定描述编辑（组 ↔ 参考仓库这条关系）：{ ref, groupId, groupName, note } | null
  const [linkNoteFor, setLinkNoteFor] = useState(null);

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

  // 看板清单（用来做筛选器与各弹窗的勾选列表）
  const boardList = useMemo(() => (boards && boards.boards) || [], [boards]);

  // 参考仓库（type=ref）与开发仓库（type=dev）：两份名单分开，多对多绑定靠 linked 连接。
  // 必须先于 shown 声明（shown 的 useMemo 里用到）——生产构建里会压成单字母变量，
  // 用在声明前就是 "Cannot access 'Z' before initialization" 这类白屏错误。
  const devRepos = useMemo(() => repos.filter((r) => (r.type || 'dev') !== 'ref'), [repos]);
  const refRepos = useMemo(() => repos.filter((r) => r.type === 'ref'), [repos]);

  // 筛选后的开发仓库清单：选某个看板时只显示该看板的成员（去重）；
  // 检索词命中仓库名/路径/分组名/文档标题（含 rel）时也收窄到命中的行。
  // 参考仓库不在主表 —— 它们有大面板（头部工具条的「参考仓库」入口）。
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

  // ---- 跨区块共享动作 ----

  const syncOne = (r) => guard(async () => {
    const d = await api('/api/repos/ref/sync', { method: 'POST', body: { id: r.id } });
    toast(d.status === 'updated' ? `已更新: ${d.name}` : d.status === 'upToDate' ? `${d.name} 已是最新` : `${d.name}: ${d.status} ${d.output || ''}`);
  });

  // 从某个组摘除这条参考绑定（只摘组级，不动仓库级）
  const unbindOne = (ref, groupId) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, board: [groupId], remove: true } });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // 从某个开发仓库摘除这条参考绑定（只摘仓库级，不影响组级）
  const unbindRepo = (ref, repoKey) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, repo: [repoKey], remove: true } });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // 绑定描述 = 组 ↔ 参考仓库这条关系上的描述
  const openLinkNote = (ref, groupId, groupName, note) => {
    setLinkNoteFor({ ref, groupId, groupName, note: note || '' });
  };

  const rowAct = (act, r) => guard(async () => {
    if (act === 'open') {
      await api('/api/repos/open', { method: 'POST', body: { id: r.id } });
    } else if (act === 'del') {
      const ok = await dialog({
        message: `删除仓库登记「${r.name}」？（仅移除登记，磁盘文件不受影响；各看板里的归属同步摘除）`,
        danger: true,
      });
      if (!ok) return;
      await api(`/api/repos/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      await reload.all();
    }
  });

  // 描述 = 文档：点开主篇/组内描述。还没写过（约定路径上没有文件）就先建一个空文档，
  // 打开即写——否则「未写」是个死链，人得先去命令行 docs add 才能写描述。
  // create 失败（已存在 / 并发）一律当成功：下一步是打开，存在与否由文档页自己判断。
  const openDescDoc = (rel, title) => guard(async () => {
    if (!rel) return;
    await api('/api/docs/item', { method: 'POST', body: { rel, body: `# ${title || rel}\n\n` } }).catch(() => {});
    openByDocId('rel:' + rel);
    loadRepos();
  });

  // 组介绍文档入口：docPath（绝对路径落盘的）直接开；
  // 否则按约定 rel（board/<组>.md）先建空文档再开——点开即写，不让「未写」成死链。
  const openBoardDoc = (b) => {
    if (b.docPath) return openByDocId('path:' + b.docPath);
    return openDescDoc(b.docRel, `${b.name} · 组介绍`);
  };

  // 区块跳转：面板内容挂在 FlexLayout 的 tab 里（.flexlayout__tab_moveable 才是
  // 真正的滚动容器），scrollIntoView 在这条链上实测无效，必须手动算 scrollTop。
  const scrollPageTo = (el, block = 'start') => {
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
  const jumpTo = (id) => scrollPageTo(document.getElementById(id));

  // 绑定 chip 点击 = 跳到宿主：分组 → 筛到该组；仓库 → 滚到那行并闪一下
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
    scrollPageTo(row, 'center');
    row.classList.add('rp-row-flash');
    setTimeout(() => row.classList.remove('rp-row-flash'), 1400);
  };

  // 参考面板里的勋章点击 = 关面板 → 跳到宿主（组 → 筛到该组；仓库 → 滚到那行并闪一下）
  const goBindTarget = (kind, target) => {
    setRefOpen(false);
    setQ('');
    setTimeout(() => docGo({ kind, target }), 60);
  };

  const rowActs = {
    open: (r) => rowAct('open', r),
    edit: (r) => setFormFor(r.id),
    del: (r) => rowAct('del', r),
    // 「对齐 remote」：没有 key 就没有身份可对，先提示去 CLI 补 key
    remote: (r) => {
      if (!r.key) {
        toast('这个仓库还没有 key —— 先 nx-kv repo key set <id> <key>');
        return;
      }
      setRemoteFor(r);
    },
    // 持续 get（waitgoal）配置弹窗（#145）：保存后刷行数据（绿点/菜单态跟着变）
    getloop: (r) => setGlFor(r),
    // 查看详情：完整文档集弹窗（主篇 / 补充 / reference / 组内，就地编辑）
    // onChanged 回灌仓库数据（descDocs 摘要靠它）
    docs: (r) => setDocsFor({ kind: 'repo', owner: r }),
    // 行内分组 chip = 快捷筛选（再点一次取消）
    filter: (id) => setFilter((f) => (f === id ? '' : id)),
    // 组筛选视图里的「组」勋章：维持当前组筛选（不切换成取消）
    keepFilter: (id) => setFilter(id),
    // 组筛选视图的「自」勋章 = 跳到这个参考仓库（开参考仓库面板并定位到那一行）
    gotoRefRepo: (key) => { setRefRepoFocus(key); setRefOpen(true); },
    // 绑定管理：从开发仓库行进入 —— 勾选哪些参考绑到它所属的组（v4：组内共享）
    bind: (r) => setBindRepoFor(r),
  };

  if (boards === null) {
    return (
      <div className="rp-page">
        <RouteBreadcrumb />
        <div className="muted" style={{ padding: 20 }}>读取中…</div>
        {dialogNode}
      </div>
    );
  }

  return (
    <div className="rp-page">
      {/* 平台头部：标题 + 主操作。
          #145：头部动作编排化（复用 #139/#143 工具区组件）——登记仓库固定主位，
          分组 / 参考仓库 / 导入导出可在「更多 → 自定义工具栏…」里调顺序与显隐。
          #114 统计去交互、#116 去胶囊、#117 用户拍板整行删除——数量本身
          在表格/分组管理里都看得到，头部不再摆一排报数。 */}
      <div className="page-head">
        <div className="title-block">
          <h2>仓库管理</h2>
        </div>
        <div className="acts">
          <ToolActsBar
            kind="repos"
            titles={{
              add: '登记本机开发仓库',
              boards: '分组管理：建组 / 成员 / 组介绍文档',
              refs: '参考仓库面板：克隆 / 绑定 / 同步 / 检查 / 存储根',
              transfer: '布局与仓库的导入导出（逐条选择 / 冲突方案 / 差异检查）',
            }}
            actions={{
              add: () => setFormFor(null),
              boards: () => setBoardAdminOpen(true),
              refs: () => setRefOpen(true),
              transfer: () => setTransferOpen(true),
            }}
          />
        </div>
      </div>

      <PendingSection boards={boards} devRepos={devRepos} refRepos={refRepos} reload={reload} />

      <FiltersBar
        boards={boardList}
        filter={filter}
        onFilter={setFilter}
        devCount={devRepos.length}
        shownCount={shown.length}
        q={q}
        onQ={setQ}
        onOpenDocs={() => setDocOpen(true)}
      />

      <BoardRefs
        filterBoard={filterBoard}
        refRepos={refRepos}
        checkOf={checkOf}
        onOpenDoc={openBoardDoc}
        onAddMember={setImpBoardId}
        onSync={syncOne}
        onOpen={(r) => rowAct('open', r)}
        onLinkNote={openLinkNote}
        onUnbind={unbindOne}
      />

      <RepoTable
        shown={shown}
        devRepos={devRepos}
        filterBoard={filterBoard}
        groupRefRepoCounts={groupRefRepoCounts}
        refRepoChipsByRepo={refRepoChipsByRepo}
        acts={rowActs}
        onAddMember={setImpBoardId}
      />

      {refOpen ? (
        <RefPanel
          refRepos={refRepos}
          devRepos={devRepos}
          boardList={boardList}
          checkOf={checkOf}
          refRepoBackLinks={refRepoBackLinks}
          refBindOpen={refBindOpen}
          onRefBindOpen={setRefBindOpen}
          onClose={() => setRefOpen(false)}
          onSyncOne={syncOne}
          onUnbind={unbindOne}
          onUnbindRepo={unbindRepo}
          onLinkNote={openLinkNote}
          onGoBind={goBindTarget}
          onDocs={rowActs.docs}
          onRowAct={rowAct}
          reload={reload}
        />
      ) : null}

      {docOpen ? (
        <DocSearchModal
          repos={repos}
          boardList={boardList}
          onClose={() => setDocOpen(false)}
          onFilter={setFilter}
          reload={reload}
        />
      ) : null}

      {boardAdminOpen ? (
        <BoardAdminModal
          boardList={boardList}
          unassigned={boards.unassigned}
          onClose={() => setBoardAdminOpen(false)}
          onFilter={setFilter}
          onMembers={setImpBoardId}
          onOpenDoc={openBoardDoc}
          reload={reload}
        />
      ) : null}

      {formFor !== undefined ? (
        <RepoFormModal
          editing={formFor}
          repos={repos}
          onClose={() => setFormFor(undefined)}
          onSaved={reload.all}
        />
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

      {bindRepoFor ? (
        <BindRepoModal
          repo={bindRepoFor}
          refRepos={refRepos}
          boardList={boardList}
          currentRefs={groupRefReposByRepo.get(bindRepoFor.key) || []}
          onClose={() => setBindRepoFor(null)}
          onSaved={reload.all}
        />
      ) : null}

      {linkNoteFor ? (
        <LinkNoteModal
          linkNoteFor={linkNoteFor}
          onClose={() => setLinkNoteFor(null)}
          onSaved={reload.all}
        />
      ) : null}

      {/* 导入导出：全屏覆盖层面板（逐条选择 / 冲突方案 / 差异检查）。
          面板自己调 /api/repos/export 与 /api/repos/import*，执行完通过 onChanged 让本页刷新。 */}
      {transferOpen ? (
        <TransferPanel
          onClose={() => setTransferOpen(false)}
          onChanged={reload.all}
          repos={repos}
          boards={boardList}
        />
      ) : null}

      {/* 持续 get（waitgoal）配置弹窗（#145）：行内「更多 → 持续 get…」；
          保存后刷本页仓库数据（行名绿点 / 菜单态跟着变） */}
      {glFor ? (
        <GetLoopModal
          repo={repos.find((x) => x.id === glFor.id) || glFor}
          onClose={() => setGlFor(null)}
          onSaved={loadRepos}
        />
      ) : null}

      {remoteFor ? (
        <RemoteModal
          repo={remoteFor}
          onClose={() => setRemoteFor(null)}
          onSaved={async () => { await Promise.all([loadRepos(), loadRefCheck()]); }}
        />
      ) : null}

      {/* 查看详情（文档集弹窗）：完整列表 + 复用编辑器就地编辑；
          增删改标签后回灌仓库数据（行内摘要同步更新）。
          model 必须传：弹窗里「更多 → 文字列表」要在工作区开 refs 右侧栏。 */}
      {docsFor ? (
        <DocsModal
          kind={docsFor.kind}
          owner={docsFor.owner}
          model={app.model}
          onClose={() => setDocsFor(null)}
          onChanged={loadRepos}
        />
      ) : null}

      {dialogNode}
    </div>
  );
}
