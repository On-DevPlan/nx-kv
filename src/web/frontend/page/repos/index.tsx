// 仓库管理页（#143 重构）：**组 = 分支**，页面按「分支 × 区块」组织。
//
// 用户口径（验收原文）：
//   · 「完全把 group 作为分支概念，然后原生本地开发 repo 作为主分支，然后其他 group
//      都作为分支概念」——组不再是一个筛选条件，而是与 main 并列的一条分支；
//   · 「本地原生开发 repo 不需要显示绑定分组了 完全把分组作为命名空间使用」——
//      所以表里**没有分组列**，仓库属于哪些组由「切到那个分支能看见它」表达；
//   · 「把参考仓库和文档全部融合进，就是在主分支当中就是全部的意思」——
//      main 有三块：仓库 / 参考仓库 / 文档（全部文档，含没归属的孤儿 ref）；
//   · 「在具体的组当中，文档这个勋章……直接切换到文档列表即可」——组里没有文档区块，
//      右侧一个「文档 N」按钮直接打开右侧栏的组文档列表；
//   · 「没有组概念的 就默认是一个 default 组里面」——default 是**前端虚拟分支**，
//      不落库（点它就是「未分组」这个视图）。
//
// 版面：头部（标题 + 分支下拉 + 工具动作条）→ 分支信息条 → 区块切换条（含搜索）→ 当前区块。
// 视图区块按职责拆在同目录兄弟文件里，本文件只留数据面、共享动作与拼装：
//   branch-picker（分支下拉）/ block-tabs（区块按钮 + 搜索）/ repo-table（仓库表）/
//   ref-block（参考仓库表）/ doc-block（全部文档表）/ pending-section（待初始化）/
//   ref-panel（参考仓库管理面板）/ board-admin（分组管理）/ repo-form-modal（登记编辑）/
//   bind-modals（绑定）/ remote-modal（对齐 remote）。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bindRef, fetchRefCheck, listBoards, listDocs, listRepos, openRepo, refSync, removeRepo, type RefCheckPayload } from './api.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import MemberPicker from '../../components/board/member-picker.jsx';
import TransferPanel from '../../components/repos/transfer-panel.jsx';
import GetLoopModal from '../../components/repos/get-loop-modal.jsx';
import ToolActsBar from '../../components/tool-acts/bar.jsx';
import { openPanel } from '../../workspace.js';
import { useApp } from '../../app-context.jsx';
import RepoTable from './repo-table.jsx';
import { useReposDerive } from './use-repos-derive.js';
import type {
  BoardRecord,
  BoardsPayload,
  RefCheckMap,
  RefCheckRow,
  RepoActs,
  RepoRecord,
  ReposReload,
} from './repo-table.js';
import BranchPicker, { BRANCH_DEFAULT, BRANCH_MAIN } from './branch-picker.jsx';
import BlockTabs, { type BlockTab } from './block-tabs.jsx';
import RefBlock from './ref-block.jsx';
import DocBlock from './doc-block.jsx';
import PendingSection from './pending-section.jsx';
import RefPanel from './ref-panel.jsx';
import BoardAdminModal from './board-admin.jsx';
import RepoFormModal from './repo-form-modal.jsx';
import BindRepoModal from './bind-modals.jsx';
import RemoteModal from './remote-modal.jsx';
import { IconBranch, IconDoc, IconDocs, IconRefRepo, IconRepo, IconSync } from './icons.jsx';

/** 一块的内容：仓库 / 参考仓库 / 文档（组分支里没有 docs）。 */
type BlockId = 'repos' | 'refs' | 'docs';

