// 插件可请求的项目目录/文件读取：只允许已登记 repo，路径必须落在 repo 根内。
// 这是宿主给插件的 HTTP 能力（/api/plugins/tree、/file），不是插件存储。
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { badInput, notFound } from '../../core/errors.js';
import { repoRowOf } from './context.js';

const DENY_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.parcel-cache',
  '.turbo', '.venv', 'venv', '__pycache__', 'coverage', '.pytest_cache', '.mypy_cache',
  'target', 'bin', 'obj', '.gradle', '.idea', '.DS_Store',
]);
const MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 1024 * 1024;

export interface RepoTreeEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

export interface RepoTreeView {
  repoKey: string;
  repoName: string;
  repoRoot: string;
  path: string;
  entries: RepoTreeEntry[];
  truncated: boolean;
}

export interface RepoFileView {
  repoKey: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string;
}

function normalized(value: unknown): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function relPathOf(value: unknown): string {
  const rel = normalized(value);
  if (!rel) return '';
  const segs = rel.split('/');
  if (segs.some((s) => !s || s === '.' || s === '..')) throw badInput(`非法路径：${rel}`);
  return segs.join('/');
}

function repoOf(repoKey: string): { key: string; name: string; root: string } {
  const key = String(repoKey || '').trim();
  if (!key) throw badInput('需要 repoKey');
  const repo = repoRowOf(key);
  if (!repo || repo.type !== 'repo') throw notFound(`没有可用仓库：${key}`);
  if (!repo.path) throw badInput(`仓库 ${key} 没有本机路径`);
  return { key: repo.key, name: repo.name, root: repo.path };
}

function realInside(root: string, target: string): string {
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  const same = process.platform === 'win32'
    ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    : (a: string, b: string) => a === b;
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  const inside = same(realTarget, realRoot) || (process.platform === 'win32'
    ? realTarget.toLowerCase().startsWith(prefix.toLowerCase())
    : realTarget.startsWith(prefix));
  if (!inside) throw badInput('路径越出仓库根目录');
  return realTarget;
}

export function listRepoTree(input: {
  repoKey: string;
  path?: string;
  showHidden?: boolean;
}): RepoTreeView {
  const repo = repoOf(input.repoKey);
  const rel = relPathOf(input.path);
  const abs = resolve(repo.root, rel);
  const real = realInside(repo.root, abs);
  let stat;
  try {
    stat = statSync(real);
  } catch {
    throw notFound(`目录不存在：${rel || '.'}`);
  }
  if (!stat.isDirectory()) throw badInput(`不是目录：${rel}`);

  const items: RepoTreeEntry[] = [];
  let truncated = false;
  for (const dent of readdirSync(real, { withFileTypes: true })) {
    if (dent.name === '.git' || dent.name === 'node_modules') continue;
    if (!input.showHidden && dent.name.startsWith('.')) continue;
    if (dent.isSymbolicLink()) continue;
    if (dent.isDirectory() && DENY_DIRS.has(dent.name)) continue;
    const childRel = rel ? `${rel}/${dent.name}` : dent.name;
    if (dent.isDirectory()) {
      items.push({ name: dent.name, path: childRel, type: 'dir' });
    } else if (dent.isFile()) {
      let size = 0;
      try {
        size = statSync(resolve(real, dent.name)).size;
      } catch {
        size = 0;
      }
      items.push({ name: dent.name, path: childRel, type: 'file', size });
    }
    if (items.length >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return {
    repoKey: repo.key,
    repoName: repo.name,
    repoRoot: repo.root,
    path: rel,
    entries: items,
    truncated,
  };
}

export function readRepoFile(input: { repoKey: string; path: string; maxBytes?: number }): RepoFileView {
  const repo = repoOf(input.repoKey);
  const rel = relPathOf(input.path);
  if (!rel) throw badInput('需要文件路径');
  const abs = resolve(repo.root, rel);
  const real = realInside(repo.root, abs);
  let stat;
  try {
    stat = statSync(real);
  } catch {
    throw notFound(`文件不存在：${rel}`);
  }
  if (!stat.isFile()) throw badInput(`不是文件：${rel}`);
  const requested = Number(input.maxBytes) || DEFAULT_MAX_BYTES;
  const max = Math.max(1024, Math.min(MAX_MAX_BYTES, Math.trunc(requested)));
  const take = Math.min(stat.size, max);
  const buf = Buffer.alloc(take);
  if (take > 0) {
    const fd = openSync(real, 'r');
    try {
      readSync(fd, buf, 0, take, 0);
    } finally {
      closeSync(fd);
    }
  }
  const binary = buf.subarray(0, Math.min(take, 8192)).includes(0);
  return {
    repoKey: repo.key,
    path: rel,
    size: stat.size,
    binary,
    truncated: stat.size > take,
    content: binary ? '' : buf.toString('utf8'),
  };
}

/** 给插件 UI 的 repo 存在性检查（不必读目录）。 */
export function repoExists(repoKey: string): boolean {
  const repo = repoRowOf(String(repoKey || ''));
  return !!repo && repo.type === 'repo' && !!repo.path;
}
