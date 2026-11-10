// 参考仓库（type=ref）service：克隆、登记、绑定、同步、检查。
//
// **定位**：mmx-research-gitclone 的整体吸纳（2026-10-27）。以前参考仓库散落在各项目的
// `.claude/repo/` 下、用文本清单（.claude/www/git.remote）登记——副本分散、换机同步麻烦、
// 与分组毫无关联。现在参考仓库与开发仓库同住中心清单（type 区分），clone 落到用户自设的
// gitRepoRoot（**刻意不默认任何路径**——用户必须显式指一个非 C 盘目录），绑定关系挂在
// linked 上（指向开发仓库或看板），导出导入走 transfer.js 的 v2 布局（remote 为 key）。
//
// 本文件不含传输层概念；git 的实际调用都在 git.js。
import { basename, join, resolve } from 'node:path';
import fsp from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../../core/config.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import * as service from './service.js';
import { gitClone, gitPull, gitOrigin, hasGit } from './git.js';

const isRemoteUrl = (u) => /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/i.test(String(u || '').trim());

/** 参考仓库存储根（config.gitRepoRoot）；未设置 = 显式报错，绝不默默落进 homedir。 */
export async function requireRepoRoot() {
  const cfg = await loadConfig();
  const root = String(cfg.gitRepoRoot || '').trim();
  if (!root) {
    throw badInput(
      '参考仓库存储根未设置 —— 先给一个非 C 盘目录: nx-kv setting set --gitRepoRoot <目录>'
    );
  }
  return resolve(root);
}

/**
 * clone 目标目录：URL 基名；已存在且 origin key 不同 → 追加 -<hash6> 保证确定性不撞车。
 * 同名同源（目录已在，origin key 相同）→ null：调用方按「已 clone 过」处理。
 */
async function destFor(root, url) {
  const base = service.dirnameFromRemote(url);
  const key = service.normalizeRemoteKey(url);
  let dest = join(root, base);
  if (!(await exists(dest))) return dest;
  if (service.normalizeRemoteKey(await gitOrigin(dest)) === key) return null; // 已 clone 过同源
  dest = join(root, base + '-' + createHash('sha256').update(key).digest('hex').slice(0, 6));
  if (await exists(dest)) throw conflict('目标目录已存在且无法确定来源: ' + dest);
  return dest;
}

async function exists(p) {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

// 定位 ref：id / key / 名称 / remoteKey 都能认（agent 场景常直接给 URL 或名字）。
async function findRef(idOrNameOrUrl) {
  const raw = String(idOrNameOrUrl || '').trim();
  if (!raw) throw badInput('缺少参考仓库标识（id / key / 名称 / 远程地址）');
  const s = await service.loadStore();
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = service.normalizeKey(raw);
    if (k) r = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!r) r = s.repos.find((x) => (x.remote && service.normalizeRemoteKey(x.remote)) === service.normalizeRemoteKey(raw));
  if (!r) r = await service.findRepoByName(raw);
  if (!r) throw notFound('参考仓库不存在: ' + raw);
  return r;
}

async function loadRef(id) {
  const r = await findRef(id);
  if ((r.type || 'dev') !== 'ref') throw conflict(`「${r.name}」不是参考仓库（type=dev）——绑定/同步只对 ref 有意义`);
  return r;
}

/**
 * 克隆并登记参考仓库。
 *   url     远程地址（唯一 key）
 *   board   看板 id（可同时给多个，数组）——顺手挂归属
 *   bind    绑定的开发仓库（id/路径/名称，可多个，数组）
 *   noBind  关掉 autoBind（CLI 上在开发仓库目录里跑时默认绑当前目录的仓库）
 */
