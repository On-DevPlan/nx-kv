// BasePlugin —— 全部 goal 的契约基类。
// 子类声明 static id / static scope，实现钩子；definePlugin 加载即自注册（IoC）。
// 注意：不用 static name（与 Function.name 冲突）。

import { GOAL_SCOPES, type GoalScope } from '../../../core/workflow/types.js';
import { PLUGIN_HOOKS } from '../../../core/workflow/lifecycle.js';
import { registerPlugin } from './container.js';

import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

export interface PluginContext {
  snapshot: Readonly<WorkflowSnapshot>;
  nodeId?: string | number;
  signal?: AbortSignal;
  env?: Record<string, unknown>;
}

export class BasePlugin {
  /** 注册名，如 blockgoal */
  static id: string = '';
  static scope: GoalScope = 'node';

  get id(): string {
    return (this.constructor as typeof BasePlugin).id;
  }

  get scope(): GoalScope {
    return (this.constructor as typeof BasePlugin).scope;
  }

  onBind(_ctx: PluginContext, config: Record<string, unknown> = {}): Record<string, unknown> {
    return config && typeof config === 'object' ? { ...config } : {};
  }

  onSchedule(_ctx: PluginContext, _config: Record<string, unknown>): unknown {
    return undefined;
  }

  async *onGet(_ctx: PluginContext, _config: Record<string, unknown>): AsyncGenerator<unknown, void, unknown> {
    /* empty */
  }

  onUnbind(_ctx: PluginContext, _config: Record<string, unknown>): void {}
}

/**
 * IoC：new 并登记；模块 import 时副作用注册，runtime 只查 container。
 * @param PluginClass
 */
export function definePlugin<T extends typeof BasePlugin>(PluginClass: T): InstanceType<T> {
  const id = PluginClass.id;
  const scope = PluginClass.scope;
  if (!id || typeof id !== 'string') throw new Error('PluginClass.id required');
  if (!GOAL_SCOPES.includes(scope)) throw new Error(`PluginClass.scope invalid: ${scope}`);

  const instance = new PluginClass();
  if (!(instance instanceof BasePlugin)) {
    throw new Error(`${id} must extend BasePlugin`);
  }
  for (const hook of PLUGIN_HOOKS) {
    if (typeof instance[hook as keyof BasePlugin] !== 'function') {
      throw new Error(`${id}.${hook} must be a function`);
    }
  }
  registerPlugin(instance);
  // instanceof 收窄会把泛型 InstanceType<T> 塌成 BasePlugin，这里恢复声明精度
  return instance as InstanceType<T>;
}
