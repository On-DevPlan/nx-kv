// 编程入口：供其他工具 / agent 以库方式调用。
// 导出的是各模块的 service（业务真相源），不是 CLI/HTTP 壳。
export * as config from './core/config.js';
export * as kvapi from './core/kvapi.js';
export * as errors from './core/errors.js';
export * as todo from './modules/todo/service.js';

export { ACTIONS, MODULES } from './runtime/registry.js';
export { startServer } from './runtime/server.js';
