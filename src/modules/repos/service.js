// 仓库上下文 service：登记、CRUD、目录扫描。
//
// **来历**：这套东西原本长在 nx-rh（`src/modules/repos/`），2026-10-23 整体迁到 nx-kv
// （远程清单 topic=goal 的 #72）：仓库登记是**本机事实**（路径、标签、描述），
// 它的价值是给「本地任务管理」当上下文——agent 领到任务时就知道这条任务属于哪个仓库、
// 周围关联着哪些看板。所以它跟着任务走，而不是跟着另一个工具走。
//
// 本文件是业务真相源，不含任何传输层概念（不认识 argv，也不认识 HTTP）。
// git 边界（2026-10-27 收紧为两条）：开发仓库（type=dev）不碰 git——状态/diff/pull/push
// 一律不做（git 客户端是无底洞）；参考仓库（type=ref）只做 clone/pull/读 origin 三件事
// （见 git.js / ref.js）——它的价值就是「把远程仓库抓到本机参考并保持新鲜」。
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
    const store = {
      version: 1,
      repos: Array.isArray(data.repos) ? data.repos : [],
      boards: Array.isArray(data.boards) ? data.boards : [],
    };
    // 老结构（看板成员存随机 id）→ 新结构（存 key）：读时改写并落盘。
    // 放这里 = 唯一入口，任何读路径都自动看到迁移后的数据。
    if (migrateStoreKeys(store)) {
      await saveStore(store).catch(() => {});
    }
    return store;
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
//
// type 双态（2026-10-27 吸纳 mmx-research-gitclone）：
//   dev（缺省，旧数据兼容）= 本机开发的仓库；ref = 远程 clone 下来的参考仓库。
//   ref 的唯一 key 是 remote（归一化后的远程地址），dev 也鼓励记 remote（导出时
//   导远程地址而非本地路径——换机导入才 clone 得回来）。
// linked 仅 ref 有：绑定目标 [{kind:'repo'|'board', id}]——「这个参考是给谁看的」。
function normalizeRepoInput({ path, name, notes, desc, type, remote, linked, key, keyCustom, remotes }) {
  const abs = resolve(String(path || ''));
  const t = type === 'ref' ? 'ref' : 'dev';
  const nm = (name || basename(abs) || 'repo').trim();
  const rk0 = key ? normalizeKey(key) : '';
  if (key && !rk0) throw badInput('key 不合法: ' + key);
  // 显式给了 key = 视为自定义（与 updateRepo 同一语义：key 是用户声明的身份，
  // 不跟随 remote 漂移）——导入布局时布局里的 key 就是这样固化下来的。
  const rk = rk0 && (keyCustom || rk0 !== deriveKey({ name: nm, remote: (remote || '').trim() }));
  const input = {
    name: nm,
    remote: (remote || '').trim(),
    key,
    keyCustom: !!keyCustom,
    remotes,
  };
  const finalKey = rk0 || deriveKey({ ...input, name: nm });
  if (!finalKey) throw badInput('key 不能为空');
  return {
    id: newId('r'),
    name: nm,
    path: abs,
    desc: (desc || '').trim(),
    notes: (notes || '').trim(),
    type: t,
    key: finalKey,
    keyCustom: !!rk,
    remote: input.remote,
    remotes: Array.isArray(remotes) ? remotes.map((x) => String(x).trim()).filter(Boolean) : [],
    keyUpdatedAt: new Date().toISOString(),
    // ref 侧的 linked 指向 repo/board；dev 侧的 linked 是反向的 {kind:'ref'} 引用
    linked: sanitizeLinks(linked),
    addedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// 绑定目标的形状收敛：只认 {kind, id, note?}，其余丢弃、去重。
// kind 三种：
//   'repo'  = 绑到某个开发仓库（写在 **ref 侧**）
//   'board' = 绑到某个看板（写在 **ref 侧**）
//   'ref'   = 反向引用（写在 **dev 侧**：这个仓库挂了哪些参考）
// 绑定是**双向记录**的：ref 侧写 {repo|board, id}，dev 侧写 {ref, id}。
// 为什么双向：绑定关系是两类仓库之间的连接，只有 ref 侧记的话，dev 仓库
// 自己就"不知道自己挂了参考"——列清单、查上下文都得反向扫描 ref 全表。
// note（绑定描述）随关系走，两侧各存一份同一内容。
// 不在这里校验目标是否存在——那是 bind/check 的职责，登记时目标可能还没登记。
function sanitizeLinks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const out = [];
  for (const l of list) {
    const kind = l && (l.kind === 'board' ? 'board' : l.kind === 'repo' ? 'repo' : l.kind === 'ref' ? 'ref' : null);
    const id = kind ? String(l.id || '').trim() : '';
    if (!kind || !id) continue;
    const key = kind + ':' + id;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = String((l && l.note) || '').trim();
    out.push(note ? { kind, id, note } : { kind, id });
  }
  return out;
}

// ─── 全局唯一 key：仓库的身份 ──────────────────────────────────────────
//
// 本地路径是机器事实，换机必失效；远程地址是最好的身份来源，但同一个仓库有 N 种
// 写法（git@github.com:me/x.git、https://github.com/me/x、ssh://git@ssh.github.com:443/me/x.git、
// 大小写不同、带不带尾斜杠）——全部归一成同一个 key，导入导出才能精确映射。
//
// 归一化步骤：
//   1. git@host:path            → host/path
//   2. ssh://[user@]host[:port]/path → host/path（丢 user 与端口）
//   3. https?://[user@]host/path     → host/path（丢 user 与端口）
//   4. 去尾 /、去 .git、小写
//   5. host 别名：ssh.github.com / www.github.com → github.com
//      （GitHub 的 SSH-over-443 端点，指向同一个仓库）
export function keyFromRemote(url) {
  let s = String(url || '').trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  // git@host:path（scp 语法）
  const scp = /^git@([^:/]+):(.+)$/i.exec(s);
  if (scp) s = scp[1] + '/' + scp[2];
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // 有协议的：剥协议 → [user@]host[:port]/path
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    s = s.replace(/^[^/]*@/, '');        // 丢 user@
    s = s.replace(/^([^/]+?):\d+(\/|$)/, '$1$2'); // 丢 :port（只认紧跟 host 的那个冒号）
    // file:///D:/path 这类本地 URL：盘符冒号也要丢（key 里不允许 `:`——
    // normalizeKey 会把它压成 -，两边不一致就会「登记的是 A、成员表里是 B」）
    s = s.replace(/^([a-z]):/i, '$1');
  }
  s = s.replace(/\.git$/i, '');
  s = s.replace(/\/{2,}/g, '/');
  const hostAlias = { 'ssh.github.com': 'github.com', 'www.github.com': 'github.com' };
  const slash = s.indexOf('/');
  if (slash > 0) {
    const host = s.slice(0, slash).toLowerCase();
    s = (hostAlias[host] || host) + s.slice(slash);
  }
  return s.toLowerCase();
}