export async function cloneRef({ url, name, desc, notes, board, bind, depth = 1, noBind } = {}) {
  const remote = String(url || '').trim();
  if (!isRemoteUrl(remote)) throw badInput('请给远程 git 地址（git@… / https://…）: ' + remote);
  const root = await requireRepoRoot();
  await fsp.mkdir(root, { recursive: true });

  // 已登记同源 → 不重复 clone，直接说明
  const s0 = await service.loadStore();
  const rkey = service.normalizeRemoteKey(remote);
  const known = s0.repos.find((x) => service.normalizeRemoteKey(x.remote || '') === rkey);
  if (known) {
    throw conflict(`该远程地址已登记为「${known.name}」(${known.id}) —— 无需重复 clone，可用 repo ref sync 更新`);
  }

  const dest = await destFor(root, remote);
  if (!dest) throw conflict(`gitRepoRoot 下已存在同源目录: ${join(root, service.dirnameFromRemote(remote))} —— 请用 repo ref add 登记`);

  const usedUrl = await gitClone(remote, dest, { depth });
  const repo = await service.addRepo({
    path: dest,
    name: (name || '').trim() || basename(dest),
    desc,
    notes,
    type: 'ref',
    remote: usedUrl, // 登记实际成功的那条 URL（SSH 挂了回退 HTTPS 时以 HTTPS 为准）
  });

  // 绑定：显式 --board / --bind，加上 autoBind（当前目录命中的开发仓库）
  // 目标一律按 **key** 传给 bindTarget（它内部会再解析一次，id/路径/名称都认）
  const targets = [];
  const boardIds = Array.isArray(board) ? board : board ? [board] : [];
  for (const b of boardIds) targets.push({ kind: 'board', id: String(b).trim() });
  const bindIds = Array.isArray(bind) ? bind : bind ? [bind] : [];
  for (const b of bindIds) targets.push({ kind: 'repo', id: String(b).trim() });
  if (!noBind) {
    const ctx = await service.contextForPath(process.cwd());
    if (ctx && ctx.key !== service.deriveKey(repo)) targets.push({ kind: 'repo', id: ctx.key });
  }
  const boundGroups = [];
  const boundRepos = [];
  for (const t of targets) {
    const arg = t.kind === 'board' ? { board: t.id } : { repo: t.id };
    const r = await bindTarget({ id: repo.id, ...arg }).catch(() => null); // 单个目标失效不拖垮整体
    if (r && Array.isArray(r.addedGroups)) boundGroups.push(...r.addedGroups);
    if (r && Array.isArray(r.addedRepos)) boundRepos.push(...r.addedRepos);
  }
  return {
    ...repo,
    linked: targets,
    groups: [...new Set(boundGroups)],
    repos: [...new Set(boundRepos)],
    cloned: true,
    url: usedUrl,
    dest,
  };
}

/** 登记一个已存在的 checkout 为参考仓库（不 clone）。remote 缺省时读目录 origin。 */
export async function registerRef({ path, remote, name, desc, notes } = {}) {
  const abs = resolve(String(path || ''));
  if (!(await hasGit(abs))) throw badInput('该目录不是 git 仓库（没有 .git）: ' + abs);
  const url = String(remote || '').trim() || (await gitOrigin(abs));
  if (!url) throw badInput('目录没有 origin，且未给 --remote —— 参考仓库必须带远程地址（它是唯一 key）');
  return service.addRepo({ path: abs, name, desc, notes, type: 'ref', remote: url });
}

// mutateStore 的 fn 是同步的——所以绑定里的目标解析用同步变体（store 已在手）。
// 目标一律解析成 **key**（身份），不再用随机 id。
function repoKeyInside(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = service.normalizeKey(raw);
    if (k) r = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return r ? service.deriveKey(r) : null;
}

function boardKeyInside(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
  let b = s.boards.find((x) => x.id === raw);
  if (!b) {
    const k = service.normalizeKey(raw);
    if (k) b = s.boards.find((x) => service.storedBoardKey(x) === k);
  }
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return b ? service.storedBoardKey(b) : null;
}

/** 仓库属于哪些组（组级绑定的一条来源；与仓库级绑定并存）。 */
function groupsOfRepo(s, repoKey) {
  return s.boards.filter((b) => service.boardRepoKeys(b, s).includes(repoKey));
}

/**
 * 仓库身上的**直接**参考绑定（仓库级，存在 dev.ext.ext_linked 里）。
 * 这类绑定不经过组、也不继承：组级与仓库级是两条并列的关系。
 */
function directLinksOfRepo(s, repo) {
  const byKey = new Map(
    s.repos.filter((r) => (r.type || 'dev') === 'ref').map((r) => [service.deriveKey(r), r])
  );
  return (repo.linked || [])
    .filter((l) => l && l.kind === 'ref')
    .map((l) => {
      const r = byKey.get(String(l.id));
      return r ? { ref: r, note: String(l.note || '') } : null;
    })
    .filter(Boolean);
}

/** 参考仓库行 → 对外投影。 */
function projectRef(r) {
  return {
    id: r.id,
    key: service.deriveKey(r),
    name: r.name,
    desc: r.desc || '',
    remote: r.remote || '',
    path: r.path,
    note: '',
  };
}

/** 看板对象的 refs（group_refs）→ [{ref, note}]；已不存在的 ref 行跳过。 */
function linksOfBoard(s, b) {
  const byKey = new Map(
    s.repos.filter((r) => (r.type || 'dev') === 'ref').map((r) => [service.deriveKey(r), r])
  );
  return (b.refs || [])
    .map((l) => {
      const r = byKey.get(String(l.id));
      return r ? { ref: r, note: String(l.note || '') } : null;
    })
    .filter(Boolean);
}

