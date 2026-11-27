// 插件 client/style/assets 的静态文件解析（/plugins/<id>/... 路由用）。
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { packageInfoOf } from './registry.js';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export interface PluginAsset {
  file: string;
  contentType: string;
}

/** rest 是 `/plugins/<id>/` 后面的部分（client.js / style.css / assets/...）。 */
export async function resolvePluginAsset(pluginId: string, rest: string): Promise<PluginAsset | null> {
  const info = await packageInfoOf(pluginId);
  if (!info) return null;
  let clean = '';
  try {
    clean = decodeURIComponent(String(rest || '')).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!clean) return null;

  let file = '';
  if (clean === 'client.js') {
    file = info.client;
  } else if (clean === 'style.css') {
    file = info.style;
  } else if (clean.startsWith('assets/') && info.client) {
    const base = resolve(dirname(info.client), 'assets');
    file = resolve(dirname(info.client), clean);
    if (file !== base && !file.startsWith(base + sep)) return null;
  } else {
    return null;
  }
  if (!file || !existsSync(file)) return null;
  return { file, contentType: MIME[extname(file).toLowerCase()] || 'application/octet-stream' };
}
