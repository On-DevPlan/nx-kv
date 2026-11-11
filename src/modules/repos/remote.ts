// remote 对齐 + clone 补齐：把「remote 是协作的标准单位」这件事做成可操作的。
//
// **为什么要有这一层**：key 是本地身份（归一化远程地址派生，或自定义），
// remote 是**协作的标准单位**（别人 clone 用的地址）。两者要对齐，但对齐方向
// 该由人定 —— 自动的「SSH 优先」只是默认值。所以这里提供：
//   - remote list：列出该仓库 `git remote -v` 的全部候选（origin/upstream/…）
//   - remote pick：人工指定采纳哪条（写入 remote，key 随之重算；自定义 key 不动）
//   - remote check：检查某个 remote 是否存在（git ls-remote，只读）
//   - clone：按 remote 克隆并登记（可指定 key —— 用于补齐导入留下的占位）
import { basename, join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { loadConfig } from '../../core/config.js';
import { badInput, conflict } from '../../core/errors.js';
import * as service from './service.js';
import { gitRemotes, gitLsRemote, gitClone, hasGit } from './git.js';
import type { RemoteInfo, RemoteKind } from './git.js';
import type { RepoEntry } from './repo/rows.js';
import type { RepoGetResult } from './service/crud.js';

const clean = (v: unknown): string => String(v || '').trim();

/** listRemotes 的一条候选。 */
export interface RemoteCandidate {
  name: string;
  url: string;
  kind: RemoteKind;
  current: boolean;
  derivedKey: string;
}

/** listRemotes 的返回。 */
export interface ListRemotesResult {
  key: string;
  name: string;
  path: string;
  current: string;
  remotes: RemoteCandidate[];
}

/** 该仓库的全部 remote 候选（git remote -v），标出当前采纳的那条。 */
export async function listRemotes(locator: unknown): Promise<ListRemotesResult> {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('请给仓库标识（id / key / 名称 / 路径）：repo remote list <仓库>');
  const r: RepoGetResult = await service.getRepo(raw);
  const remotes = await gitRemotes(r.path);
  const current = r.remote || '';
  return {
    key: r.key,
    name: r.name,
    path: r.path,
    current: current,
    remotes: remotes.map((x) => ({
      name: x.name,
      url: x.url,
      kind: x.kind,
      current: x.url === current,
      derivedKey: service.keyFromRemote(x.url),
    })),
  };
}

/** pickRemote 的返回。 */
export interface PickRemoteResult {
  key: string;
  keyCustom: boolean;
  remote: string;
  changed: boolean;
}

/**
 * 人工指定采纳哪条 remote。写入后：
 *   - 非自定义 key → 按新 remote 重算（身份跟着协作地址走）
 *   - 自定义 key   → 只更新 remote，key 不动（用户显式选的身份）
 */
export async function pickRemote(locator: unknown, url: unknown): Promise<PickRemoteResult> {
  const u = clean(url);
  if (!u) throw badInput('请给要采纳的远程地址（--url）');
  const r: RepoGetResult = await service.getRepo(locator);
  const known = await gitRemotes(r.path);
  if (known.length && !known.some((x) => x.url === u)) {
    // 允许采纳一条还没配到 git 里的地址（先登记，remote.add 自己补）
    const hint = known.map((x) => x.url).join('、');
    throw badInput(`该地址不在本仓库的 remote 列表里（现有：${hint || '无'}）—— 先在 git 里 add，或直接用 --url 强制采纳`);
  }
  const updated: RepoEntry = await service.updateRepo(r.id, { remote: u });
  return { key: updated.key, keyCustom: !!updated.keyCustom, remote: updated.remote, changed: true };
}

/** checkRemote 的返回（status/detail/branches 来自 gitLsRemote 的三态结论）。 */
export interface CheckRemoteResult {
  key: string;
  name: string;
  url: string;
  status: 'exists' | 'missing' | 'unreachable';
  detail: string;
  branches: string[];
}

/** 检查 remote 是否存在：exists / missing / unreachable 三种结论分清。 */
export async function checkRemote(locator: unknown, url: unknown): Promise<CheckRemoteResult> {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('请给仓库标识（id / key / 名称 / 路径）：repo remote check <仓库>');
  const r: RepoGetResult = await service.getRepo(raw);
  const target = clean(url) || r.remote || '';
  if (!target) return { key: r.key, name: r.name, url: '', status: 'unreachable', detail: '没有远程地址', branches: [] };
  const res = await gitLsRemote(target);
  return { key: r.key, name: r.name, url: target, ...res };
}

/** cloneRepo 的返回（filled = 补齐了导入留下的占位登记）。 */
export interface CloneRepoResult {
  key: string;
  name: string;
  path: string;
  remote: string;
  cloned: boolean;
  filled?: boolean;
}

/** cloneRepo 的参数。 */
export interface CloneRepoInput {
  remote?: unknown;
  key?: unknown;
  name?: string;
  desc?: string;
  notes?: string;
  type?: 'dev' | 'ref';
  depth?: number;
}

/**
 * 按 remote 克隆并登记。
 *   remote  远程地址
 *   key     显式指定 key —— **补齐导入留下的占位时用它**（占位 key 与新登记的
 *          key 相同 → 组里的位置自动转正）
 *   type    dev | ref（决定落到 gitDevRoot 还是 gitRepoRoot）
 */
export async function cloneRepo({ remote, key, name, desc, notes, type = 'dev', depth = 1 }: CloneRepoInput = {}): Promise<CloneRepoResult> {
  const url = clean(remote);
  if (!url) throw badInput('请给远程地址');
  const cfg = await loadConfig();
  const root = type === 'ref' ? clean(cfg.gitRepoRoot) : clean(cfg.gitDevRoot);
  if (!root) {
    throw badInput(
      type === 'ref'
        ? 'gitRepoRoot 未设置 —— 先 nx-kv setting set --gitRepoRoot <非C盘目录>'
        : 'gitDevRoot 未设置 —— 先 nx-kv setting set --gitDevRoot <目录>'
    );
  }
  // 已有登记的处理分两种：
  //   - 目录已存在 → 真的重复，报 conflict（别覆盖用户数据）
  //   - 目录不存在 → 导入时按占位登记的（路径是占位），clone 到预期位置**补齐它**
  //     （key 不变 → 组里的占位自动转正、位置与组内描述无缝生效）
  const s = await service.loadStore();
  const rkey = key ? service.normalizeKey(key) : service.keyFromRemote(url);
  const known = s.repos.find((r) => service.deriveKey(r) === rkey);
  if (known) {
    if (await hasGit(known.path)) {
      throw conflict(`该远程地址已登记为「${known.name}」（${known.key}）且目录在 —— 无需重复 clone，可用 repo ref sync 更新`);
    }
    // 占位登记：clone 到登记的路径（保持 key 与看板占位一致）
    await fsp.mkdir(join(known.path, '..'), { recursive: true });
    const used = await gitClone(url, known.path, { depth });
    const updated: RepoEntry = await service.updateRepo(known.id, {
      remote: used,
      remotes: [used],
      ...(desc !== undefined ? { desc } : {}),
    });
    return { key: updated.key, name: updated.name, path: updated.path, remote: used, cloned: true, filled: true };
  }

  await fsp.mkdir(root, { recursive: true });
  const dest = join(resolve(root), service.dirnameFromRemote(url));
  const used = await gitClone(url, dest, { depth });

  const repo: RepoEntry = await service.addRepo({
    path: dest,
    name: clean(name) || service.dirnameFromRemote(url),
    desc,
    notes,
    type: type === 'ref' ? 'ref' : 'dev',
    remote: used,
    // 显式给了 key 就用它（补占位）；没给就按 remote 派生
    ...(key ? { key: service.normalizeKey(key), keyCustom: true } : {}),
    remotes: [used],
  });
  return { key: repo.key, name: repo.name, path: repo.path, remote: used, cloned: true };
}

/** detectRemote 的返回（只读探测；目录/remote 缺失时推荐值为空）。 */
export interface DetectRemoteResult {
  path: string;
  exists: boolean;
  isGit: boolean;
  remotes: RemoteInfo[];
  recommended: string;
  key: string;
  name: string;
}

/**
 * 登记前探测：给一个**还没登记**的目录，读出它的 git remote，供面板自动填充。
 * 只读，不落任何东西；目录不存在 / 不是 git 仓库 / 没有 remote 都返回空推荐值，
 * 由调用方决定是提示还是让人手填（绝不猜一个地址出来）。
 *
 * 推荐顺序：origin 优先，其次第一条（与「SSH 优先」的默认值无关——这里只是读现状）。
 */
export async function detectRemote(rawPath: unknown): Promise<DetectRemoteResult> {
  const p = resolve(clean(rawPath));
  let exists = false;
  try { exists = (await fsp.stat(p)).isDirectory(); } catch { /* 不存在 */ }
  let isGit = false;
  if (exists) {
    try { isGit = (await fsp.stat(join(p, '.git'))).isDirectory() || (await fsp.stat(join(p, '.git'))).isFile(); } catch { /* 不是 git */ }
  }
  const remotes = exists && isGit ? await gitRemotes(p) : [];
  const pick = remotes.find((x) => x.name === 'origin') || remotes[0] || null;
  const url = pick ? pick.url : '';
  return {
    path: p,
    exists,
    isGit,
    remotes: remotes.map((x) => ({ name: x.name, url: x.url, kind: x.kind })),
    recommended: url,
    key: url ? service.keyFromRemote(url) : '',
    name: basename(p),
  };
}

/** remoteOverview 的一行。 */
export interface RemoteOverviewRow {
  key: string;
  name: string;
  type: string;
  path: string;
  current: string;
  candidates: Array<{ name: string; url: string; kind: RemoteKind; current: boolean }>;
}

/** remoteOverview 的返回。 */
export interface RemoteOverviewResult {
  repos: RemoteOverviewRow[];
  total: number;
}

/** 面板用：批量列出所有仓库的 remote 候选 + 当前采纳值（对齐 remote 的数据面）。 */
export async function remoteOverview(): Promise<RemoteOverviewResult> {
  const repos = await service.listRepos();
  const out: RemoteOverviewRow[] = [];
  for (const r of repos) {
    const remotes = await gitRemotes(r.path);
    out.push({
      key: r.key,
      name: r.name,
      type: r.type,
      path: r.path,
      current: r.remote || '',
      candidates: remotes.map((x) => ({ name: x.name, url: x.url, kind: x.kind, current: x.url === (r.remote || '') })),
    });
  }
  return { repos: out, total: out.length };
}