/**
 * 绑定/摘除：ref → 组 与/或 ref → 单个开发仓库。两类绑定**并存、互不折算**：
 *   --board b   写组级绑定（group_refs），组内仓库共享
 *   --repo x    写仓库级绑定（dev.ext.ext_linked），只有这个仓库拥有
 * 两个都给 = 同时建立两条关系；同一个 ref 在同一个仓库上既是组员级又是仓库级时，
 * 两处都会保留（它们表达的是不同来源的关系，读取侧分开展示）。
 * note（绑定描述）跟各自的绑定走。
 * 摘除用 remove + 维度（--repo x 只摘仓库级；--board x 只摘组级；都不带 = 全部摘除）。
 */
export async function bindTarget({ id, key, repo, board, remove } = {}) {
  const ref = await loadRef(id || key);
  // 归一输入：字符串数组 → [{id}]；{id, note} 对象数组原样收
  const normTargets = (v) =>
    (Array.isArray(v) ? v : v ? [v] : [])
      .map((t) => (typeof t === 'object' && t !== null ? { id: String(t.id || '').trim(), note: String(t.note || '').trim() } : { id: String(t || '').trim(), note: '' }))
      .filter((t) => t.id);
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => x.id === ref.id);
    const refKey = service.deriveKey(r);
    const boards = normTargets(board);
    const repos = normTargets(repo);

    const boardTargets = new Map(); // boardKey → note
    for (const one of boards) {
      const bkey = boardKeyInside(s, one.id);
      if (!bkey) throw notFound('看板不存在: ' + one.id);
      if (!boardTargets.has(bkey) || one.note) boardTargets.set(bkey, one.note);
    }
    const repoTargets = new Map(); // repoKey → note
    for (const one of repos) {
      const rkey = repoKeyInside(s, one.id);
      if (!rkey) throw notFound('绑定的开发仓库不存在: ' + one.id);
      const dev = s.repos.find((x) => service.deriveKey(x) === rkey);
      if ((dev.type || 'dev') === 'ref') {
        throw badInput(`「${dev.name}」是参考仓库 —— 绑定目标只能是开发仓库或组`);
      }
      if (!repoTargets.has(rkey) || one.note) repoTargets.set(rkey, one.note);
    }
    if (!boardTargets.size && !repoTargets.size && !remove) {
      throw badInput('请给 --repo <开发仓库> 或 --board <看板>（或 --remove 摘除）');
    }

    if (remove) {
      let n = 0;
      // 给了维度就只摘该维度；两个维度都没给 = 全部摘除（组 + 仓库）
      const all = !boardTargets.size && !repoTargets.size;
      const boardKeys = boardTargets.size
        ? [...boardTargets.keys()]
        : all
          ? s.boards.map((b) => service.storedBoardKey(b))
          : [];
      const repoKeys = repoTargets.size
        ? [...repoTargets.keys()]
        : all
          ? s.repos.filter((x) => (x.type || 'dev') !== 'ref').map((x) => service.deriveKey(x))
          : [];
      for (const bkey of boardKeys) {
        const b = s.boards.find((x) => service.storedBoardKey(x) === bkey);
        if (!b) continue;
        const before = (b.refs || []).length;
        b.refs = (b.refs || []).filter((l) => l.id !== refKey);
        n += before - b.refs.length;
      }
      for (const rkey of repoKeys) {
        const dev = s.repos.find((x) => service.deriveKey(x) === rkey);
        if (!dev || !Array.isArray(dev.linked)) continue;
        const before = dev.linked.length;
        dev.linked = dev.linked.filter((l) => !(l && l.kind === 'ref' && String(l.id) === refKey));
        n += before - dev.linked.length;
      }
      return {
        key: refKey,
        name: r.name,
        removed: true,
        count: n,
        groups: boardTargets.size,
        repos: repoTargets.size,
      };
    }

    const addedGroups = [];
    for (const [bkey, note] of boardTargets) {
      const b = s.boards.find((x) => service.storedBoardKey(x) === bkey);
      if (!b) continue;
      if (!Array.isArray(b.refs)) b.refs = [];
      const hit = b.refs.find((l) => l.id === refKey);
      if (!hit) {
        b.refs.push(note ? { id: refKey, note } : { id: refKey });
        addedGroups.push(b.name);
      } else if (note) {
        hit.note = note;
      }
    }
    const addedRepos = [];
    for (const [rkey, note] of repoTargets) {
      const dev = s.repos.find((x) => service.deriveKey(x) === rkey);
      if (!dev) continue;
      if (!Array.isArray(dev.linked)) dev.linked = [];
      const hit = dev.linked.find((l) => l && l.kind === 'ref' && String(l.id) === refKey);
      if (!hit) {
        dev.linked.push(note ? { kind: 'ref', id: refKey, note } : { kind: 'ref', id: refKey });
        addedRepos.push(dev.name);
      } else if (note) {
        hit.note = note;
      }
    }
    return {
      key: refKey,
      name: r.name,
      removed: false,
      addedGroups,
      addedRepos,
      groups: boardTargets.size,
      repos: repoTargets.size,
    };
  });
}

