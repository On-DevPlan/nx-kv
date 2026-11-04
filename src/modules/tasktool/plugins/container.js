// 插件容器（IoC）：definePlugin → 此处；runtime / mutator 只问容器。

import { registerPluginMeta } from '../../../core/workflow/plugin-registry.js';

/** @typedef {import('./base.js').BasePlugin} BasePlugin */

/** @type {Map<string, BasePlugin>} */
const plugins = new Map();

/** @param {BasePlugin} instance */
export function registerPlugin(instance) {
  const id = instance.id;
  const scope = instance.scope;
  if (!id) throw new Error('plugin instance missing id');
  plugins.set(id, instance);
  registerPluginMeta(id, scope);
  return instance;
}

/** @param {string} id */
export function getPlugin(id) {
  return plugins.get(id) || null;
}

export function listPlugins() {
  return [...plugins.values()];
}

export function listPluginIds() {
  return [...plugins.keys()];
}

/** @param {string} id */
export function requirePlugin(id) {
  const p = plugins.get(id);
  if (!p) {
    const err = new Error(`plugin not registered: ${id}`);
    err.code = 'PLUGIN_NOT_FOUND';
    throw err;
  }
  return p;
}

/** 测试用 */
export function clearPlugins() {
  plugins.clear();
}
