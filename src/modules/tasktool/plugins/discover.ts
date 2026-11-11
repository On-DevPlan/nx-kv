// 目录扫描自动加载插件（IoC）：跳过基座/运行时/辅助 *-store/*-config。
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 模块已从 .js 迁到 .ts（改名迁移）：扫描按**实际文件名**匹配两种后缀，
// 保证加载的插件集合与迁移前完全一致。
const SKIP = new Set([
  'base.js',
  'base.ts',
  'container.js',
  'container.ts',
  'runtime.js',
  'runtime.ts',
  'index.js',
  'index.ts',
  'discover.js',
  'discover.ts',
]);

function isHelper(name: string): boolean {
  return (
    name.endsWith('-store.js') ||
    name.endsWith('-store.ts') ||
    name.endsWith('-config.js') ||
    name.endsWith('-config.ts') ||
    name.endsWith('.test.js') ||
    name.endsWith('.test.ts')
  );
}

let loaded = false;

/** 扫描本目录并 import 全部插件模块（definePlugin 副作用注册）。幂等。 */
export async function discoverPlugins(): Promise<string[]> {
  if (loaded) return listDiscovered();
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = (await readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !SKIP.has(f) && !isHelper(f),
  );
  files.sort();
  for (const f of files) {
    await import(pathToFileURL(join(dir, f)).href);
  }
  loaded = true;
  return files;
}

function listDiscovered(): string[] {
  return [];
}

export function resetDiscoverForTests(): void {
  loaded = false;
}
