// 插件包发现与 server 半侧加载。
//
// 内置插件：packages/*/package.json 的 nxkv 字段是唯一清单；gen-plugins 只生成
// `{ name, dir }`，宿主按**包根相对目录**解析 package.json 与 dist 产物，
// 不依赖 node_modules 里的包链接——发布包携带 packages/，npx nx-kv 也能加载。
//
// v1 同进程加载（内部可信插件）；包只依赖 @nx-kv/plugin-sdk 构建期类型与 React。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NxkvPlugin } from '@nx-kv/plugin-sdk';
import { PLUGIN_PACKAGES, type PluginPackageRef } from './plugins.generated.js';

/** 包根（src/modules/plugin/ 往上三层；dev 与发布包同一布局）。 */
const PKG_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export interface PluginPackageInfo {
  packageName: string;
  dir: string;
  api: string;
  server: string;
  client: string;
  style: string;
}

export interface LoadedPlugin {
  info: PluginPackageInfo;
  plugin: NxkvPlugin | null;
  error: string;
}

function readPackageInfo(ref: PluginPackageRef): PluginPackageInfo | null {
  const dir = resolve(PKG_ROOT, ref.dir);
  const pkgPath = resolve(dir, 'package.json');
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, any>;
    const nxkv = pkg?.nxkv;
    if (!nxkv || !nxkv.api || !nxkv.server) return null;
    return {
      packageName: ref.name,
      dir,
      api: String(nxkv.api),
      server: resolve(dir, String(nxkv.server)),
      client: nxkv.client ? resolve(dir, String(nxkv.client)) : '',
      style: nxkv.style ? resolve(dir, String(nxkv.style)) : '',
    };
  } catch {
    return null;
  }
}

let cache: Promise<LoadedPlugin[]> | null = null;

/** 清缓存（测试 / 开发时重建插件包后用）。 */
export function resetPluginCache(): void {
  cache = null;
}

async function doLoad(): Promise<LoadedPlugin[]> {
  const out: LoadedPlugin[] = [];
  for (const ref of PLUGIN_PACKAGES) {
    const info = readPackageInfo(ref);
    if (!info) {
      out.push({
        info: {
          packageName: ref.name,
          dir: resolve(PKG_ROOT, ref.dir),
          api: '',
          server: '',
          client: '',
          style: '',
        },
        plugin: null,
        error: `插件包 ${ref.name} 的 package.json 缺失或没有可用的 nxkv 清单（目录 ${ref.dir}）`,
      });
      continue;
    }
    if (!existsSync(info.server)) {
      out.push({ info, plugin: null, error: `插件 server 产物不存在：${info.server}（先跑 pnpm build:packages）` });
      continue;
    }
    try {
      const mod = (await import(pathToFileURL(info.server).href)) as Record<string, any>;
      const plugin = (mod.default || mod.plugin) as NxkvPlugin | undefined;
      if (!plugin || typeof plugin !== 'object') throw new Error('server 入口没有默认导出插件对象');
      if (!plugin.api || !/^\^1(\.|$)/.test(String(plugin.api))) throw new Error(`不支持的插件 API：${String(plugin.api)}`);
      if (!plugin.id || /[:.]/.test(String(plugin.id))) throw new Error(`非法插件 id：${String(plugin.id)}`);
      if (typeof plugin.entries !== 'function') throw new Error('插件缺少 entries()');
      if (typeof plugin.buildDraft !== 'function') throw new Error('插件缺少 buildDraft()');
      out.push({ info, plugin, error: '' });
    } catch (e) {
      out.push({ info, plugin: null, error: String((e as Error).message || e) });
    }
  }
  return out;
}

/** 加载全部插件（并发安全；只有一次实际 import）。 */
export function loadPlugins(): Promise<LoadedPlugin[]> {
  if (!cache) cache = doLoad();
  return cache;
}

/** 资产路由用的包信息查找（只认成功加载的插件）。 */
export async function packageInfoOf(pluginId: string): Promise<PluginPackageInfo | null> {
  const loaded = await loadPlugins();
  return loaded.find((l) => l.plugin?.id === pluginId)?.info || null;
}
