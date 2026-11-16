// 仓库管理页的派生数据（#143）：从「仓库 / 组 / 分支 / 关键词」算出页面要的几份名单。
//
// 抽出来的原因很实在：这些 useMemo 合起来两百行，全是「从扁平清单推导视图」的纯计算，
// 跟页面装配（弹窗开关、动作、HTML 结构）没有关系；放在页面里会让页面变成 700 行，
// 也让「某份名单怎么来的」淹没在 JSX 之间。
//
// 口径（与验收一致）：
//   · 组 = 分支：main 是全部，每个组是一支，default 是「未分组」这个**虚拟**分支（不落库）；
//   · 每个分支各出三份「原始名单」（仓库 / 参考仓库 / 文档计数），关键词只做收窄；
//   · 仓库的「自己对参考仓库的绑定」与「参考仓库被谁绑」是两张**反向索引**，互不折算。
import { useMemo } from 'react';
import type { BoardRecord, GroupRefChip, RefBackLink, RepoChip, RepoRecord } from './repo-table.js';
import { BRANCH_DEFAULT, BRANCH_MAIN, type BranchOption } from './branch-picker.js';

/** 关键词是否命中这篇文档（标题 / 描述 / 备注）。 */
function docHit(docs: RepoRecord['descDocs'], kw: string): boolean {
  if (!kw || !docs) return false;
  const main = docs.main;
  if (main && [main.title, main.summary, main.desc].some((s) => s && String(s).toLowerCase().includes(kw))) return true;
  return (docs.links || []).some((l) => [l.title, l.desc, l.note].some((s) => s && String(s).toLowerCase().includes(kw)));
}

/**
 * 分支里的仓库名单（纯函数，单测直接用）。
 *
 * 语义：组分支 = 该组成员（present=false 的占位不算，它们由「待初始化」区块处理）；
 * default = 未归组的开发仓库；main = 全部。关键词再收窄（含文档命中）。
 */
export function branchRepoRows(
  allDev: RepoRecord[],
  ungrouped: RepoRecord[],
  board: BoardRecord | null,
  branch: string,
  kw: string
): RepoRecord[] {
  let list: RepoRecord[];
  if (board) {
    const members = new Set((board.repos || []).filter((m) => m.present !== false).map((m) => m.key));
    list = allDev.filter((r) => members.has(r.key));
  } else if (branch === BRANCH_DEFAULT) {
    list = ungrouped;
  } else {
    list = allDev;
  }
  if (!kw) return list;
  return list.filter((r) =>
    [r.name, r.key, r.path, r.desc].some((s) => s && String(s).toLowerCase().includes(kw)) || docHit(r.descDocs, kw));
}

/**
 * 分支里的参考仓库名单：组分支只看这一支绑的；default 不带参考仓库
 * （它只表达「未归组的开发仓库」）；main = 全部。
 */
export function branchRefRows(allRef: RepoRecord[], board: BoardRecord | null, branch: string, kw: string): RepoRecord[] {
  let list: RepoRecord[];
  if (board) {
    const keys = new Set((board.refs || []).map((l) => l.id));
    list = allRef.filter((r) => keys.has(r.key));
  } else if (branch === BRANCH_DEFAULT) {
    list = [];
  } else {
    list = allRef;
  }
  if (!kw) return list;
  return list.filter((r) => [r.name, r.key, r.remote, r.path, r.desc].some((s) => s && String(s).toLowerCase().includes(kw)));
}

/** 分支清单：main → 各组 → default（顺序即下拉里的顺序）。 */
export function branchOptions(
  boardList: BoardRecord[],
  counts: { dev: number; ref: number; ungrouped: number; docs: number | null }
): BranchOption[] {
  const out: BranchOption[] = [{
    id: BRANCH_MAIN,
    name: 'main',
    repoCount: counts.dev,
    refCount: counts.ref,
    docCount: counts.docs || 0,
    virtual: true,
  }];
  for (const b of boardList) {
    out.push({
      id: b.id,
      name: b.name,
      key: b.key || b.id,
      repoCount: (b.repos || []).filter((m) => m.present !== false).length,
      refCount: (b.refs || []).length,
      docCount: Number(b.docCount) || 0,
    });
  }
  out.push({
    id: BRANCH_DEFAULT,
    name: 'default',
    repoCount: counts.ungrouped,
    refCount: 0,
    docCount: 0,
    virtual: true,
  });
  return out;
}

export interface ReposDeriveInput {
  repos: RepoRecord[];
  boardList: BoardRecord[];
  /** 当前分支 id：'main' / 'default' / 组的 id */
  branch: string;
  /** 已 trim + 小写的关键词 */
  kw: string;
  /** main 的文档总数（由文档区块回填；未知时 null） */
  docCount: number | null;
}

