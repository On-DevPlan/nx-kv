// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { GroupAddAction } from './group-add.js';
import { GroupCurrentAction } from './group-current.js';
import { GroupGetAction } from './group-get.js';
import { GroupListAction } from './group-list.js';
import { GroupMembersAction } from './group-members.js';
import { GroupRemoveAction } from './group-remove.js';
import { GroupUpdateAction } from './group-update.js';
import { GroupUseAction } from './group-use.js';
import { PromptGetAction } from './prompt-get.js';
import { PromptRemoveAction } from './prompt-remove.js';
import { PromptSetAction } from './prompt-set.js';
import { TodoAddAction } from './todo-add.js';
import { TodoArchiveAction } from './todo-archive.js';
import { TodoAttachAction } from './todo-attach.js';
import { TodoAttachmentsAction } from './todo-attachments.js';
import { TodoDoneAction } from './todo-done.js';
import { TodoFreezeAction } from './todo-freeze.js';
import { TodoGetAction } from './todo-get.js';
import { TodoListAction } from './todo-list.js';
import { TodoRemoveAction } from './todo-remove.js';
import { TodoUnfreezeAction } from './todo-unfreeze.js';
import { TodoUpdateAction } from './todo-update.js';
import { TopicAddAction } from './topic-add.js';
import { TopicListAction } from './topic-list.js';
import { TopicRemoveAction } from './topic-remove.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  GroupAddAction,
  GroupCurrentAction,
  GroupGetAction,
  GroupListAction,
  GroupMembersAction,
  GroupRemoveAction,
  GroupUpdateAction,
  GroupUseAction,
  PromptGetAction,
  PromptRemoveAction,
  PromptSetAction,
  TodoAddAction,
  TodoArchiveAction,
  TodoAttachAction,
  TodoAttachmentsAction,
  TodoDoneAction,
  TodoFreezeAction,
  TodoGetAction,
  TodoListAction,
  TodoRemoveAction,
  TodoUnfreezeAction,
  TodoUpdateAction,
  TopicAddAction,
  TopicListAction,
  TopicRemoveAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { GroupAddAction };
export { GroupCurrentAction };
export { GroupGetAction };
export { GroupListAction };
export { GroupMembersAction };
export { GroupRemoveAction };
export { GroupUpdateAction };
export { GroupUseAction };
export { PromptGetAction };
export { PromptRemoveAction };
export { PromptSetAction };
export { TodoAddAction };
export { TodoArchiveAction };
export { TodoAttachAction };
export { TodoAttachmentsAction };
export { TodoDoneAction };
export { TodoFreezeAction };
export { TodoGetAction };
export { TodoListAction };
export { TodoRemoveAction };
export { TodoUnfreezeAction };
export { TodoUpdateAction };
export { TopicAddAction };
export { TopicListAction };
export { TopicRemoveAction };
