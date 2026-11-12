// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { DocAddAction } from './doc-add.js';
import { DocAttachNoteAction } from './doc-attach-note.js';
import { DocAttachAction } from './doc-attach.js';
import { DocAttachmentsAction } from './doc-attachments.js';
import { DocDetachAction } from './doc-detach.js';
import { DocGetAction } from './doc-get.js';
import { DocListAction } from './doc-list.js';
import { DocRemoveAction } from './doc-remove.js';
import { DocUpdateAction } from './doc-update.js';
import { DocsBindAction } from './docs-bind.js';
import { DocsBindingsAction } from './docs-bindings.js';
import { DocsIndexAction } from './docs-index.js';
import { DocsLinkAction } from './docs-link.js';
import { DocsNotebindAction } from './docs-notebind.js';
import { DocsSeedAction } from './docs-seed.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  DocAddAction,
  DocAttachNoteAction,
  DocAttachAction,
  DocAttachmentsAction,
  DocDetachAction,
  DocGetAction,
  DocListAction,
  DocRemoveAction,
  DocUpdateAction,
  DocsBindAction,
  DocsBindingsAction,
  DocsIndexAction,
  DocsLinkAction,
  DocsNotebindAction,
  DocsSeedAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { DocAddAction };
export { DocAttachNoteAction };
export { DocAttachAction };
export { DocAttachmentsAction };
export { DocDetachAction };
export { DocGetAction };
export { DocListAction };
export { DocRemoveAction };
export { DocUpdateAction };
export { DocsBindAction };
export { DocsBindingsAction };
export { DocsIndexAction };
export { DocsLinkAction };
export { DocsNotebindAction };
export { DocsSeedAction };
