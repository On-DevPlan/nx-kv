// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { PluginContextAction } from './plugin-context.js';
import { PluginEntriesAction } from './plugin-entries.js';
import { PluginFileAction } from './plugin-file.js';
import { PluginListAction } from './plugin-list.js';
import { PluginRpcAction } from './plugin-rpc.js';
import { PluginSetDefaultAction } from './plugin-set-default.js';
import { PluginSetStateAction } from './plugin-set-state.js';
import { PluginSetVisibilityAction } from './plugin-set-visibility.js';
import { PluginTreeAction } from './plugin-tree.js';
import { PluginVisibilityAction } from './plugin-visibility.js';
import { PretaskDraftAction } from './pretask-draft.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  PluginContextAction,
  PluginEntriesAction,
  PluginFileAction,
  PluginListAction,
  PluginRpcAction,
  PluginSetDefaultAction,
  PluginSetStateAction,
  PluginSetVisibilityAction,
  PluginTreeAction,
  PluginVisibilityAction,
  PretaskDraftAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { PluginContextAction };
export { PluginEntriesAction };
export { PluginFileAction };
export { PluginListAction };
export { PluginRpcAction };
export { PluginSetDefaultAction };
export { PluginSetStateAction };
export { PluginSetVisibilityAction };
export { PluginTreeAction };
export { PluginVisibilityAction };
export { PretaskDraftAction };
