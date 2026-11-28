// 插件 UI 注册表：插件 client bundle 通过 window.NxkvPluginHost.registerPlugin 自注册。
// 宿主只认 components / pages / sidebar；组件由插件包提供。
import { useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import type { PluginSidebarEntry, PluginUiDefinition } from '@nx-kv/plugin-sdk/client';

const definitions = new Map<string, PluginUiDefinition>();
const enabledPlugins = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerPluginUi(pluginId: string, def: PluginUiDefinition): void {
  if (!def || typeof def !== 'object' || !def.components) {
    console.warn(`[plugin-ui] ${pluginId} 注册内容非法`);
    return;
  }
  if (!def.api || !/^\^1(\.|$)/.test(String(def.api))) {
    console.warn(`[plugin-ui] ${pluginId} 的 api 版本不兼容：${String(def.api)}`);
    return;
  }
  definitions.set(pluginId, def);
  emit();
}

export function setEnabledPluginUi(ids: readonly string[]): void {
  enabledPlugins.clear();
  for (const id of ids) enabledPlugins.add(id);
  emit();
}

export function usePluginUiVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}

export function pluginUiOf(pluginId: string): PluginUiDefinition | undefined {
  return definitions.get(pluginId);
}

export function usePluginComponent(pluginId: string, componentId: string | undefined): ComponentType<any> | null {
  usePluginUiVersion();
  if (!componentId) return null;
  return definitions.get(pluginId)?.components?.[componentId] || null;
}

export interface PluginSidebarView {
  pluginId: string;
  entry: PluginSidebarEntry;
  title: string;
  /** 条目自己的 icon → 插件级 icon → 空（调用方回退默认）。 */
  icon: string;
}

export function usePluginSidebar(): PluginSidebarView[] {
  usePluginUiVersion();
  const out: PluginSidebarView[] = [];
  for (const [pluginId, def] of definitions) {
    if (!enabledPlugins.has(pluginId)) continue;
    for (const entry of def.sidebar || []) {
      out.push({
        pluginId,
        entry,
        title: def.pages?.[entry.page]?.title || entry.label,
        icon: entry.icon || def.icon || '',
      });
    }
  }
  out.sort((a, b) => (a.entry.order ?? 100) - (b.entry.order ?? 100) || a.entry.label.localeCompare(b.entry.label));
  return out;
}

export function pluginPageTitle(pluginId: string, pageId: string): string {
  return definitions.get(pluginId)?.pages?.[pageId]?.title || '';
}
