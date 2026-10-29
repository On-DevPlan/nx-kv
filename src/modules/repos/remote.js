// remote 对齐 + clone 补齐：把「remote 是协作的标准单位」这件事做成可操作的。
//
// **为什么要有这一层**：key 是本地身份（归一化远程地址派生，或自定义），
// remote 是**协作的标准单位**（别人 clone 用的地址）。两者要对齐，但对齐方向
// 该由人定 —— 自动的「SSH 优先」只是默认值。所以这里提供：
//   - remote list：列出该仓库 `git remote -v` 的全部候选（origin/upstream/…）
//   - remote pick：人工指定采纳哪条（写入 remote，key 随之重算；自定义 key 不动）
//   - remote check：检查某个 remote 是否存在（git ls-remote，只读）
//   - clone：按 remote 克隆并登记（可指定 key —— 用于补齐导入留下的占位）
import { join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { loadConfig } from '../../core/config.js';
import { badInput, conflict } from '../../core/errors.js';
import * as service from './service.js';
import { gitRemotes, gitLsRemote, gitClone } from './git.js';

const clean = (v) => String(v || '').trim();

/** 该仓库的全部 remote 候选（git remote -v），标出当前采纳的那条。 */
export async function listRemotes(locator) {
  const r = await service.getRepo(locator);
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

/**
 * 人工指定采纳哪条 remote。写入后：
 *   - 非自定义 key → 按新 remote 重算（身份跟着协作地址走）
 *   - 自定义 key   → 只更新 remote，key 不动（用户显式选的身份）
 */
export async function pickRemote(locator, url) {
  const u = clean(url);
  if (!u) throw badInput('请给要采纳的远程地址（--url）');
  const r = await service.getRepo(locator);
  const known = await gitRemotes(r.path);
  if (known.length && !known.some((x) => x.url === u)) {
    // 允许采纳一条还没配到 git 里的地址（先登记，remote.add 自己补）
    const hint = known.map((x) => x.url).join('、');
    throw badInput(`该地址不在本仓库的 remote 列表里（现有：${hint || '无'}）—— 先在 git 里 add，或直接用 --url 强制采纳`);
  }
  const updated = await service.updateRepo(r.id, { remote: u });
  return { key: updated.key, keyCustom: !!updated.keyCustom, remote: updated.remote, changed: true };
}

/** 检查 remote 是否存在：exists / missing / unreachable 三种结论分清。 */
export async function checkRemote(locator, url) {
  const r = await service.getRepo(locator);
  const target = clean(url) || r.remote || '';
  if (!target) return { key: r.key, name: r.name, url: '', status: 'unreachable', detail: '没有远程地址', branches: [] };
  const res = await gitLsRemote(target);
  return { key: r.key, name: r.name, url: target, ...res };
}

/**
 * 按 remote 克隆并登记。
 *   remote  远程地址
 *   key     显式指定 key —— **补齐导入留下的占位时用它**（占位 key 与新登记的
 *          key 相同 → 组里的位置自动转正）
 *   type    dev | ref（决定落到 gitDevRoot 还是 gitRepoRoot）
 */
export async function cloneRepo({ remote, key, name, desc, notes, type = 'dev', depth = 1 } = {}) {
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
  // 已有登记（同 remote key）→ 不重复 clone
  const s = await service.loadStore();
  const rkey = service.keyFromRemote(url);
  const known = s.repos.find((r) => service.deriveKey(r) === rkey || (key && service.deriveKey(r) === service.normalizeKey(key)));
  if (known) {
    throw conflict(`该远程地址已登记为「${known.name}」（${known.key}）—— 无需重复 clone，可用 repo ref sync 更新`);
  }

  await fsp.mkdir(root, { recursive: true });
  const dest = join(resolve(root), service.dirnameFromRemote(url));
  const used = await gitClone(url, dest, { depth });

  const repo = await service.addRepo({
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

/** 面板用：批量列出所有仓库的 remote 候选 + 当前采纳值（对齐 remote 的数据面）。 */
export async function remoteOverview() {
  const repos = await service.listRepos();
  const out = [];
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
