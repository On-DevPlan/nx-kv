import { BUILTIN_GOALS, GOAL_SCOPES } from './types.js';
import type { GoalScope, PluginSpec } from './types.js';

export interface PluginMeta {
  name: string;
  scope: GoalScope;
}

const registry = new Map<string, PluginMeta>();

export function registerPluginMeta(name: string, scope: GoalScope): PluginMeta | undefined {
  if (!name || typeof name !== 'string') throw new Error('plugin name required');
  if (!GOAL_SCOPES.includes(scope)) throw new Error(`invalid goal scope: ${scope}`);
  registry.set(name, { name, scope });
  return registry.get(name);
}

export function getPluginMeta(name: string): PluginMeta | null {
  return registry.get(name) || null;
}

export function listPluginMetas(): PluginMeta[] {
  return [...registry.values()];
}

/** 校验 PluginSpec：已注册且 scope 匹配（未注册则只认内置名） */
export function assertPluginSpec(spec: PluginSpec | null | undefined): PluginSpec {
  if (!spec || typeof spec !== 'object') throw new Error('PluginSpec required');
  const name = String(spec.name || '');
  if (!name) throw new Error('PluginSpec.name required');
  const meta = registry.get(name);
  const scope = spec.scope || meta?.scope;
  if (!scope || !GOAL_SCOPES.includes(scope)) {
    throw new Error(`PluginSpec.scope invalid for ${name}`);
  }
  if (meta && meta.scope !== scope) {
    throw new Error(`plugin ${name} scope must be ${meta.scope}, got ${scope}`);
  }
  // 运行时 name 就是受控词表里的内置插件名，这里只是字面量类型收得比运行时窄
  if (!meta && !(Object.values(BUILTIN_GOALS) as string[]).includes(name) && name !== 'taskgoal') {
    throw new Error(`unknown plugin: ${name}`);
  }
  return { name, scope, config: spec.config && typeof spec.config === 'object' ? spec.config : {} };
}

// 内置登记（实现落在 tasktool/plugins；此处只登记元数据）
registerPluginMeta(BUILTIN_GOALS.blockgoal, 'control');
registerPluginMeta(BUILTIN_GOALS.waitgoal, 'node');
registerPluginMeta(BUILTIN_GOALS.timegoal, 'workflow');
registerPluginMeta('taskgoal', 'node');
