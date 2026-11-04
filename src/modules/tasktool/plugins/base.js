// BasePlugin —— 全部 goal 的契约基类。
// 子类声明 static id / static scope，实现钩子；definePlugin 加载即自注册（IoC）。
// 注意：不用 static name（与 Function.name 冲突）。

import { GOAL_SCOPES } from '../../../core/workflow/types.js';
import { PLUGIN_HOOKS } from '../../../core/workflow/lifecycle.js';
import { registerPlugin } from './container.js';

/**
 * @typedef {import('../../../core/workflow/types.js').GoalScope} GoalScope
 * @typedef {import('../../../core/workflow/types.js').WorkflowSnapshot} WorkflowSnapshot
 *
 * @typedef {object} PluginContext
 * @property {Readonly<WorkflowSnapshot>} snapshot
 * @property {string|number} [nodeId]
 * @property {AbortSignal} [signal]
 * @property {Record<string, unknown>} [env]
 */

export class BasePlugin {
  /** @type {string} 注册名，如 blockgoal */
  static id = '';
  /** @type {GoalScope} */
  static scope = 'node';

  /** @returns {string} */
  get id() {
    return /** @type {typeof BasePlugin} */ (this.constructor).id;
  }

  /** @returns {GoalScope} */
  get scope() {
    return /** @type {typeof BasePlugin} */ (this.constructor).scope;
  }

  /**
   * @param {PluginContext} _ctx
   * @param {Record<string, unknown>} config
   * @returns {Record<string, unknown>}
   */
  onBind(_ctx, config = {}) {
    return config && typeof config === 'object' ? { ...config } : {};
  }

  /**
   * @param {PluginContext} _ctx
   * @param {Record<string, unknown>} _config
   */
  onSchedule(_ctx, _config) {
    return undefined;
  }

  /**
   * @param {PluginContext} _ctx
   * @param {Record<string, unknown>} _config
   * @returns {AsyncGenerator<unknown>}
   */
  async *onGet(_ctx, _config) {
    /* empty */
  }

  /**
   * @param {PluginContext} _ctx
   * @param {Record<string, unknown>} _config
   */
  onUnbind(_ctx, _config) {}
}

/**
 * IoC：new 并登记；模块 import 时副作用注册，runtime 只查 container。
 * @template {typeof BasePlugin} T
 * @param {T} PluginClass
 * @returns {InstanceType<T>}
 */
export function definePlugin(PluginClass) {
  const id = PluginClass.id;
  const scope = PluginClass.scope;
  if (!id || typeof id !== 'string') throw new Error('PluginClass.id required');
  if (!GOAL_SCOPES.includes(scope)) throw new Error(`PluginClass.scope invalid: ${scope}`);

  const instance = new PluginClass();
  if (!(instance instanceof BasePlugin)) {
    throw new Error(`${id} must extend BasePlugin`);
  }
  for (const hook of PLUGIN_HOOKS) {
    if (typeof instance[hook] !== 'function') {
      throw new Error(`${id}.${hook} must be a function`);
    }
  }
  registerPlugin(instance);
  return instance;
}
