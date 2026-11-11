// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { BoardAddAction } from './board-add.js';
import { BoardAssignAction } from './board-assign.js';
import { BoardExportAction } from './board-export.js';
import { BoardGetAction } from './board-get.js';
import { BoardImportAction } from './board-import.js';
import { BoardListAction } from './board-list.js';
import { BoardNoteAction } from './board-note.js';
import { BoardPrefixAction } from './board-prefix.js';
import { BoardPruneAction } from './board-prune.js';
import { BoardRekeyAction } from './board-rekey.js';
import { BoardRemoveAction } from './board-remove.js';
import { BoardUpdateAction } from './board-update.js';
import { RepoAddAction } from './repo-add.js';
import { RepoBindTopicsAction } from './repo-bind-topics.js';
import { RepoBindAction } from './repo-bind.js';
import { RepoCloneAction } from './repo-clone.js';
import { RepoDetectAction } from './repo-detect.js';
import { RepoDocAddAction } from './repo-doc-add.js';
import { RepoDocListAction } from './repo-doc-list.js';
import { RepoDocRemoveAction } from './repo-doc-remove.js';
import { RepoExportAction } from './repo-export.js';
import { RepoGetAction } from './repo-get.js';
import { RepoImportDiffAction } from './repo-import-diff.js';
import { RepoImportAction } from './repo-import.js';
import { RepoKeyMigrateAction } from './repo-key-migrate.js';
import { RepoKeyRefreshAction } from './repo-key-refresh.js';
import { RepoKeySetAction } from './repo-key-set.js';
import { RepoKnowledgeAction } from './repo-knowledge.js';
import { RepoListAction } from './repo-list.js';
import { RepoOpenAction } from './repo-open.js';
import { RepoRefAddAction } from './repo-ref-add.js';
import { RepoRefBackfillAction } from './repo-ref-backfill.js';
import { RepoRefCheckAction } from './repo-ref-check.js';
import { RepoRefCloneAction } from './repo-ref-clone.js';
import { RepoRefNoteAction } from './repo-ref-note.js';
import { RepoRefOfAction } from './repo-ref-of.js';
import { RepoRefSyncAction } from './repo-ref-sync.js';
import { RepoRemoteCheckAction } from './repo-remote-check.js';
import { RepoRemoteListAction } from './repo-remote-list.js';
import { RepoRemotePickAction } from './repo-remote-pick.js';
import { RepoRemoteAction } from './repo-remote.js';
import { RepoRemoveAction } from './repo-remove.js';
import { RepoScanAction } from './repo-scan.js';
import { RepoUpdateAction } from './repo-update.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  BoardAddAction,
  BoardAssignAction,
  BoardExportAction,
  BoardGetAction,
  BoardImportAction,
  BoardListAction,
  BoardNoteAction,
  BoardPrefixAction,
  BoardPruneAction,
  BoardRekeyAction,
  BoardRemoveAction,
  BoardUpdateAction,
  RepoAddAction,
  RepoBindTopicsAction,
  RepoBindAction,
  RepoCloneAction,
  RepoDetectAction,
  RepoDocAddAction,
  RepoDocListAction,
  RepoDocRemoveAction,
  RepoExportAction,
  RepoGetAction,
  RepoImportDiffAction,
  RepoImportAction,
  RepoKeyMigrateAction,
  RepoKeyRefreshAction,
  RepoKeySetAction,
  RepoKnowledgeAction,
  RepoListAction,
  RepoOpenAction,
  RepoRefAddAction,
  RepoRefBackfillAction,
  RepoRefCheckAction,
  RepoRefCloneAction,
  RepoRefNoteAction,
  RepoRefOfAction,
  RepoRefSyncAction,
  RepoRemoteCheckAction,
  RepoRemoteListAction,
  RepoRemotePickAction,
  RepoRemoteAction,
  RepoRemoveAction,
  RepoScanAction,
  RepoUpdateAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { BoardAddAction };
export { BoardAssignAction };
export { BoardExportAction };
export { BoardGetAction };
export { BoardImportAction };
export { BoardListAction };
export { BoardNoteAction };
export { BoardPrefixAction };
export { BoardPruneAction };
export { BoardRekeyAction };
export { BoardRemoveAction };
export { BoardUpdateAction };
export { RepoAddAction };
export { RepoBindTopicsAction };
export { RepoBindAction };
export { RepoCloneAction };
export { RepoDetectAction };
export { RepoDocAddAction };
export { RepoDocListAction };
export { RepoDocRemoveAction };
export { RepoExportAction };
export { RepoGetAction };
export { RepoImportDiffAction };
export { RepoImportAction };
export { RepoKeyMigrateAction };
export { RepoKeyRefreshAction };
export { RepoKeySetAction };
export { RepoKnowledgeAction };
export { RepoListAction };
export { RepoOpenAction };
export { RepoRefAddAction };
export { RepoRefBackfillAction };
export { RepoRefCheckAction };
export { RepoRefCloneAction };
export { RepoRefNoteAction };
export { RepoRefOfAction };
export { RepoRefSyncAction };
export { RepoRemoteCheckAction };
export { RepoRemoteListAction };
export { RepoRemotePickAction };
export { RepoRemoteAction };
export { RepoRemoveAction };
export { RepoScanAction };
export { RepoUpdateAction };
