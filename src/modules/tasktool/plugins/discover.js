// 目录扫描自动加载插件（IoC）：跳过基座/运行时/辅助 *-store/*-config。
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKIP = new Set([
  'base.js',
  'container.js',
  'runtime.js',
  'index.js',
  'discover.js',
]);

function isHelper(name) {
  return (
    name.endsWith('-store.js') ||
    name.endsWith('-config.js') ||
    name.endsWith('.test.js')
  );
}

let loaded = false;

/** 扫描本目录并 import 全部插件模块（definePlugin 副作用注册）。幂等。 */
export async function discoverPlugins() {
  if (loaded) return listDiscovered();
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(dir)).filter(
    (f) => f.endsWith('.js') && !SKIP.has(f) && !isHelper(f),
  );
  files.sort();
  for (const f of files) {
    await import(pathToFileURL(join(dir, f)).href);
  }
  loaded = true;
  return files;
}

function listDiscovered() {
  return [];
}

export function resetDiscoverForTests() {
  loaded = false;
}