export default function ReposView() {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const app = useApp();

  // 文档总数（分支下拉 / 文档区块按钮都读它）与「外部写了文档」的刷新计数——
  // 特意放在数据面之前：loadDocCount 的 effect 依赖 docTick，声明顺序反了会 TDZ。
  const [docCount, setDocCount] = useState<number | null>(null);
  const [docTick, setDocTick] = useState(0);

  // ---- 数据面：仓库中心清单（扁平；每条带 boards）+ 看板 + 参考检查 ----
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [boards, setBoards] = useState<BoardsPayload | null>(null); // { boards: [...], unassigned: [...] }
  const [refCheck, setRefCheck] = useState<RefCheckPayload | null>(null);
  const loadRepos = useCallback(async () => {
    setRepos((await listRepos().catch(() => [])) || []);
  }, []);
  const loadBoards = useCallback(async () => {
    setBoards(await listBoards().catch(() => null));
  }, []);
  const loadRefCheck = useCallback(async () => {
    setRefCheck(await fetchRefCheck().catch(() => null));
  }, []);
  // 文档总数：分支下拉与「文档」区块按钮都要它，且在仓库区块里也看得见——
  // 所以单独取一次（不等文档区块挂载；它挂载后还会再回填同一份数）。
  const loadDocCount = useCallback(async () => {
    const d = await listDocs().catch(() => null);
    setDocCount(d && Array.isArray(d.docs) ? d.docs.length : null);
  }, []);
  useEffect(() => { loadRepos(); loadBoards(); loadRefCheck(); }, [loadRepos, loadBoards, loadRefCheck]);
  useEffect(() => { loadDocCount(); }, [loadDocCount, docTick]);

  const reload = useMemo<ReposReload>(() => ({
    repos: loadRepos,
    boards: loadBoards,
    refCheck: loadRefCheck,
    all: async () => { await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]); },
  }), [loadRepos, loadBoards, loadRefCheck]);

  // ---- 视图状态：分支 + 区块 + 检索 ----
  // branch：'main'（全部）/ 'default'（未分组）/ 组的 id。组是分支，不再是筛选条件。
  const [branch, setBranch] = useState<string>(BRANCH_MAIN);
  const [block, setBlock] = useState<BlockId>('repos');
  const [q, setQ] = useState('');

  // ---- 弹窗开关（打开即挂载对应自包含组件，关掉即卸载） ----
  const [formFor, setFormFor] = useState<string | null | undefined>(undefined); // undefined=关 | null=新建 | 仓库 id=编辑
  const [boardAdminOpen, setBoardAdminOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [refRepoFocus, setRefRepoFocus] = useState('');
  const [refBindOpen, setRefBindOpen] = useState<Record<string, boolean>>({});
  const [impBoardId, setImpBoardId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [glFor, setGlFor] = useState<RepoRecord | null>(null);
  const [remoteFor, setRemoteFor] = useState<RepoRecord | null>(null);
  const [bindRepoFor, setBindRepoFor] = useState<RepoRecord | null>(null);

  // 从别处跳进来的定位：#/repos?board=<组id>&add=1
  useEffect(() => {
    const applyHash = () => {
      const s = location.hash.split('?')[1] || '';
      if (!s) return;
      const params = new URLSearchParams(s);
      const bid = params.get('board');
      if (!bid) return;
      setBranch(bid);
      setBlock('repos');
      if (params.get('add')) setImpBoardId(bid);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  // 看板清单（做分支下拉、绑定弹窗的勾选列表）
  const boardList = useMemo<BoardRecord[]>(() => (boards && boards.boards) || [], [boards]);

  // 派生名单（仓库 / 参考仓库 / 分支 / 两张反向索引）都在 use-repos-derive 里，
  // 这里只拿结果——页面本体留给「装配」。
  const kw = q.trim().toLowerCase();
  const {
    devRepos, refRepos, branchBoard, branches,
    groupRefReposByRepo, refRepoChipsByRepo, refRepoBackLinks, repoRows, refRows,
  } = useReposDerive({ repos, boardList, branch, kw, docCount });

  // 参考仓库检查结果：refId → { ok, issues }（行首状态点的数据面）
  const checkOf = useMemo<RefCheckMap>(() => {
    const m = new Map<string, RefCheckRow>();
    (refCheck?.refRepos || []).forEach((x) => m.set(x.id, x));
    return m;
  }, [refCheck]);

  // 成员管理弹窗的目标看板
  const impBoard = useMemo<BoardRecord | null>(
    () => boardList.find((b) => b.id === impBoardId) || null,
    [boardList, impBoardId]
  );

  // 参考面板里的「自」勋章点过来 → 打开面板并滚到那一行（等面板挂载一帧再找）
  useEffect(() => {
    if (!refOpen || !refRepoFocus) return undefined;
    let el: HTMLElement | null = null;
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      el = document.getElementById('rp-refrepo-row-' + refRepoFocus);
      if (!el) return;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('rp-row-flash');
      timer = window.setTimeout(() => el?.classList.remove('rp-row-flash'), 1600);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      if (el) el.classList.remove('rp-row-flash');
    };
  }, [refOpen, refRepoFocus]);

  // ---- 跨区块共享动作 ----

  const syncOne = (r: RepoRecord) => guard(async () => {
    const d = await refSync({ id: r.id });
    toast(d.status === 'updated' ? `已更新: ${d.name}` : d.status === 'upToDate' ? `${d.name} 已是最新` : `${d.name}: ${d.status} ${d.output || ''}`);
  });

  // 从某个组摘除这条参考绑定（只摘组级，不动仓库级）
  const unbindOne = (ref: RepoRecord, groupId: string) => guard(async () => {
    await bindRef({ id: ref.key, board: [groupId], remove: true });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // 从某个开发仓库摘除这条参考绑定（只摘仓库级，不影响组级）
  const unbindRepo = (ref: RepoRecord, repoKey: string) => guard(async () => {
    await bindRef({ id: ref.key, repo: [repoKey], remove: true });
    await Promise.all([loadRepos(), loadBoards(), loadRefCheck()]);
  });

  // 开发仓库从当前分支摘除（只摘这一支的归属，仓库本体与其它分支不动）
  const unbindBoardOfRepo = (r: RepoRecord, groupId: string) => guard(async () => {
    await bindRef({ id: r.key, board: [groupId], remove: true });
    await Promise.all([loadRepos(), loadBoards()]);
  });

  // 参考仓库的**文档**：和开发仓库完全同构——右侧栏开「<名字> · 文档列表」
  const openRepoDocs = (r: RepoRecord) => {
    const m = app.model;
    if (!m) {
      toast('工作区不可用，无法打开文档列表');
      return;
    }
    openPanel(m, {
      component: 'refs',
      name: '文档列表',
      config: { repoKey: r.key || '', repoName: r.name || '', scope: 'repo' },
      location: 'right',
    });
  };

  /** 打开某个组的文档列表（右侧栏）——组分支里「文档」这一块的唯一出口 */
  const openBoardDoc = (b: BoardRecord, silent = false) => {
    const m = app.model;
    if (!m) {
      toast('工作区不可用，无法打开文档列表');
      return;
    }
    openPanel(m, {
      component: 'refs',
      name: '文档列表',
      config: { boardKey: b.key || b.id || '', boardName: b.name || '', scope: 'all' },
      location: 'right',
    });
    if (!silent) toast(`「${b.name}」的文档在右侧「文档列表」里`);
  };

  const rowAct = (act: string, r: RepoRecord) => guard(async () => {
    if (act === 'open') {
      await openRepo({ id: r.id });
    } else if (act === 'del') {
      const ok = await dialog({
        message: `删除仓库登记「${r.name}」？（仅移除登记，磁盘文件不受影响；各分支里的归属同步摘除）`,
        danger: true,
      });
      if (!ok) return;
      await removeRepo(encodeURIComponent(r.id));
      await reload.all();
      setDocTick((n) => n + 1);
    }
  });

  // 区块跳转：面板内容挂在 FlexLayout 的 tab 里（.flexlayout__tab_moveable 才是
  // 真正的滚动容器），scrollIntoView 在这条链上实测无效，必须手动算 scrollTop。
  const scrollPageTo = (el: HTMLElement | null, where = 'start') => {
    if (!el) return;
    let box: Element | null = el.parentElement;
    while (box) {
      const st = getComputedStyle(box);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    if (!box) box = document.scrollingElement || document.documentElement;
    const base = box.getBoundingClientRect ? box.getBoundingClientRect().top : 0;
    const offset = el.getBoundingClientRect().top - base;
    const pad = where === 'center' ? (box.clientHeight - el.offsetHeight) / 2 : 12;
    box.scrollTop = Math.max(0, box.scrollTop + offset - pad);
  };

  /** 文档归属徽章点击 = 跳到宿主：组 → 切到那个分支；仓库 → 切到它所在的分支并闪一下那行 */
  const goHost = (kind: 'repo' | 'group', target: string) => {
    if (kind === 'group') {
      const b = boardList.find((x) => x.key === target || x.id === target);
      if (!b) { toast('这个组已经不存在了'); return; }
      setBranch(b.id);
      setBlock('repos');
      setQ('');
      return;
    }
    const row = devRepos.find((r) => r.key === target) || refRepos.find((r) => r.key === target);
    if (!row) { toast('这个仓库已经不在登记里了'); return; }
    const inBranch = branchBoard ? (branchBoard.repos || []).some((m) => m.key === target) : true;
    if (!inBranch) {
      const first = (row.boards || [])[0];
      setBranch(first ? first.id : BRANCH_MAIN);
    }
    setBlock(row.type === 'ref' ? 'refs' : 'repos');
    setQ('');
    window.setTimeout(() => {
      const el = document.getElementById('rp-row-' + target) || document.getElementById('rp-refrepo-row-' + target);
      if (!el) return;
      scrollPageTo(el, 'center');
      el.classList.add('rp-row-flash');
      window.setTimeout(() => el.classList.remove('rp-row-flash'), 1400);
    }, 60);
  };

  const rowActs: RepoActs = {
    open: (r) => rowAct('open', r),
    edit: (r) => setFormFor(r.id),
    del: (r) => rowAct('del', r),
    remote: (r) => {
      if (!r.key) {
        toast('这个仓库还没有 key —— 先 nx-kv repo key set <id> <key>');
        return;
      }
      setRemoteFor(r);
    },
    getloop: (r) => setGlFor(r),
    docs: (r) => openRepoDocs(r),
    filter: (id) => setBranch(id),
    gotoRefRepo: (key) => { setRefRepoFocus(key); setRefOpen(true); },
    bind: (r) => setBindRepoFor(r),
    unbindBoard: unbindBoardOfRepo,
  };

  // ---- 区块按钮（组分支没有文档区块：改成右侧一个「文档 N →」按钮） ----
  const tabs: BlockTab[] = [
    { id: 'repos', label: '仓库', count: repoRows.length, icon: <IconRepo size={14} />, tip: '开发仓库（本机 git 目录）' },
    { id: 'refs', label: '参考仓库', count: refRows.length, icon: <IconRefRepo size={14} />, tip: '拿来做参考的本机代码' },
  ];
  if (branch === BRANCH_MAIN) {
    tabs.push({
      id: 'docs',
      label: '文档',
      count: docCount === null ? 0 : docCount,
      icon: <IconDocs size={14} />,
      tip: '全部文档（含没有归属的 ref）——组的文档在右侧栏按宿主看',
    });
  }

  // 切到组 / default 分支时，文档区块不存在 → 落回「仓库」区块
  const currentBlock: BlockId = branch !== BRANCH_MAIN && block === 'docs' ? 'repos' : block;

  const searchHint = currentBlock === 'docs'
    ? '按标题 / 描述 / 摘要筛选…'
    : currentBlock === 'refs'
      ? '按名称 / 远程地址筛选…'
      : '按名称 / 路径 / 文档筛选…';

  if (boards === null) {
    return (
      <div className="rp-page rp-v2">
        <RouteBreadcrumb />
        <div className="muted" style={{ padding: 20 }}>读取中…</div>
        {dialogNode}
      </div>
    );
  }

  return (
    <div className="rp-page rp-v2">
      {/* 头部：标题 + 分支下拉 + 工具动作条。
          分支摆在标题右侧（不是筛选条里）——它是「我在哪个分支看东西」这个全局维度。 */}
      <div className="page-head rp-head">
        <div className="title-block">
          <h2>仓库管理</h2>
          <BranchPicker branches={branches} value={branch}
            onChange={(id) => { setBranch(id); setQ(''); }} />
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

      {/* 分支信息条：这一支是什么、有多少东西；组分支额外给「文档在右侧」的出口 */}
      <div className={'rp-branchbar' + (branchBoard ? ' is-group' : '')}>
        <span className="rp-branchbar-ico">
          {branchBoard ? <IconBranch size={14} /> : <IconRepo size={14} />}
        </span>
        <span className="rp-branchbar-name">{branchBoard ? branchBoard.name : branch === BRANCH_DEFAULT ? 'default' : 'main'}</span>
        <span className="rp-branchbar-desc">
          {branchBoard
            ? '项目组 = 命名空间：这一支里的仓库同时也在 main 里'
            : branch === BRANCH_DEFAULT
              ? '没有归组的仓库都落在这里（虚拟分支，不落库）'
              : '全部仓库 / 参考仓库 / 文档'}
        </span>
        <span className="rp-branchbar-nums">
          <span>{repoRows.length} 仓库</span>
          <span className="rp-dot-sep" />
          <span>{refRows.length} 参考</span>
          {branch === BRANCH_MAIN ? <><span className="rp-dot-sep" /><span>{docCount === null ? '…' : docCount} 文档</span></> : null}
        </span>
        <span className="rp-branchbar-acts">
          {branchBoard ? (
            <>
              <button type="button" className="rp-branchbar-btn" title="往这个分支里加仓库"
                onClick={() => setImpBoardId(branchBoard.id)}>添加成员</button>
              <button type="button" className="rp-branchbar-btn accent" title="组的文档收敛在右侧栏的文档列表里"
                onClick={() => openBoardDoc(branchBoard)}>
                <IconDoc size={13} /> 文档 {Number(branchBoard.docCount) || 0} →
              </button>
            </>
          ) : (
            <button type="button" className="rp-branchbar-btn" title="重新检查参考仓库的状态"
              onClick={() => { loadRefCheck(); toast('已刷新检查结果'); }}>
              <IconSync size={13} /> 刷新状态
            </button>
          )}
        </span>
      </div>

      <BlockTabs
        tabs={tabs}
        value={currentBlock}
        onChange={(id) => setBlock(id as BlockId)}
        q={q}
        onQ={setQ}
        placeholder={searchHint}
        right={branchBoard ? (
          <button type="button" className="rp-block-doclink" title="组的文档在右侧「文档列表」里"
            onClick={() => openBoardDoc(branchBoard)}>
            <IconDoc size={13} /> 组文档在右侧
          </button>
        ) : null}
      />

      {/* 待初始化占位：只在组分支里出现（导入布局带进来的空位） */}
      {branchBoard ? (
        <PendingSection
          boards={{ boards: [branchBoard], unassigned: [] }}
          devRepos={devRepos}
          refRepos={refRepos}
          reload={reload}
        />
      ) : null}

      {currentBlock === 'docs' ? (
        <DocBlock
          repos={repos}
          boardList={boardList}
          q={q}
          tick={docTick}
          onGoHost={goHost}
          onCount={setDocCount}
        />
      ) : currentBlock === 'refs' ? (
        <RefBlock
          rows={refRows}
          mode={branchBoard ? 'group' : branch === BRANCH_DEFAULT ? 'default' : 'main'}
          group={branchBoard}
          boardList={boardList}
          refRepoBackLinks={refRepoBackLinks}
          checkOf={checkOf}
          onSync={syncOne}
          onOpen={(r) => rowAct('open', r)}
          onDocs={(r) => openRepoDocs(r)}
          onBind={(r) => { setRefRepoFocus(r.key); setRefOpen(true); }}
          onUnbindGroup={unbindOne}
          onUnbindRepo={unbindRepo}
          onGoBind={(kind, target) => goHost(kind === 'board' ? 'group' : 'repo', target)}
          onManage={() => setRefOpen(true)}
        />
      ) : (
        <RepoTable
          shown={repoRows}
          devRepos={devRepos}
          mode={branchBoard ? 'group' : branch === BRANCH_DEFAULT ? 'default' : 'main'}
          filterBoard={branchBoard}
          refRepoChipsByRepo={refRepoChipsByRepo}
          acts={rowActs}
          onAddMember={setImpBoardId}
        />
      )}

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
          onGoBind={(kind, target) => { setRefOpen(false); setTimeout(() => goHost(kind === 'board' ? 'group' : 'repo', target), 60); }}
          onDocs={(r) => openRepoDocs(r)}
          onRowAct={rowAct}
          reload={reload}
        />
      ) : null}

      {boardAdminOpen ? (
        <BoardAdminModal
          boardList={boardList}
          unassigned={boards.unassigned}
          onClose={() => setBoardAdminOpen(false)}
          onFilter={(id) => { setBranch(id); setBlock('repos'); }}
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

      {impBoard ? (
        <MemberPicker
          board={impBoard}
          boards={boardList as unknown as never[]}
          repos={repos as unknown as never[]}
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
          onSaved={() => { reload.all(); setDocTick((n) => n + 1); }}
        />
      ) : null}

      {transferOpen ? (
        <TransferPanel
          onClose={() => setTransferOpen(false)}
          onChanged={reload.all}
          repos={repos}
          boards={boardList}
        />
      ) : null}

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

      {dialogNode}
    </div>
  );
}
