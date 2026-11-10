// 目录扫描与「本地任务上下文」视图：scanRepos / repoOpen / contextForPath / contextMap。
import { join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { openPath } from '../../../core/open.js';
import { gitRemotes, pickRemote } from '../git.js';
import { loadStore } from './store.js';
import { deriveKey, boardRepoKeys, storedBoardKey } from './identity.js';
import { addRepo, getRepo } from './crud.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '__pycache__',
  '.venv',
  'vendor',
  'bower_components',
  '.nx-rh',
  '.nx-kv',
  'AppData',
]);

// 含 .git（目录或文件——worktree / submodule 下是文件）即视为一个仓库根
async function hasGitDir(dir) {
  try {
    await fsp.stat(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

// 扫描根目录下的 git 仓库。
// `dryRun` 时**只列出**（发现模式）：「看看这底下都有些什么仓库」和「把它们都收进来」
// 是两个动作，前者不该有任何副作用——agent 的探测步骤尤其不能顺手改状态。
export async function scanRepos(root, depth = 3, { dryRun = false } = {}) {
  const absRoot = resolve(String(root || ''));
  const found = [];

  async function walk(dir, d) {
    if (await hasGitDir(dir)) found.push(dir);
    if (d <= 0) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), d - 1);
    }
  }

  await walk(absRoot, depth);

  const repos = (await loadStore()).repos;
  const byPath = new Map(repos.map((r) => [r.path.toLowerCase(), r]));
  const detail = found.map((p) => {
    const hit = byPath.get(p.toLowerCase());
    return { path: p, known: !!hit, name: hit ? hit.name : '' };
  });

  if (dryRun) {
    return {
      root: absRoot,
      dryRun: true,
      scanned: found.length,
      found: detail,
      added: [],
      skipped: detail.filter((x) => x.known).length,
    };
  }

  const added = [];
  for (const p of found) {
    // key 不允许按名字生成：扫描到的 git 仓库先读 remote 作为身份来源；
    // 没有 remote 的仓库不能悄悄登记（那会产出用户没见过的 local/<名字> key）。
    let remote = '';
    try {
      const remotes = await gitRemotes(p);
      const picked = pickRemote(remotes);
      remote = picked ? picked.url : '';
    } catch {
      remote = '';
    }
    if (!remote) continue;
    try {
      added.push(await addRepo({ path: p, remote }));
    } catch {
      // 已登记或 key 冲突，跳过
    }
  }
  return {
    root: absRoot,
    dryRun: false,
    scanned: found.length,
    found: detail,
    added,
    skipped: detail.length - added.length,
  };
}

// 在系统文件管理器中打开（"操作 OS 方便"的最小切口）
export async function repoOpen(id) {
  const r = await getRepo(id);
  openPath(r.path);
  return { opened: r.path };
}

// ─── 给本地任务用的上下文视图 ──────────────────────────────────────────
//
// 本模块存在的**目的**是给本地任务当上下文，所以这里提供「按目录找仓库」的能力：
// 本地任务的主题是按**目录名**认的，而仓库登记里存的是**绝对路径**，
// 两边要能对上（同一台机器上，目录的绝对路径就是它所属仓库的路径）。
//
// 路径比较一律**大小写不敏感**（Windows 上同一个目录可能大小写不同）。
export function normalizePathKey(p) {
  return String(p || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * 这个目录属于哪个已登记仓库？返回 {repo, boards}：
 * - repo：仓库登记本体（name / path / tags / desc / notes）
 * - boards：它所在的看板（= 周围联系）——一个仓库可以同时在多个看板里
 */
export async function contextForPath(dirPath) {
  const key = normalizePathKey(dirPath);
  if (!key) return null;
  const map = await contextMap();
  return map.get(key) || null;
}

/**
 * 全部仓库的上下文，按**归一化路径**索引。
 *
 * 给「本地任务」用：它一次要映射所有主题，逐个读文件太浪费，
 * 所以这里一次读、一张表，调用方自己按路径取。
 *
 * Map 的 key 是 normalizePathKey(仓库路径) —— 归一化过（分隔符统一 + 小写），
 * 所以 Windows 上大小写不同也能对上。
 */
export async function contextMap() {
  const s = await loadStore();
  const boardsOf = new Map(); // repoKey -> [看板投影]
  for (const b of s.boards) {
    for (const rk of boardRepoKeys(b, s)) {
      if (!boardsOf.has(rk)) boardsOf.set(rk, []);
      boardsOf.get(rk).push({
        id: b.id,
        name: b.name,
        desc: b.desc || '',
        key: storedBoardKey(b),
        note: (b.repoNotes || {})[rk] || '',
      });
    }
  }
  const map = new Map();
  for (const r of s.repos) {
    const rk = deriveKey(r);
    map.set(normalizePathKey(r.path), {
      id: r.id,
      name: r.name,
      path: r.path,
      desc: r.desc || '',
      notes: r.notes || '',
      type: r.type || 'dev',
      key: rk,
      remote: r.remote || '',
      boards: boardsOf.get(rk) || [],
    });
  }
  return map;
}

// 按名称找仓库（大小写不敏感；参考仓库的绑定常直接给名字）。
// 找不到返回 null——调用方决定报不报错。
export async function findRepoByName(name) {
  const nm = String(name || '').trim().toLowerCase();
  if (!nm) return null;
  const s = await loadStore();
  return s.repos.find((r) => String(r.name).toLowerCase() === nm) || null;
}
