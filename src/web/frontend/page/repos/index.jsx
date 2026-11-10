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
  // 绑定描述编辑：{ ref, kind:'repo'|'board', targetId, targetName } | null
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
    (refCheck?.refs || []).forEach((x) => m.set(x.id, x));
    return m;
  }, [refCheck]);

  // ---- 跨区块共享动作 ----

  const syncOne = (r) => guard(async () => {
    const d = await api('/api/repos/ref/sync', { method: 'POST', body: { id: r.id } });
    toast(d.status === 'updated' ? `已更新: ${d.name}` : d.status === 'upToDate' ? `${d.name} 已是最新` : `${d.name}: ${d.status} ${d.output || ''}`);
  });

  // 从某条绑定摘除单个目标（chip 上的 ×）
  const unbindOne = (ref, kind, targetId) => guard(async () => {
    await api('/api/repos/bind', { method: 'POST', body: { id: ref.key, [kind]: [targetId], remove: true } });
    await Promise.all([loadRepos(), loadRefCheck()]);
  });

  // 绑定描述：从 dev 行的参考 chip、看板参考区块或参考面板的绑定 chip 进入
  const openLinkNote = (ref, kind, targetId, targetName) => {
    setLinkNoteFor({ ref, kind, targetId, targetName });
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
    // 绑定管理：从开发仓库行进入 —— 勾选哪些参考绑到它身上（多对多的 dev 侧视角）
    bind: (r) => setBindRepoFor(r),
    refNote: (ref, devRepo) => {
      const full = refRepos.find((x) => x.key === ref.key);
      if (full) openLinkNote(full, 'repo', devRepo.key, devRepo.name);
    },
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
        refRepos={refRepos}
        filterBoard={filterBoard}
        acts={rowActs}
        onAddMember={setImpBoardId}
      />

      {refOpen ? (
        <RefPanel
          refRepos={refRepos}
          devRepos={devRepos}
          boardList={boardList}
          checkOf={checkOf}
          onClose={() => setRefOpen(false)}
          onSyncOne={syncOne}
          onUnbind={unbindOne}
          onLinkNote={openLinkNote}
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
          onClose={() => setBindRepoFor(null)}
          onSaved={async () => { await Promise.all([loadRepos(), loadRefCheck()]); }}
        />
      ) : null}

      {linkNoteFor ? (
        <LinkNoteModal
          linkNoteFor={linkNoteFor}
          onClose={() => setLinkNoteFor(null)}
          onSaved={async () => { await Promise.all([loadRepos(), loadRefCheck()]); }}
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