/**
 * 绑定描述：这条绑定「参考什么」。note 留空 = 清除。
 *   --board b  写组级绑定（group_refs）的描述
 *   --repo x   写仓库级绑定（dev.ext.ext_linked）的描述
 * 两者只能选一个（一条绑定一条描述）；目标关系不存在时显式报错。
 */
export async function setLinkNote({ id, key, repo, board, note } = {}) {
  const ref = await loadRef(id || key);
  if (!repo && !board) throw badInput('请给 --repo <开发仓库> 或 --board <看板>');
  if (repo && board) throw badInput('--repo 与 --board 只能选一个（一条绑定一条描述）');
  const text = String(note || '').trim();
  return service.mutateStore((s) => {
    const r = s.repos.find((x) => x.id === ref.id);
    const refKey = service.deriveKey(r);
    if (board) {
      const bkey = boardKeyInside(s, board);
      if (!bkey) throw notFound('看板不存在: ' + board);
      const b = s.boards.find((x) => service.storedBoardKey(x) === bkey);
      const link = (b.refs || []).find((l) => l.id === refKey);
      if (!link) {
        throw conflict(`「${ref.name}」未绑定到组「${b.name}」—— 先 repo bind ${ref.id} --board ${bkey}`);
      }
      if (text) link.note = text;
      else delete link.note;
      return { key: refKey, name: r.name, group: b.name, note: text };
    }
    const rkey = repoKeyInside(s, repo);
    if (!rkey) throw notFound('绑定的开发仓库不存在: ' + repo);
    const dev = s.repos.find((x) => service.deriveKey(x) === rkey);
    if ((dev.type || 'dev') === 'ref') {
      throw badInput(`「${dev.name}」是参考仓库 —— 仓库级绑定描述只挂在开发仓库上`);
    }
    const link = (dev.linked || []).find((l) => l && l.kind === 'ref' && String(l.id) === refKey);
    if (!link) {
      throw conflict(`「${ref.name}」未直接绑定到仓库「${dev.name}」—— 先 repo bind ${ref.id} --repo ${rkey}`);
    }
    if (text) link.note = text;
    else delete link.note;
    return { key: refKey, name: r.name, repo: dev.name, note: text };
  });
}

/**
 * 「这个本地仓库有哪些参考仓库」：两类来源**并列**给出，互不折算。
 *   direct  直接绑在这个仓库上的参考（仓库级，dev.ext.ext_linked）
 *   boards  它所属组绑定的参考（组级，group_refs，组内共享）
 * 同一个 ref 同时出现在两处是合法的（两条关系都真实存在），读取侧不合并。
 * 返回 { repo, direct: [...], boards: [{id,key,name,desc,refRepos:[...]}] }
 */
export async function refReposOfRepo(idOrPathOrName) {
  const s = await service.loadStore();
  const raw = String(idOrPathOrName || '').trim();
  if (!raw) throw badInput('缺少仓库标识（id / key / 绝对路径 / 名称）');
  let repo = s.repos.find((x) => x.id === raw);
  if (!repo) {
    const k = service.normalizeKey(raw);
    if (k) repo = s.repos.find((x) => service.deriveKey(x) === k);
  }
  if (!repo) {
    const p = resolve(raw);
    repo = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!repo) repo = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!repo) throw notFound('repo 不存在: ' + raw);

  const repoKey = service.deriveKey(repo);
  const groups = groupsOfRepo(s, repoKey);
  const boardsOut = groups.map((b) => ({
    id: b.id,
    key: service.storedBoardKey(b),
    name: b.name,
    desc: b.desc || '',
    refRepos: linksOfBoard(s, b).map(({ ref, note }) => ({ ...projectRef(ref), note })),
  }));

  // 仓库级直接绑定：与组无关，永远原样回显（组级结果不覆盖它）
  const direct = directLinksOfRepo(s, repo).map(({ ref, note }) => ({ ...projectRef(ref), note }));

  return {
    repo: { id: repo.id, key: repoKey, name: repo.name, path: repo.path, desc: repo.desc || '' },
    direct,
    boards: boardsOut,
  };
}

