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
import { LocaltaskBoardTasksAction } from './localtask-boardtasks.js';
import { LocaltaskCancelManyAction } from './localtask-cancel-many.js';
import { LocaltaskCancelAction } from './localtask-cancel.js';
import { LocaltaskChainAction } from './localtask-chain.js';
import { LocaltaskCloneAction } from './localtask-clone.js';
import { LocaltaskCloseManyAction } from './localtask-close-many.js';
import { LocaltaskConfigAction } from './localtask-config.js';
import { LocaltaskDetachAction } from './localtask-detach.js';
import { LocaltaskDoneAction } from './localtask-done.js';
import { LocaltaskEventsAction } from './localtask-events.js';
import { LocaltaskForkAction } from './localtask-fork.js';
import { LocaltaskListAction } from './localtask-list.js';
import { LocaltaskPlanAction } from './localtask-plan.js';
import { LocaltaskPresenceAction } from './localtask-presence.js';
import { LocaltaskPruneAction } from './localtask-prune.js';
import { LocaltaskRemoveManyAction } from './localtask-remove-many.js';
import { LocaltaskRemoveAction } from './localtask-remove.js';
import { LocaltaskReopenAction } from './localtask-reopen.js';
import { LocaltaskReorderAction } from './localtask-reorder.js';
import { LocaltaskShowAction } from './localtask-show.js';
import { LocaltaskTaskRestoreAction } from './localtask-task-restore.js';
import { LocaltaskTasksAction } from './localtask-tasks.js';
import { LocaltaskTimegoalLogAction } from './localtask-timegoal-log.js';
import { LocaltaskTopicAddAction } from './localtask-topic-add.js';
import { LocaltaskTopicRemoveManyAction } from './localtask-topic-remove-many.js';
import { LocaltaskTopicRemoveAction } from './localtask-topic-remove.js';
import { LocaltaskUpdateAction } from './localtask-update.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  LocaltaskAddAction,
  LocaltaskAttachNoteAction,
  LocaltaskAttachAction,
  LocaltaskAttachmentsAction,
  LocaltaskBoardTasksAction,
  LocaltaskCancelManyAction,
  LocaltaskCancelAction,
  LocaltaskChainAction,
  LocaltaskCloneAction,
  LocaltaskCloseManyAction,
  LocaltaskConfigAction,
  LocaltaskDetachAction,
  LocaltaskDoneAction,
  LocaltaskEventsAction,
  LocaltaskForkAction,
  LocaltaskListAction,
  LocaltaskPlanAction,
  LocaltaskPresenceAction,
  LocaltaskPruneAction,
  LocaltaskRemoveManyAction,
  LocaltaskRemoveAction,
  LocaltaskReopenAction,
  LocaltaskReorderAction,
  LocaltaskShowAction,
  LocaltaskTaskRestoreAction,
  LocaltaskTasksAction,
  LocaltaskTimegoalLogAction,
  LocaltaskTopicAddAction,
  LocaltaskTopicRemoveManyAction,
  LocaltaskTopicRemoveAction,
  LocaltaskUpdateAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { LocaltaskAddAction };
export { LocaltaskAttachNoteAction };
export { LocaltaskAttachAction };
export { LocaltaskAttachmentsAction };
export { LocaltaskBoardTasksAction };
export { LocaltaskCancelManyAction };
export { LocaltaskCancelAction };
export { LocaltaskChainAction };
export { LocaltaskCloneAction };
export { LocaltaskCloseManyAction };
export { LocaltaskConfigAction };
export { LocaltaskDetachAction };
export { LocaltaskDoneAction };
export { LocaltaskEventsAction };
export { LocaltaskForkAction };
export { LocaltaskListAction };
export { LocaltaskPlanAction };
export { LocaltaskPresenceAction };
export { LocaltaskPruneAction };
export { LocaltaskRemoveManyAction };
export { LocaltaskRemoveAction };
export { LocaltaskReopenAction };
export { LocaltaskReorderAction };
export { LocaltaskShowAction };
export { LocaltaskTaskRestoreAction };
export { LocaltaskTasksAction };
export { LocaltaskTimegoalLogAction };
export { LocaltaskTopicAddAction };
export { LocaltaskTopicRemoveManyAction };
export { LocaltaskTopicRemoveAction };
export { LocaltaskUpdateAction };
