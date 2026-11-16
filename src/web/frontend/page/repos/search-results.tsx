// 全局检索结果（#146）：有关键词时把**三块**（仓库 / 参考仓库 / 文档）同屏分段列出。
//
// 为什么不复用「当前区块」那一块：用户口径是「搜索结果可以包含所有的结果」——
// 只在当前区块里搜，等于要人挨个点 tab 才知道别处有没有命中。所以检索一旦有词，
// 区块按钮让位给结果页：上一条统计（仓库 N · 参考仓库 M · 文档 K），下面三段，
// 每段一张和平时一样的表（同样的行、同样的动作，不另造只读视图）。
import RepoTable from './repo-table.jsx';
import RefBlock from './ref-block.jsx';
import DocBlock from './doc-block.jsx';
import type { BoardRecord, RefBackLink, RefCheckMap, RepoActs, RepoChip, RepoRecord } from './repo-table.js';

export default function SearchResults({
  kw, q, repoRows, refRows, docShown, mode, branchBoard, boardList, repos, devRepos,
  refRepoChipsByRepo, refRepoBackLinks, checkOf, docTick, acts,
  onClear, onDocShown, onDocCount, onSync, onOpenRepo, onOpenDocs, onBindRef, onUnbindGroup,
  onUnbindRepo, onGoBind, onManageRefs, onAddMember, onGoHost,
}: {
  kw: string;
  q: string;
  repoRows: RepoRecord[];
  refRows: RepoRecord[];
  docShown: number;
  mode: 'main' | 'group' | 'default';
  branchBoard: BoardRecord | null;
  boardList: BoardRecord[];
  repos: RepoRecord[];
  devRepos: RepoRecord[];
  refRepoChipsByRepo: Map<string, RepoChip[]>;
  refRepoBackLinks: Map<string, RefBackLink[]>;
  checkOf: RefCheckMap;
  docTick: number;
  acts: RepoActs;
  onClear: () => void;
  onDocShown: (n: number) => void;
  onDocCount: (n: number) => void;
  onSync: (r: RepoRecord) => void;
  onOpenRepo: (r: RepoRecord) => void;
  onOpenDocs: (r: RepoRecord) => void;
  onBindRef: (r: RepoRecord) => void;
  onUnbindGroup: (ref: RepoRecord, groupId: string) => void;
  onUnbindRepo: (ref: RepoRecord, repoKey: string) => void;
  onGoBind: (kind: string, target: string) => void;
  onManageRefs: () => void;
  onAddMember: (boardId: string) => void;
  onGoHost: (kind: 'repo' | 'group', target: string) => void;
}) {
  const total = repoRows.length + refRows.length + docShown;
  return (
    <div className="rp-sr">
      <div className="rp-sr-head">
        <span>搜索结果</span>
        <span className="rp-sr-counts">
          仓库 {repoRows.length} · 参考仓库 {refRows.length} · 文档 {docShown}
        </span>
        <button type="button" className="rp-sr-clear" onClick={onClear}>清除检索</button>
      </div>

      {!total ? (
        <div className="rp-block-empty">
          <div className="rp-block-empty-t">没有匹配「{kw}」的结果</div>
          <div className="rp-block-empty-d">换个关键词，或清除检索回到正常视图。</div>
        </div>
      ) : null}

      {repoRows.length ? (
        <>
          <div className="rp-sr-sec">仓库 {repoRows.length}</div>
          <RepoTable
            shown={repoRows}
            devRepos={devRepos}
            mode={mode}
            filterBoard={branchBoard}
            refRepoChipsByRepo={refRepoChipsByRepo}
            acts={acts}
            onAddMember={onAddMember}
          />
        </>
      ) : null}

      {refRows.length ? (
        <>
          <div className="rp-sr-sec">参考仓库 {refRows.length}</div>
          <RefBlock
            rows={refRows}
            mode={mode}
            group={branchBoard}
            boardList={boardList}
            refRepoBackLinks={refRepoBackLinks}
            checkOf={checkOf}
            onSync={onSync}
            onOpen={onOpenRepo}
            onDocs={onOpenDocs}
            onBind={onBindRef}
            onUnbindGroup={onUnbindGroup}
            onUnbindRepo={onUnbindRepo}
            onGoBind={onGoBind}
            onManage={onManageRefs}
          />
        </>
      ) : null}

      <div className="rp-sr-sec">文档 {docShown}</div>
      <DocBlock
        repos={repos}
        boardList={boardList}
        q={q}
        tick={docTick}
        onGoHost={onGoHost}
        onCount={onDocCount}
        onShown={onDocShown}
      />
    </div>
  );
}