// 兼容旧调用点（ref.js / transfer.js 都在用这个名字）
export const normalizeRemoteKey = keyFromRemote;

// 自定义 key 归一：允许中文与 `/`（像命名空间），其余空白/非法字符压成 -。
// 空 key 不合法——key 是身份，不能空。
export function normalizeKey(k) {
  const s = String(k || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '-')
    .replace(/\.git$/i, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 160);
  return s.toLowerCase();
}

// 无 remote 时的兜底 key：local/<slug>。slug 保留可读性（中文也行）。
export function localKeyOf(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f/]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return 'local/' + (slug || 'repo');
}

/** 一个仓库的 key：自定义优先，其次 remote 派生，最后 local/<name> 兜底。 */
export function deriveKey(repo) {
  if (!repo) return '';
  if (repo.keyCustom && repo.key) return normalizeKey(repo.key);
  const fromRemote = keyFromRemote(repo.remote || '');
  if (fromRemote) return fromRemote;
  if (repo.key) return normalizeKey(repo.key);
  return localKeyOf(repo.name);
}

// 从 URL 推导目录名：取末段、剥 .git。非法字符替换成 -（Windows 目录名约束）。
export function dirnameFromRemote(url) {
  const key = keyFromRemote(url);
  const base = key.split('/').filter(Boolean).pop() || 'repo';
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'repo';
}

// 看板的 key（board/<slug(name)>）。看板改名时 key 跟随（看板没有自定义 key 的概念）。
export function boardKeyOf(name) {
  return 'board/' + localKeyOf(name).slice('local/'.length);
}

/**
 * 看板的成员 key 列表（有序）。
 *
 * 新结构存 board.repoKeys；**迁移前**的存量数据存 board.repoIds（随机 id）。
 * 这里做兼容读取：没有 repoKeys 时按 id 现算 key ——这样**迁移前后都能正常用**
 * （迁移只是把 id 换成 key 的固化，不必先跑迁移才能看清单）。
 */
export function boardRepoKeys(board, store) {
  if (!board) return [];
  if (Array.isArray(board.repoKeys)) return board.repoKeys;
  // 老结构：repoIds（随机 id）→ 现算 key
  const ids = Array.isArray(board.repoIds) ? board.repoIds : [];
  if (!ids.length || !store) return [];
  const byId = new Map(store.repos.map((r) => [r.id, r]));
  const out = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r) out.push(deriveKey(r));
    else out.push(id); // 目标已不存在 → 保留原值当占位（迁移时会被清掉）
  }
  return out;
}

