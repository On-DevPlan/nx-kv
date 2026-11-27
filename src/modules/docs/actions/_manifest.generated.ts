// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { DocsAttachAction } from './docs-attach.js';
import { DocsAttachmentsAction } from './docs-attachments.js';
import { DocsBindAction } from './docs-bind.js';
import { DocsBindingsAction } from './docs-bindings.js';
import { DocsDetachAction } from './docs-detach.js';
import { DocsGcAction } from './docs-gc.js';
import { DocsGetAction } from './docs-get.js';
import { DocsIndexAction } from './docs-index.js';
import { DocsLinkAction } from './docs-link.js';
import { DocsListAction } from './docs-list.js';
import { DocsMainAction } from './docs-main.js';
import { DocsNotebindAction } from './docs-note-bind.js';
import { DocsOrphansPurgeAction } from './docs-orphans-purge.js';
import { DocsOrphansAction } from './docs-orphans.js';
import { DocsRefAddAction } from './docs-ref.js';
import { DocsRemoveAction } from './docs-remove.js';
import { DocsSetAction } from './docs-set.js';
import { DocsRefUnbindAction } from './docs-unbind.js';
import { RepoDocAddAction } from './repo-doc-add.js';
import { RepoDocListAction } from './repo-doc-list.js';
import { RepoDocRemoveAction } from './repo-doc-remove.js';
import { RepoKnowledgeAction } from './repo-knowledge.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  DocsAttachAction,
  DocsAttachmentsAction,
  DocsBindAction,
  DocsBindingsAction,
  DocsDetachAction,
  DocsGcAction,
  DocsGetAction,
  DocsIndexAction,
  DocsLinkAction,
  DocsListAction,
  DocsMainAction,
  DocsNotebindAction,
  DocsOrphansPurgeAction,
  DocsOrphansAction,
  DocsRefAddAction,
  DocsRemoveAction,
  DocsSetAction,
  DocsRefUnbindAction,
  RepoDocAddAction,
  RepoDocListAction,
  RepoDocRemoveAction,
  RepoKnowledgeAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { DocsAttachAction };
export { DocsAttachmentsAction };
export { DocsBindAction };
export { DocsBindingsAction };
export { DocsDetachAction };
export { DocsGcAction };
export { DocsGetAction };
export { DocsIndexAction };
export { DocsLinkAction };
export { DocsListAction };
export { DocsMainAction };
export { DocsNotebindAction };
export { DocsOrphansPurgeAction };
export { DocsOrphansAction };
export { DocsRefAddAction };
export { DocsRemoveAction };
export { DocsSetAction };
export { DocsRefUnbindAction };
export { RepoDocAddAction };
export { RepoDocListAction };
export { RepoDocRemoveAction };
export { RepoKnowledgeAction };
