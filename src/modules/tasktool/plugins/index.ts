// 控制反转入口：目录扫描自注册；调用方只 import 本桶。
import { discoverPlugins } from './discover.js';

await discoverPlugins();

export { BasePlugin, definePlugin } from './base.js';
export {
  getPlugin,
  requirePlugin,
  listPlugins,
  listPluginIds,
  registerPlugin,
} from './container.js';
export { runScheduleHooks, runGetHooks } from './runtime.js';
export { discoverPlugins } from './discover.js';
export { isBarrierOpen } from './blockgoal.js';
export { default as blockgoal } from './blockgoal.js';
export { default as waitgoal } from './waitgoal.js';
export { default as timegoal } from './timegoal.js';
export { default as taskgoal } from './taskgoal.js';