/**
 * 老结构（board.repoIds）→ 新结构（board.repoKeys）的一次性**落盘**迁移。
 *
 * boardRepoKeys 的兼容读解决「迁移前也能看清单」，但盘上还是老结构：
 * 每次读都现算，而且仓库登记一变（改名/换 remote），key 就跟着变，
 * 与别处按 key 存的关系对不上。所以读的时候顺手把新结构写回去（幂等）。
 */
export function migrateStoreKeys(store) {
  if (!store || !Array.isArray(store.boards)) return false;
  let changed = false;
  for (const b of store.boards) {
    if (Array.isArray(b.repoKeys)) continue; // 已是新结构
    const ids = Array.isArray(b.repoIds) ? b.repoIds : [];
    b.repoKeys = ids.length ? boardRepoKeys(b, store) : [];
    delete b.repoIds;
    changed = true;
  }
  return changed;
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
  const boardsOf = new Map(); // repoKey -> [看板投影]
  for (const b of s.boards) {
    for (const rk of boardRepoKeys(b, s)) {
      if (!boardsOf.has(rk)) boardsOf.set(rk, []);
      boardsOf.get(rk).push({
        id: b.id,
        name: b.name,
        desc: b.desc || '',
        key: boardKeyOf(b.name),
        note: (b.repoNotes || {})[rk] || '',
      });
    }
  }
  return s.repos
    .map(({ tags: _dropped, ...r }) => {
      const rk = deriveKey(r);
      return {
        ...r,
        type: r.type || 'dev', // 旧数据无 type 字段 = dev
        key: rk,                // 老数据没有 key 字段 → 现算（Projection 不落盘，导出照样可用）
        keyCustom: !!r.keyCustom,
        remotes: Array.isArray(r.remotes) ? r.remotes : [],
        linked: Array.isArray(r.linked) ? r.linked : [],
        boards: boardsOf.get(rk) || [],
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function addRepo(input) {
  if (!input || !input.path) throw badInput('path 不能为空');
  const repo = normalizeRepoInput(input);
  await mutateStore((s) => {
    if (s.repos.some((r) => r.path.toLowerCase() === repo.path.toLowerCase())) {
      throw conflict('该路径已登记: ' + repo.path);
    }
    // **key 全局唯一**（跨 dev/ref）：它是身份，也是导入导出的映射依据。
    // 老数据可能还没有 key 字段，用 deriveKey 现算，避免迁移空窗期出现重复。
    const dup = s.repos.find((r) => deriveKey(r) === repo.key);
    if (dup) throw conflict(`该 key 已登记为「${dup.name}」（${dup.id}）: ${repo.key}`);
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
    if (patch.type !== undefined) {
      const t = patch.type === 'ref' ? 'ref' : patch.type === 'dev' ? 'dev' : null;
      if (!t) throw badInput('type 只能是 dev | ref，收到: ' + patch.type);
      r.type = t;
      if (!Array.isArray(r.linked)) r.linked = [];
      // 转成 dev 时清掉「指向目标」的绑定（{repo|board}），但**保留反向引用**（{ref}）——
      // dev 仓库身上挂的参考列表是它自己的属性，与它是什么类型无关。
      if (t === 'dev') r.linked = r.linked.filter((l) => l.kind === 'ref');
    }
    if (patch.remote !== undefined) {
      // 改 remote：非自定义 key 跟随 remote 重算；自定义 key 保持不变（用户显式选择）。
      r.remote = String(patch.remote || '').trim();
      if (!r.keyCustom) r.key = deriveKey(r);
      r.keyUpdatedAt = new Date().toISOString();
    }
    if (patch.remotes !== undefined) {
      r.remotes = Array.isArray(patch.remotes) ? patch.remotes.map((x) => String(x).trim()).filter(Boolean) : [];
    }
    if (patch.keyCustom !== undefined) r.keyCustom = patch.keyCustom === true;
    if (patch.key !== undefined) {
      const k = patch.key === '' ? '' : normalizeKey(patch.key);
      if (patch.key !== '' && !k) throw badInput('key 不合法: ' + patch.key);
      // 显式给 key = 视为自定义（keyCustom 未同时显式指定时）
      if (patch.keyCustom === undefined && k) r.keyCustom = true;
      r.key = k || deriveKey(r);
      r.keyUpdatedAt = new Date().toISOString();
    }
    if (patch.linked !== undefined) r.linked = sanitizeLinks(patch.linked);
    if (patch.path !== undefined) {
      const abs = resolve(String(patch.path));
      // 改路径同样要防重复登记，否则两条记录指向同一目录，扫描时无法判断是否已登记
      if (s.repos.some((x) => x.id !== id && x.path.toLowerCase() === abs.toLowerCase())) {
        throw conflict('该路径已登记: ' + abs);
      }
      r.path = abs;
    }
    r.updatedAt = new Date().toISOString();
    // key 全局唯一：改 key / remote / keyCustom 后统一在这里兜底校验一次。
    // （放在最后、且对所有更新都跑——便宜，且不会漏掉某个分支。）
    const finalKey = deriveKey(r);
    if (!finalKey) throw badInput('key 不能为空');
    const dup = s.repos.find((x) => x.id !== id && deriveKey(x) === finalKey);
    if (dup) throw conflict(`该 key 已登记为「${dup.name}」（${dup.id}）: ${finalKey}`);
    r.key = finalKey;
    return r;
  });
}

export async function removeRepo(id) {
  return mutateStore((s) => {
    const idx = s.repos.findIndex((x) => x.id === id);
    if (idx < 0) throw notFound('repo 不存在: ' + id);
    const deadKey = deriveKey(s.repos[idx]);
    // 看板里同步摘引用（看板成员存 key，登记没了就是死引用）
    for (const b of s.boards) {
      if (Array.isArray(b.repoKeys)) b.repoKeys = b.repoKeys.filter((k) => k !== deadKey);
      if (b.repoNotes && b.repoNotes[deadKey]) delete b.repoNotes[deadKey];
    }
    // 绑定是双向记录：两边都要清（全部按 key 比对）
    //   ref 侧的 {kind:'repo', id:被删仓库的 key} 与 {kind:'board', id:被删看板的 key}
    //   dev 侧的 {kind:'ref', id:被删参考仓库的 key}
    for (const r of s.repos) {
      if (!Array.isArray(r.linked)) continue;
      r.linked = r.linked.filter((l) => l.id !== deadKey);
    }
    return s.repos.splice(idx, 1)[0];
  });
}

// id / key / 绝对路径 / 名称 均可定位（agent 场景常直接给路径或 key）
export async function getRepo(idOrPathOrKey) {
  const s = await loadStore();
  const raw = String(idOrPathOrKey || '').trim();
  let r = s.repos.find((x) => x.id === raw);
  if (!r && raw) {
    const k = normalizeKey(raw);
    if (k) r = s.repos.find((x) => deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!r) throw notFound('repo 不存在: ' + raw);
  // 带上它所属的看板（中心清单的同一份数据，单条查询也别缺这一维）
  const rk = deriveKey(r);
  const boards = s.boards
    .filter((b) => boardRepoKeys(b, s).includes(rk))
    .map((b) => ({ id: b.id, name: b.name, desc: b.desc || '', key: boardKeyOf(b.name) }));
  const { tags: _dropped, ...base } = r;
  return {
    ...base,
    type: base.type || 'dev',
    key: rk,
    keyCustom: !!base.keyCustom,
    remotes: Array.isArray(base.remotes) ? base.remotes : [],
    linked: Array.isArray(base.linked) ? base.linked : [],
    boards,
  };
}

/**
 * 仓库的 key（自定义 > remote 派生 > local/<名称> 兜底）。
 * 与 deriveKey 同义，独立导出是为了让「关系一律用 key」这件事在代码里自明。
 */
export const repoKeyOf = deriveKey;

/**
 * 定位一个仓库的 **key**：入参可以是 id / key / 绝对路径 / 名称。
 * 关系引用一律用它——id 是本机行主键，跨机即失效；key 才是身份。
 * 找不到抛 notFound（调用方决定要不要软失败）。
 */
export async function resolveRepoKey(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('缺少仓库标识（id / key / 路径 / 名称）');
  const s = await loadStore();
  let r = s.repos.find((x) => x.id === raw);
  if (!r) {
    const k = normalizeKey(raw);
    if (k) r = s.repos.find((x) => deriveKey(x) === k);
  }
  if (!r) {
    const p = resolve(raw);
    r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
  }
  if (!r) r = s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!r) throw notFound('repo 不存在: ' + raw);
  return deriveKey(r);
}

/** 定位看板的 key：入参可以是 id / key / 名称。 */
export async function resolveBoardKey(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('缺少看板标识（id / key / 名称）');
  const s = await loadStore();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) {
    const k = normalizeKey(raw);
    if (k) b = s.boards.find((x) => boardKeyOf(x.name) === k);
  }
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  return boardKeyOf(b.name);
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
  const boardsOf = new Map(); // repoKey -> [看板投影]
  for (const b of s.boards) {
    for (const rk of boardRepoKeys(b, s)) {
      if (!boardsOf.has(rk)) boardsOf.set(rk, []);
      boardsOf.get(rk).push({
        id: b.id,
        name: b.name,
        desc: b.desc || '',
        key: boardKeyOf(b.name),
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
