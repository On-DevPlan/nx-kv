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
// git.js 的 pickRemote 是「候选里挑一条」（origin 优先、同名里 SSH 优先），
// 与本文件的 pickRemote（写入采纳值）重名，这里起别名。
import { gitRemotes, gitLsRemote, gitClone, hasGit, pickRemote as pickCandidate } from './git.js';

const clean = (v) => String(v || '').trim();

/** 该仓库的全部 remote 候选（git remote -v），标出当前采纳的那条。 */
export async function listRemotes(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('请给仓库标识（id / key / 名称 / 路径）：repo remote list <仓库>');
  const r = await service.getRepo(raw);
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
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('请给仓库标识（id / key / 名称 / 路径）：repo remote check <仓库>');
  const r = await service.getRepo(raw);
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
    const updated = await service.updateRepo(known.id, {
      remote: used,
      remotes: [used],
      ...(desc !== undefined ? { desc } : {}),
    });
    return { key: updated.key, name: updated.name, path: updated.path, remote: used, cloned: true, filled: true };
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

/**
 * 批量扫描：一次给齐**开发仓库**的 remote 现状与「可替换」建议。
 *
 * **为什么要有它**：以前每个仓库行各挂一个 remote 按钮，要对齐 40 个仓库就得点
 * 40 次弹窗、每次自己判断该换哪条。判断规则其实全在数据里（git remote -v +
 * 登记里采纳的那条 + key 派生），所以一次扫完、一次看完。
 *
 * **默认只扫开发仓库（type=dev）**：remote 对齐要解决的是「我自己这个 checkout 该以
 * 哪个地址作为协作身份」。参考仓库（type=ref）的 remote 是它 clone 的来源、也是它的
 * key，压根没有「换一条」的余地——把它们列进来只是几十行噪音，而它们的健康度另有
 * `repo ref check`（目录/.git/origin/绑定死链）。要看参考仓库得显式 `--type ref`，
 * 两类一起看是 `--type all`。
 *
 * 只读本地 git 配置（`git remote -v`），**不发网络请求**——所以快，可以每次开面板都跑。
 * 远端存在性（`git ls-remote`，每个要几秒）按需单独检查（checkRemote）。
 *
 * status（按「该不该动手」的优先级给一个结论）：
 *   offline     目录不是 git 仓库（或路径已不存在）——先修目录
 *   empty       有 git 但没有 remote —— 无可对齐
 *   ghost       登记的地址不在 git remote 里了 —— 登记悬空
 *   replaceable 有别的候选可采纳（默认建议 SSH 优先/origin 优先）
 *   ok          只有一条、就是当前这条
 */
export async function scanRemotes({ type = 'dev' } = {}) {
  const want = String(type || 'dev').trim();
  const repos = (await service.listRepos())
    .filter((r) => want === 'all' || (r.type || 'dev') === want);
  const rows = [];
  for (const r of repos) {
    const current = r.remote || '';
    const remotes = await gitRemotes(r.path);
    const isGit = await hasGit(r.path);
    const candidates = remotes.map((x) => ({
      name: x.name,
      url: x.url,
      kind: x.kind,
      current: x.url === current,
      derivedKey: service.keyFromRemote(x.url),
    }));
    // 建议采纳的那条：git.js 的 pickCandidate（origin 优先、同名里 SSH 优先）
    const pick = pickCandidate(remotes);
    const others = candidates.filter((c) => !c.current);
    const byKind = (x, y) => (x.kind === 'ssh' ? 0 : 1) - (y.kind === 'ssh' ? 0 : 1);
    const preferred = pick && pick.url !== current ? pick : (others.slice().sort(byKind)[0] || null);

    let status;
    let suggest = null;
    let reason = '';
    // 登记的地址还在不在 git 里 —— 这是「悬空」的判断依据
    const currentInGit = candidates.some((c) => c.current);
    if (!isGit) {
      status = 'offline';
      reason = '目录不是 git 仓库（或已不存在）';
    } else if (!remotes.length) {
      status = current ? 'ghost' : 'empty';
      reason = current ? '登记的地址已不在 git remote 里' : '没有配置任何 remote';
    } else if (current && !currentInGit) {
      status = 'ghost';
      reason = '登记的地址已不在 git remote 里（登记悬空）';
      suggest = preferred;
    } else if (!current) {
      status = 'empty';
      reason = '还没采纳任何 remote';
      suggest = preferred;
    } else if (preferred) {
      status = 'replaceable';
      reason = `另有 ${others.length} 条候选可换（${preferred.kind}）`;
      suggest = preferred;
    } else {
      status = 'ok';
      reason = '只有当前这一条，已对齐';
    }

    rows.push({
      id: r.id,
      key: r.key,
      keyCustom: !!r.keyCustom,
      name: r.name,
      type: r.type || 'dev',
      path: r.path,
      current,
      candidates,
      suggest: suggest ? { name: suggest.name, url: suggest.url, kind: suggest.kind } : null,
      status,
      reason,
    });
  }

  // 汇总：一眼知道「有几个要动」，面板按钮上直接显示
  const counts = { total: rows.length, ok: 0, replaceable: 0, empty: 0, ghost: 0, offline: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  // type 回传：CLI 的渲染与面板的标题都要说清「这是哪一类仓库的清单」
  return { repos: rows, counts, total: rows.length, type: want };
}

/** 批量对齐：把给定的 [{key|id, url}] 逐条落盘（复用 pickRemote 的语义）。 */
export async function alignRemotes({ items } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw badInput('没有要对齐的条目');
  const done = [];
  const failed = [];
  for (const it of list) {
    const locator = String((it && (it.id || it.key)) || '').trim();
    const url = clean(it && it.url);
    if (!locator || !url) { failed.push({ locator, url, error: '缺少仓库标识或地址' }); continue; }
    try {
      done.push(await pickRemote(locator, url));
    } catch (err) {
      failed.push({ locator, url, error: String(err.message || err) });
    }
  }
  return { aligned: done.length, failed, total: list.length };
}

/** 面板用：批量列出所有仓库的 remote 候选 + 当前采纳值（= scanRemotes 的旧名） */
export const remoteOverview = scanRemotes;
