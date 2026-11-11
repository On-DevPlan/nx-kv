// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 `pnpm gen`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
import { AuthLoginAction } from './auth-login.js';
import { AuthLogoutAction } from './auth-logout.js';
import { AuthMeAction } from './auth-me.js';
import { AuthStatusAction } from './auth-status.js';

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
  AuthLoginAction,
  AuthLogoutAction,
  AuthMeAction,
  AuthStatusAction,
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
export { AuthLoginAction };
export { AuthLogoutAction };
export { AuthMeAction };
export { AuthStatusAction };
