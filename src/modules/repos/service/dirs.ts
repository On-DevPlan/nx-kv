// 仓库子目录列举（#276 面包屑「面板支持选择子目录」）。
//
// 只读、且**只允许列已登记仓库下的子目录**——面板是本机工具，但也不能变成
// 任意文件系统浏览器（越权读别的目录）。守卫口径：请求路径必须落在某个
// 已登记仓库的路径之内（含等于该仓库根）。
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { loadStore } from './store.js';

/** 一个子目录条目。 */
export interface DirEntry {
  name: string;
  path: string;
}

/** 路径归一：绝对化 + 去尾分隔符；Windows 下大小写不敏感。 */
export function normPath(p: string): string {
  const s = resolve(String(p || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

/** candidate 是否落在 roots 之内（等于某个 root，或以其 + 分隔符开头）。 */
export function isInsideRoots(candidate: string, roots: string[]): boolean {
  const c = normPath(candidate);
  return roots.some((r) => {
    const root = normPath(r);
    if (!root) return false;
    return c === root || c.startsWith(root + sep) || c.startsWith(root + '/');
  });
}

/** 列目录下一层的子目录（隐藏目录与 node_modules 略过，按名排序）。 */
export async function listSubDirs(absPath: string): Promise<DirEntry[]> {
  const entries = await readdir(absPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => ({ name: e.name, path: join(absPath, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 列某目录下的子目录（受守卫约束）。
 * @throws 目录不在任何已登记仓库内（code=FORBIDDEN），或目录不存在/无权限。
 */
export async function listRepoDirs(path: string): Promise<{ path: string; dirs: DirEntry[] }> {
  const abs = resolve(String(path || ''));
  const store = await loadStore();
  const repos = (store.repos || []) as Array<{ path?: string }>;
  const roots = repos.map((r) => String(r.path || '')).filter(Boolean);
  if (!roots.length) {
    const err = new Error('本机还没有登记任何仓库，无法浏览子目录');
    (err as { code?: string }).code = 'FORBIDDEN';
    throw err;
  }
  if (!isInsideRoots(abs, roots)) {
    const err = new Error('只能浏览已登记仓库下的子目录');
    (err as { code?: string }).code = 'FORBIDDEN';
    throw err;
  }
  return { path: abs, dirs: await listSubDirs(abs) };
}
