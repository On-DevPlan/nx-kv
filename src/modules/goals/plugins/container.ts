// 插件容器（IoC）：definePlugin → 此处；runtime / mutator 只问容器。

import { registerPluginMeta } from '../../../core/workflow/plugin-registry.js';
import type { BasePlugin } from './base.js';

const plugins = new Map<string, BasePlugin>();

export function registerPlugin(instance: BasePlugin): BasePlugin {
  const id = instance.id;
  const scope = instance.scope;
  if (!id) throw new Error('plugin instance missing id');
  plugins.set(id, instance);
  registerPluginMeta(id, scope);
  return instance;
}

export function getPlugin(id: string): BasePlugin | null {
  return plugins.get(id) || null;
}

export function listPlugins(): BasePlugin[] {
  return [...plugins.values()];
}

export function listPluginIds(): string[] {
  return [...plugins.keys()];
}

export function requirePlugin(id: string): BasePlugin {
  const p = plugins.get(id);
  if (!p) {
    const err = new Error(`plugin not registered: ${id}`) as Error & { code?: string };
    err.code = 'PLUGIN_NOT_FOUND';
    throw err;
  }
  return p;
}

/** 测试用 */
export function clearPlugins(): void {
  plugins.clear();
}