/** 同步单个 ref（git pull --ff-only）；不存在的目录如实报告，不静默。 */
export async function syncRef(id) {
  const ref = await loadRef(id);
  if (!(await exists(ref.path))) {
    return { id: ref.id, name: ref.name, status: 'missing', output: '本地目录不存在: ' + ref.path };
  }
  const { status, output } = await gitPull(ref.path);
  return { id: ref.id, name: ref.name, status, output };
}

/** 同步全部参考仓库（逐条给结果，单条失败不断链）。 */
export async function syncAllRefs() {
  const s = await service.loadStore();
  const refRepos = s.repos.filter((r) => (r.type || 'dev') === 'ref');
  const results = [];
  for (const r of refRepos) {
    results.push(await syncRef(r.id).catch((err) => ({ id: r.id, name: r.name, status: 'error', output: String(err.message || err) })));
  }
  return { synced: results.length, results };
}

/**
 * 完整性检查（零副作用）：ref 的本地目录 / .git / origin 与登记的 remote 一致性，
 * 以及两类绑定（组级 group_refs、仓库级 dev.ext.ext_linked）的目标是否都存在。
 */
export async function checkRefs() {
  const s = await service.loadStore();
  const refRepos = s.repos.filter((r) => (r.type || 'dev') === 'ref');
  const refKeys = new Set(refRepos.map((r) => service.deriveKey(r)));
  const groupByRef = new Map(); // refKey → [{key,name,note}]
  const extraIssues = [];
  for (const b of s.boards) {
    const bkey = service.storedBoardKey(b);
    for (const l of b.refs || []) {
      if (!refKeys.has(String(l.id))) {
        extraIssues.push(`组「${b.name}」(${bkey}) 绑定的参考仓库 ${l.id} 已不存在 —— 用 repo bind --remove 摘除`);
        continue;
      }
      if (!groupByRef.has(l.id)) groupByRef.set(l.id, []);
      groupByRef.get(l.id).push({ key: bkey, name: b.name, note: l.note || '' });
    }
  }
  // 仓库级直接绑定（与组级并存）：按 ref 归集，死链单独报出来
  const repoByRef = new Map(); // refKey → [{key,name,note}]
  for (const d of s.repos) {
    if ((d.type || 'dev') === 'ref') continue;
    const dkey = service.deriveKey(d);
    for (const l of d.linked || []) {
      if (!l || l.kind !== 'ref') continue;
      const id = String(l.id);
      if (!refKeys.has(id)) {
        extraIssues.push(`仓库「${d.name}」(${dkey}) 绑定的参考仓库 ${id} 已不存在 —— 用 repo bind --remove --repo ${dkey} 摘除`);
        continue;
      }
      if (!repoByRef.has(id)) repoByRef.set(id, []);
      repoByRef.get(id).push({ key: dkey, name: d.name, note: l.note || '' });
    }
  }
  const out = [];
  for (const r of refRepos) {
    const issues = [];
    const dirExists = await exists(r.path);
    if (!dirExists) issues.push('本地目录不存在: ' + r.path);
    else if (!(await hasGit(r.path))) issues.push('目录不是 git 仓库（没有 .git）');
    else {
      const origin = await gitOrigin(r.path);
      if (!origin) issues.push('没有 origin —— 无法同步（可 repo remote 重设）');
      else if (service.normalizeRemoteKey(origin) !== service.normalizeRemoteKey(r.remote || '')) {
        issues.push(`origin 与登记不一致: origin=${origin} 登记=${r.remote}`);
      }
    }
    out.push({
      id: r.id,
      name: r.name,
      path: r.path,
      remote: r.remote || '',
      ok: issues.length === 0,
      issues,
      groups: groupByRef.get(service.deriveKey(r)) || [],
      repos: repoByRef.get(service.deriveKey(r)) || [],
    });
  }
  return {
    refRepos: out,
    total: refRepos.length,
    problems: out.filter((x) => !x.ok).length + extraIssues.length,
    extraIssues,
  };
}

/** 看板 → 绑定在该组上的参考仓库清单（组内共享，无继承）。 */
export async function refReposOfBoard(boardIdOrKey) {
  const s = await service.loadStore();
  const raw = String(boardIdOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => service.storedBoardKey(x) === service.normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  const bkey = service.storedBoardKey(b);
  return {
    board: { id: b.id, key: bkey, name: b.name },
    refRepos: linksOfBoard(s, b).map(({ ref, note }) => ({ ...projectRef(ref), note })),
  };
}
