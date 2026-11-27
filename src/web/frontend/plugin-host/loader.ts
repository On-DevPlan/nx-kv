// 插件 client bundle 加载器：注入共享 React/注册入口，按 /api/plugins 的启用清单
// 依次加载 /plugins/<id>/client.js。插件 bundle 自己调用 registerPlugin 完成自注册。
import { useEffect, useState } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import { api } from '../api/client.js';
import { registerPluginUi, setEnabledPluginUi } from './registry.js';

export interface HostPluginSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  api: string;
  order: number;
  enabled: boolean;
  entryCount: number;
  clientUrl: string;
  styleUrl: string;
  error: string;
}

const loaded = new Set<string>();
let hostInstalled = false;

function installHost(): void {
  if (hostInstalled) return;
  hostInstalled = true;
  window.NxkvReact = React;
  window.NxkvReactDOM = ReactDOM;
  window.NxkvJsxRuntime = jsxRuntime;
  window.NxkvPluginHost = {
    api: '^1',
    registerPlugin: (id, def) => registerPluginUi(id, def),
  };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn(`[plugin-ui] client.js 加载失败：${src}`);
      resolve();
    };
    document.head.appendChild(script);
  });
}

function ensureStyle(href: string): void {
  if (!href) return;
  if (document.querySelector(`link[data-nxkv-plugin-style="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.nxkvPluginStyle = href;
  document.head.appendChild(link);
}

export async function refreshPluginUi(): Promise<HostPluginSummary[]> {
  installHost();
  const list = await api<HostPluginSummary[]>('/api/plugins');
  const rows = Array.isArray(list) ? list : [];
  setEnabledPluginUi(rows.filter((p) => p.enabled && p.clientUrl).map((p) => p.id));
  for (const plugin of rows) {
    if (!plugin.enabled || !plugin.clientUrl) continue;
    ensureStyle(plugin.styleUrl);
    if (loaded.has(plugin.id)) continue;
    loaded.add(plugin.id);
    await loadScript(plugin.clientUrl);
  }
  return rows;
}

/** App 启动时加载一次；设置页开关后用 refreshPluginUi 增量加载。 */
export function usePluginUiLoader(): { plugins: HostPluginSummary[] | null; error: string } {
  const [plugins, setPlugins] = useState<HostPluginSummary[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    refreshPluginUi()
      .then((rows) => alive && setPlugins(rows))
      .catch((e) => alive && setError(String((e as Error).message || e)));
    return () => {
      alive = false;
    };
  }, []);
  return { plugins, error };
}