export interface ReposDerive {
  devRepos: RepoRecord[];
  refRepos: RepoRecord[];
  branchBoard: BoardRecord | null;
  ungrouped: RepoRecord[];
  branches: BranchOption[];
  groupRefReposByRepo: Map<string, GroupRefChip[]>;
  refRepoChipsByRepo: Map<string, RepoChip[]>;
  refRepoBackLinks: Map<string, RefBackLink[]>;
  repoRows: RepoRecord[];
  refRows: RepoRecord[];
}

export function useReposDerive({ repos, boardList, branch, kw, docCount }: ReposDeriveInput): ReposDerive {
  // 参考仓库（type=ref）与开发仓库（type=dev）：两份名单分开，多对多绑定靠 linked 连接
  const devRepos = useMemo<RepoRecord[]>(() => repos.filter((r) => (r.type || 'dev') !== 'ref'), [repos]);
  const refRepos = useMemo<RepoRecord[]>(() => repos.filter((r) => r.type === 'ref'), [repos]);

  // 当前分支（组）；main / default 是虚拟分支，没有对应行
  const branchBoard = useMemo<BoardRecord | null>(
    () => boardList.find((b) => b.id === branch) || null,
    [boardList, branch]
  );

  // 未归组的开发仓库：default 分支就是这批（「没有组概念的就默认在 default 里」）
  const ungrouped = useMemo<RepoRecord[]>(
    () => devRepos.filter((r) => !(r.boards || []).length),
    [devRepos]
  );

  // 分支清单：main → 各组 → default
  const branches = useMemo<BranchOption[]>(
    () => branchOptions(boardList, { dev: devRepos.length, ref: refRepos.length, ungrouped: ungrouped.length, docs: docCount }),
    [boardList, devRepos.length, refRepos.length, ungrouped.length, docCount]
  );

  // 组级参考：仓库属于哪些组，就能看到这些组上绑定的参考仓库（组内共享，不折算成数量）
  const groupRefReposByRepo = useMemo<Map<string, GroupRefChip[]>>(() => {
    const m = new Map<string, GroupRefChip[]>();
    const byKey = new Map<string, RepoRecord>(refRepos.map((r): [string, RepoRecord] => [r.key, r]));
    for (const b of boardList) {
      const bkey = b.key || `board/${b.name}`;
      for (const rk of (b.repos || []).map((x) => x.key)) {
        for (const l of b.refs || []) {
          const r = byKey.get(l.id);
          if (!r) continue;
          if (!m.has(rk)) m.set(rk, []);
          const arr = m.get(rk);
          if (!arr) continue;
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

  // 仓库表「参考仓库」列 = 这一行仓库**自己直接绑定**的参考仓库（仓库级 ext_linked）
  const refRepoChipsByRepo = useMemo<Map<string, RepoChip[]>>(() => {
    const m = new Map<string, RepoChip[]>();
    const byKey = new Map<string, RepoRecord>(refRepos.map((r): [string, RepoRecord] => [r.key, r]));
    for (const d of devRepos) {
      const own = (d.linked || [])
        .filter((l) => l && l.kind === 'ref')
        .map((l): RepoChip | null => {
          const r = byKey.get(l.id);
          return r ? { key: r.key, name: r.name, note: l.note || '' } : null;
        })
        .filter((c): c is RepoChip => c !== null);
      m.set(d.key, own);
    }
    return m;
  }, [devRepos, refRepos]);

  // 仓库级直接绑定（反向索引）：参考仓库 key → 直接绑在它身上的开发仓库
  const refRepoBackLinks = useMemo<Map<string, RefBackLink[]>>(() => {
    const m = new Map<string, RefBackLink[]>();
    for (const d of devRepos) {
      for (const l of d.linked || []) {
        if (!l || l.kind !== 'ref') continue;
        if (!m.has(l.id)) m.set(l.id, []);
        const arr = m.get(l.id);
        if (arr) arr.push({ repo: d, note: l.note || '' });
      }
    }
    return m;
  }, [devRepos]);

  // 当前分支的两份名单（纯函数算出，hook 只缓存）
  const repoRows = useMemo<RepoRecord[]>(
    () => branchRepoRows(devRepos, ungrouped, branchBoard, branch, kw),
    [devRepos, ungrouped, branchBoard, branch, kw]
  );
  const refRows = useMemo<RepoRecord[]>(
    () => branchRefRows(refRepos, branchBoard, branch, kw),
    [refRepos, branchBoard, branch, kw]
  );

  return {
    devRepos,
    refRepos,
    branchBoard,
    ungrouped,
    branches,
    groupRefReposByRepo,
    refRepoChipsByRepo,
    refRepoBackLinks,
    repoRows,
    refRows,
  };
}
