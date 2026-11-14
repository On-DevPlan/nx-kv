// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { LocaltaskAddAction } from './localtask-add.js';
import { LocaltaskAttachNoteAction } from './localtask-attach-note.js';
import { LocaltaskAttachAction } from './localtask-attach.js';
import { LocaltaskAttachmentsAction } from './localtask-attachments.js';
import { LocaltaskCancelAction } from './localtask-cancel.js';
import { LocaltaskCancelManyAction } from './localtask-cancelMany.js';
import { LocaltaskChainAction } from './localtask-chain.js';
import { LocaltaskClaimAction } from './localtask-claim.js';
import { LocaltaskCloneAction } from './localtask-clone.js';
import { LocaltaskCloseManyAction } from './localtask-closeMany.js';
import { LocaltaskConfigAction } from './localtask-config.js';
import { LocaltaskDetachAction } from './localtask-detach.js';
import { LocaltaskDoneAction } from './localtask-done.js';
import { LocaltaskEventsAction } from './localtask-events.js';
import { LocaltaskForkAction } from './localtask-fork.js';
import { LocaltaskGetAction } from './localtask-get.js';
import { LocaltaskListAction } from './localtask-list.js';
import { LocaltaskPlanAction } from './localtask-plan.js';
import { LocaltaskPresenceAction } from './localtask-presence.js';
import { LocaltaskPreviewAction } from './localtask-preview.js';
import { LocaltaskPruneAction } from './localtask-prune.js';
import { LocaltaskRemoveAction } from './localtask-remove.js';
import { LocaltaskRemoveManyAction } from './localtask-removeMany.js';
import { LocaltaskReopenAction } from './localtask-reopen.js';
import { LocaltaskReorderAction } from './localtask-reorder.js';
import { LocaltaskTaskRestoreAction } from './localtask-task-restore.js';
import { LocaltaskTasksAction } from './localtask-tasks.js';
import { LocaltaskTimegoalLogAction } from './localtask-timegoalLog.js';
import { LocaltaskTopicAddAction } from './localtask-topic-add.js';
import { LocaltaskTopicRemoveAction } from './localtask-topic-remove.js';
import { LocaltaskTopicRemoveManyAction } from './localtask-topic-removeMany.js';
import { LocaltaskUpdateAction } from './localtask-update.js';
import { LocaltaskWaitAction } from './localtask-wait.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  LocaltaskAddAction,
  LocaltaskAttachNoteAction,
  LocaltaskAttachAction,
  LocaltaskAttachmentsAction,
  LocaltaskCancelAction,
  LocaltaskCancelManyAction,
  LocaltaskChainAction,
  LocaltaskClaimAction,
  LocaltaskCloneAction,
  LocaltaskCloseManyAction,
  LocaltaskConfigAction,
  LocaltaskDetachAction,
  LocaltaskDoneAction,
  LocaltaskEventsAction,
  LocaltaskForkAction,
  LocaltaskGetAction,
  LocaltaskListAction,
  LocaltaskPlanAction,
  LocaltaskPresenceAction,
  LocaltaskPreviewAction,
  LocaltaskPruneAction,
  LocaltaskRemoveAction,
  LocaltaskRemoveManyAction,
  LocaltaskReopenAction,
  LocaltaskReorderAction,
  LocaltaskTaskRestoreAction,
  LocaltaskTasksAction,
  LocaltaskTimegoalLogAction,
  LocaltaskTopicAddAction,
  LocaltaskTopicRemoveAction,
  LocaltaskTopicRemoveManyAction,
  LocaltaskUpdateAction,
  LocaltaskWaitAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { LocaltaskAddAction };
export { LocaltaskAttachNoteAction };
export { LocaltaskAttachAction };
export { LocaltaskAttachmentsAction };
export { LocaltaskCancelAction };
export { LocaltaskCancelManyAction };
export { LocaltaskChainAction };
export { LocaltaskClaimAction };
export { LocaltaskCloneAction };
export { LocaltaskCloseManyAction };
export { LocaltaskConfigAction };
export { LocaltaskDetachAction };
export { LocaltaskDoneAction };
export { LocaltaskEventsAction };
export { LocaltaskForkAction };
export { LocaltaskGetAction };
export { LocaltaskListAction };
export { LocaltaskPlanAction };
export { LocaltaskPresenceAction };
export { LocaltaskPreviewAction };
export { LocaltaskPruneAction };
export { LocaltaskRemoveAction };
export { LocaltaskRemoveManyAction };
export { LocaltaskReopenAction };
export { LocaltaskReorderAction };
export { LocaltaskTaskRestoreAction };
export { LocaltaskTasksAction };
export { LocaltaskTimegoalLogAction };
export { LocaltaskTopicAddAction };
export { LocaltaskTopicRemoveAction };
export { LocaltaskTopicRemoveManyAction };
export { LocaltaskUpdateAction };
export { LocaltaskWaitAction };
