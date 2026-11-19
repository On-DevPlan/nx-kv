// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { DocAttachAction } from './doc-attach.js';
import { DocAttachmentsAction } from './doc-attachments.js';
import { DocDetachAction } from './doc-detach.js';
import { DocGetAction } from './doc-get.js';
import { DocLinkFileAction } from './doc-link-file.js';
import { DocListAction } from './doc-list.js';
import { DocMdfileAction } from './doc-mdfile.js';
import { DocMdfilesAction } from './doc-mdfiles.js';
import { DocRefAddAction } from './doc-ref.js';
import { DocRemoveAction } from './doc-remove.js';
import { DocRefUnbindAction } from './doc-unbind.js';
import { DocUpdateAction } from './doc-update.js';
import { DocsBindAction } from './docs-bind.js';
import { DocsBindingsAction } from './docs-bindings.js';
import { DocsGcAction } from './docs-gc.js';
import { DocsIndexAction } from './docs-index.js';
import { DocsLinkAction } from './docs-link.js';
import { DocsMainAction } from './docs-main.js';
import { DocsNotebindAction } from './docs-notebind.js';
import { DocsOrphansPurgeAction } from './docs-orphans-purge.js';
import { DocsOrphansAction } from './docs-orphans.js';
import { RepoDocAddAction } from './repo-doc-add.js';
import { RepoDocListAction } from './repo-doc-list.js';
import { RepoDocRemoveAction } from './repo-doc-remove.js';
import { RepoKnowledgeAction } from './repo-knowledge.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  DocAttachAction,
  DocAttachmentsAction,
  DocDetachAction,
  DocGetAction,
  DocLinkFileAction,
  DocListAction,
  DocMdfileAction,
  DocMdfilesAction,
  DocRefAddAction,
  DocRemoveAction,
  DocRefUnbindAction,
  DocUpdateAction,
  DocsBindAction,
  DocsBindingsAction,
  DocsGcAction,
  DocsIndexAction,
  DocsLinkAction,
  DocsMainAction,
  DocsNotebindAction,
  DocsOrphansPurgeAction,
  DocsOrphansAction,
  RepoDocAddAction,
  RepoDocListAction,
  RepoDocRemoveAction,
  RepoKnowledgeAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { DocAttachAction };
export { DocAttachmentsAction };
export { DocDetachAction };
export { DocGetAction };
export { DocLinkFileAction };
export { DocListAction };
export { DocMdfileAction };
export { DocMdfilesAction };
export { DocRefAddAction };
export { DocRemoveAction };
export { DocRefUnbindAction };
export { DocUpdateAction };
export { DocsBindAction };
export { DocsBindingsAction };
export { DocsGcAction };
export { DocsIndexAction };
export { DocsLinkAction };
export { DocsMainAction };
export { DocsNotebindAction };
export { DocsOrphansPurgeAction };
export { DocsOrphansAction };
export { RepoDocAddAction };
export { RepoDocListAction };
export { RepoDocRemoveAction };
export { RepoKnowledgeAction };
