// 仓库上下文 service：登记、CRUD、目录扫描。
//
// **来历**：这套东西原本长在 nx-rh（`src/modules/repos/`），2026-10-23 整体迁到 nx-kv
// （远程清单 topic=goal 的 #72）：仓库登记是**本机事实**（路径、标签、描述），
// 它的价值是给「本地任务管理」当上下文——agent 领到任务时就知道这条任务属于哪个仓库、
// 周围关联着哪些看板。所以它跟着任务走，而不是跟着另一个工具走。
//
// 本文件是业务真相源，不含任何传输层概念（不认识 argv，也不认识 HTTP）。
// 刻意不碰 git：只记录「这台机器上有哪些仓库、它们分别是什么」，
// 状态与读写交给 git 本身（面板做不好的东西不做）。
import { basename, join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { APP_DIR } from '../../core/paths.js';
import { openPath } from '../../core/open.js';
import { badInput, notFound, conflict } from '../../core/errors.js';

// ─── 存储（NX_KV_REPOS_STORE 可覆盖；测试隔离）──────────────────────────
// 独立文件，不塞进 localtasks.json：仓库登记的写频率低、内容性质不同
// （它是"这台机器上有什么"，而 localtask 是"队列里有什么"）。
export function storePath() {
  return process.env.NX_KV_REPOS_STORE || join(APP_DIR, 'repos.json');
}

function emptyStore() {
  return { version: 1, repos: [], boards: [] };
}

// 原子写 + 进程内串行化（与 localtask / timegoal 同一模式：Windows 上 rename
// 偶发 EPERM，重试几次即可；串行化避免并发写互相覆盖）。
let saveQueue = Promise.resolve();
function saveStore(data) {
  const run = saveQueue.then(async () => {
    const p = storePath();
    await fsp.mkdir(join(p, '..'), { recursive: true });
    const tmp = p + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, p);
        return;
      } catch (err) {
        if (i >= 4 || (err.code !== 'EPERM' && err.code !== 'EACCES')) throw err;
        await new Promise((r) => setTimeout(r, 25 * (i + 1)));
      }
    }
  });
  saveQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

export async function loadStore() {
  try {
    const raw = await fsp.readFile(storePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return emptyStore();
    return {
      version: 1,
      repos: Array.isArray(data.repos) ? data.repos : [],
      boards: Array.isArray(data.boards) ? data.boards : [],
    };
  } catch {
    /* 缺失或损坏 → 空 store */
    return emptyStore();
  }
}

// 读-改-写事务：fn 直接修改传入的深拷贝；fn 抛错则不落盘。
// 导出给 boards.js 用（看板与登记共用同一份 store），不重复实现一遍原子写。
export async function mutateStore(fn) {
  const cur = structuredClone(await loadStore());
  const out = fn(cur);
  await saveStore(cur);
  return out;
}

export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 标签已废除（2026-10-24）：分组只走看板一条路，两套平行的分组机制只会互相打架。
// 旧数据里残留的 tags 字段留在盘上不动，但不再写入、不再外发。
function normalizeRepoInput({ path, name, notes, desc }) {
  const abs = resolve(String(path || ''));
  return {
    id: newId('r'),
    name: (name || basename(abs) || 'repo').trim(),
    path: abs,
    desc: (desc || '').trim(),
    notes: (notes || '').trim(),
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * **中心清单**：一份扁平的仓库列表（按名称排序），每条带它所属的看板。
 *
 * 为什么是「中心清单 + 看板只是标签」：
 *   - 仓库登记是**唯一真相**（name/path/tags/desc/notes），它一直在这张清单里；
 *   - 看板只存 `repoIds`（引用），所以**加入看板是复制**，不是移动——
 *     同一个仓库可以同时在多个看板里（fr 同时在「fr常用」与「远程打字」）；
 *   - 取消某份「副本」只摘那个看板的引用，仓库本体纹丝不动。
 *
 * 之前页面是「按看板分组的卡片墙 + 拖拽」，那套交互读起来就是「移动」，
 * 而且同一个仓库会在多个分组里重复出现、看不到全貌。现在主视图是这张扁平的
 * 中心清单，看板退成筛选器与标签。
 */
export async function listRepos() {
  const s = await loadStore();
  const boardsOf = new Map();
  for (const b of s.boards) {
    for (const rid of b.repoIds || []) {
      if (!boardsOf.has(rid)) boardsOf.set(rid, []);
      boardsOf.get(rid).push({ id: b.id, name: b.name, desc: b.desc || '', note: (b.repoNotes || {})[rid] || '' });
    }
  }
  return s.repos
    .map(({ tags: _dropped, ...r }) => ({ ...r, boards: boardsOf.get(r.id) || [] }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function addRepo(input) {
  if (!input || !input.path) throw badInput('path 不能为空');
  const repo = normalizeRepoInput(input);
  await mutateStore((s) => {
    if (s.repos.some((r) => r.path.toLowerCase() === repo.path.toLowerCase())) {
      throw conflict('该路径已登记: ' + repo.path);
    }
    s.repos.push(repo);
  });
  return repo;
}

export async function updateRepo(id, patch) {
  return mutateStore((s) => {
    const r = s.repos.find((x) => x.id === id);
    if (!r) throw notFound('repo 不存在: ' + id);
    if (patch.name !== undefined) r.name = String(patch.name).trim();
    if (patch.desc !== undefined) r.desc = String(patch.desc).trim();
    if (patch.notes !== undefined) r.notes = String(patch.notes);
    if (patch.path !== undefined) {
      const abs = resolve(String(patch.path));
      // 改路径同样要防重复登记，否则两条记录指向同一目录，扫描时无法判断是否已登记
      if (s.repos.some((x) => x.id !== id && x.path.toLowerCase() === abs.toLowerCase())) {
        throw conflict('该路径已登记: ' + abs);
      }
      r.path = abs;
    }
    r.updatedAt = new Date().toISOString();
    return r;
  });
}

export async function removeRepo(id) {
  return mutateStore((s) => {
    const idx = s.repos.findIndex((x) => x.id === id);
    if (idx < 0) throw notFound('repo 不存在: ' + id);
    // 看板里同步摘引用（看板只存 id，登记没了就是死引用）
    for (const b of s.boards) b.repoIds = b.repoIds.filter((x) => x !== id);
    return s.repos.splice(idx, 1)[0];
  });
}

// id 或绝对路径均可定位（agent 场景常直接给路径）
export async function getRepo(idOrPath) {
  const s = await loadStore();
  let r = s.repos.find((x) => x.id === idOrPath);
  if (!r) {
    const p = resolve(idOrPath);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) throw notFound('repo 不存在: ' + idOrPath);
  // 带上它所属的看板（中心清单的同一份数据，单条查询也别缺这一维）
  const boards = s.boards
    .filter((b) => (b.repoIds || []).includes(r.id))
    .map((b) => ({ id: b.id, name: b.name, desc: b.desc || '' }));
  const { tags: _dropped, ...base } = r;
  return { ...base, boards };
}

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
    try {
      added.push(await addRepo({ path: p }));
    } catch {
      // 已登记，跳过
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
  const boardsOf = new Map();
  for (const b of s.boards) {
    for (const rid of b.repoIds || []) {
      if (!boardsOf.has(rid)) boardsOf.set(rid, []);
      boardsOf.get(rid).push({ id: b.id, name: b.name, desc: b.desc || '', note: (b.repoNotes || {})[rid] || '' });
    }
  }
  const map = new Map();
  for (const r of s.repos) {
    map.set(normalizePathKey(r.path), {
      id: r.id,
      name: r.name,
      path: r.path,
      desc: r.desc || '',
      notes: r.notes || '',
      boards: boardsOf.get(r.id) || [],
    });
  }
  return map;
}
