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
import { readFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { openPath } from '../../core/open.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import { sanitizeDocRef, withLinkMeta } from '../docs/docref.js';
import { sanitizeGetLoop } from '../tasktool/getloop.js';
import { listDocFiles } from '../../core/db/import-json.js';
import { nowMs } from '../../core/db/time.js';
import { APP_DIR } from '../../core/paths.js';
import repoLayer from './repo/index.js';
import { gitRemotes, pickRemote } from './git.js';
import {
  SENTINEL_REPO_KEY,
  REPO_EXT,
  GROUP_EXT,
  parseExt,
  jsonText,
  msOfAny,
  compact,
  repoRowToStore,
  groupRowToStore,
} from './repo/rows.js';

// ─── 存储（SQLite，T05）────────────────────────────────────────────────
//
// repos.json 的读写已消失：登记与看板落 `repos` 表（组 = type='group'），成员边落
// `repo_group_members`，队列绑定落 `topics.repo_key`。JSON 形态的 store
//（{repos, boards}）在这里按需组装/落库 —— docs 域经 repos-bridge 消费的
// 正是这层形状，存储切换对它完全透明。
//
// 为什么保留 loadStore/mutateStore 的形状：repos 域写频率低、数据量小
//（几十个仓库），「读全量 → 同步改 → 一个事务落回」在这里不是热路径
//（localtask 那种 0.5s 轮询才必须拆掉 mutate）。它同时保住了两样东西：
// docs 域 33 个调用点零改动；boards/ref/transfer 的多实体联动写一个事务搞定。
// 窄方法（repo/repos.js / repo/refs.js）承担单实体路径与跨表绑定。
//
// ⚠️ **禁令（T06 团队裁决）**：这个「BEGIN IMMEDIATE 内读全量→改→整份落回」的
// 适配器模式**只允许出现在"小表低频"的域**（repos / templates 这种几十行、
// 偶发写的表）。**热路径禁止照抄**——localtask 的 get/list/wait 是毫秒级轮询，
// 一次 mutate = 全表读 + 全表写，并发轮询下就是灾难。有新域要切库：
// 先看写频率，热路径一律走窄方法（仿 localtask/repo），不要回退成 mutate。

const repo = repoLayer;

/**
 * JSON 形态 store 的组装（同步；事务内复用 —— mutateStore 用它读当前态）。
 * 哨兵仓库不进 store（隐藏：不是用户登记的仓库，面板/导出/上下文都看不见它）。
 */
function assembleStore(conn) {
  const repoRows = repo.repos.listRepoRows(conn);
  const groupRows = repo.repos.listGroupRows(conn);
  const members = repo.repos.listAllMembers(conn);
  const store = {
    version: 2,
    repos: repoRows.map((row) => repoRowToStore(row)),
    boards: groupRows.map((row) => groupRowToStore(row, members)),
  };
  // v2 文档绑定归一：非法 DocRef 形状直接丢弃（ext 里的脏数据不炸读取）。
  normalizeDocRefs(store);
  return store;
}

export async function loadStore() {
  return assembleStore(repo.db());
}

// 读-改-写事务：fn 直接修改传入的深拷贝；fn 抛错则不落库。
// fn 必须同步（事务体同步是硬约束）；返回值原样透传给调用方。
// 导出给 boards.js / docs 域（经 repos-bridge）用，不重复实现一遍。
export async function mutateStore(fn) {
  return repo.txw((conn) => {
    const cur = assembleStore(conn);
    const draft = structuredClone(cur);
    const out = fn(draft);
    persistStore(conn, draft);
    return out;
  });
}

/** 整份 store 落库（一个事务）。测试与批量导入用；常规写走 mutateStore。 */
export async function saveStore(data) {
  return repo.txw((conn) => persistStore(conn, data));
}

// ─── 落库（JSON 形态 → 行）────────────────────────────────────────────

/** JSON 形态登记对象 → repos 行。key 必须已经存在（不允许落库时现算）。 */
function repoToRow(r, atMs) {
  // 不再用 deriveKey 现算：落库是最后一道关，静默补 key 会把「用户没填」的历史
  // 覆盖成 local/<名字>，之后再也看不出这个 key 是猜出来的。
  const key = String(r.key || '').trim();
  if (!key) throw badInput('仓库「' + (r.name || '未命名') + '」缺少 key：key 是仓库身份，必须显式给出或由远程地址归一化');
  const remotes = Array.isArray(r.remotes) ? r.remotes.map((x) => String(x).trim()).filter(Boolean) : [];
  const linked = Array.isArray(r.linked)
    ? r.linked.filter((l) => l && typeof l === 'object' && l.kind && l.id).map((l) => ({ kind: String(l.kind), id: String(l.id), ...(l.note ? { note: String(l.note) } : {}) }))
    : [];
  const ext = compact({
    [REPO_EXT.LEGACY_ID]: r.id ? String(r.id) : undefined,
    [REPO_EXT.LEGACY_TYPE]: r.type === 'ref' ? 'ref' : 'dev',
    [REPO_EXT.NOTES]: r.notes ? String(r.notes) : undefined,
    [REPO_EXT.ICON]: r.icon ? String(r.icon) : undefined,
    [REPO_EXT.REMOTES]: remotes.length ? remotes : undefined,
    [REPO_EXT.KEY_CUSTOM]: r.keyCustom ? 1 : undefined,
    [REPO_EXT.KEY_UPDATED_AT]: r.keyUpdatedAt ? String(r.keyUpdatedAt) : undefined,
    [REPO_EXT.LINKED]: linked.length ? linked : undefined,
    [REPO_EXT.GETLOOP]: r.getLoop && typeof r.getLoop === 'object' ? r.getLoop : undefined,
    [REPO_EXT.DOC]: r.doc && typeof r.doc === 'object' ? r.doc : undefined,
    [REPO_EXT.DOC_LINKS]: Array.isArray(r.docLinks) && r.docLinks.length ? r.docLinks : undefined,
  });
  return {
    key,
    type: 'repo',
    name: String(r.name || key),
    description: String(r.desc ?? ''),
    path: String(r.path ?? ''),
    remote: String(r.remote ?? ''),
    ext: jsonText(ext),
    legacyId: r.id ? String(r.id) : null,
    createdAtMs: msOfAny(r.addedAt, atMs),
    updatedAtMs: msOfAny(r.updatedAt, atMs),
  };
}

/**
 * JSON 形态看板对象 → 组行 + 真实成员边。
 *
 * key：冻结（b.key 优先，缺省 boardKeyOf(name)）—— 改名后 key 不变，
 * 成员边 / ref 绑定 / topics.group_key 的引用跟着冻结 key 走。
 * 占位成员（本机没有登记的 key）进不了 repo_group_members（FK 拒绝）→
 * 落 ext.ext_placeholders，读时按 pos 合并还原数组序。
 */
function groupToRow(b, atMs, knownRepoKeys) {
  const key = String(b.key || boardKeyOf(b.name) || '').trim();
  if (!key) throw badInput('看板 key 不能为空');
  if (key === SENTINEL_REPO_KEY) throw badInput('哨兵仓库不能入组: ' + SENTINEL_REPO_KEY);
  const repoKeys = Array.isArray(b.repoKeys) ? b.repoKeys.map((k) => String(k || '').trim()).filter(Boolean) : [];
  const notes = b.repoNotes && typeof b.repoNotes === 'object' ? b.repoNotes : {};
  const members = [];
  const placeholders = [];
  const seen = new Set();
  repoKeys.forEach((rk, position) => {
    if (seen.has(rk)) return; // 重复成员去重（位次取首次出现）
    seen.add(rk);
    if (rk === SENTINEL_REPO_KEY) throw badInput('哨兵仓库不能入组: ' + SENTINEL_REPO_KEY);
    if (knownRepoKeys.has(rk)) members.push({ repoKey: rk, position, note: String(notes[rk] ?? '') });
    else placeholders.push({ key: rk, note: String(notes[rk] ?? ''), pos: position });
  });
  const hints = b.repoHints && typeof b.repoHints === 'object' ? b.repoHints : null;
  const repoDocs = b.repoDocs && typeof b.repoDocs === 'object' && Object.keys(b.repoDocs).length ? b.repoDocs : null;
  const docLinks = Array.isArray(b.docLinks) && b.docLinks.length ? b.docLinks : null;
  const ext = compact({
    [GROUP_EXT.LEGACY_ID]: b.id ? String(b.id) : undefined,
    [GROUP_EXT.REPO_HINTS]: hints ? hints : undefined,
    [GROUP_EXT.PLACEHOLDERS]: placeholders.length ? placeholders : undefined,
    [GROUP_EXT.DOC]: b.doc && typeof b.doc === 'object' ? b.doc : undefined,
    [GROUP_EXT.DOC_LINKS]: docLinks ? docLinks : undefined,
    [GROUP_EXT.REPO_DOCS]: repoDocs ? repoDocs : undefined,
  });
  return {
    key,
    type: 'group',
    name: String(b.name || key),
    description: String(b.desc ?? ''),
    path: '',
    remote: '',
    ext: jsonText(ext),
    legacyId: b.id ? String(b.id) : null,
    members,
    createdAtMs: msOfAny(b.createdAt, atMs),
    updatedAtMs: atMs,
  };
}

/**
 * 整份 JSON 形态 store 落库（**必须在事务内**调用）。
 *
 * 行身份 = ext.ext_legacy_id（r_xxx / b_xxx，本机行主键）：key 变了（改 key /
 * 改组名后 key 重派）而 id 没变 → 按 id 找到旧行，UPDATE key 原地改名
 * （成员边 / 绑定 / topics 外键全部 ON UPDATE CASCADE 跟随）。
 * 消失的行真删（成员边与绑定级联清）；哨兵仓库不受落库影响（永远在场）。
 */
function persistStore(conn, store) {
  const at = nowMs();
  const repos = Array.isArray(store && store.repos) ? store.repos : [];
  const boards = Array.isArray(store && store.boards) ? store.boards : [];

  // 事前行身份表：legacy id → 现落点 key（rename 探测用）
  const before = conn.all('SELECT key, type, ext FROM repos');
  const idToKey = new Map();
  const keySet = new Set();
  for (const row of before) {
    keySet.add(String(row.key));
    const lid = parseExt(row.ext)[REPO_EXT.LEGACY_ID];
    if (lid) idToKey.set(String(lid), String(row.key));
  }

  // ① 登记（type='repo'）
  const seenRepoKeys = new Set();
  for (const r of repos) {
    const row = repoToRow(r, at);
    const prior = (row.legacyId && idToKey.get(row.legacyId)) || (keySet.has(row.key) ? row.key : null);
    if (prior && prior !== row.key) repo.repos.renameRow(conn, prior, row.key, at);
    repo.repos.upsertRow(conn, row);
    seenRepoKeys.add(row.key);
  }
  for (const row of before) {
    if (row.type !== 'repo') continue; // 组行归 ② 处理；这里只清「消失的仓库」
    const k = String(row.key);
    if (k === SENTINEL_REPO_KEY) continue; // 哨兵永远在场，不随 store 落库增删
    if (!seenRepoKeys.has(k)) repo.repos.softDeleteRow(conn, k, at);
  }

  // ② 组（type='group'）+ 成员边。真实成员的 key 必须已在 repos 表（FK），
  //    所以成员重建放在登记 upsert 之后。
  const knownRepoKeys = new Set(
    conn.all("SELECT key FROM repos WHERE type <> 'group' AND deleted_at IS NULL").map((x) => String(x.key))
  );
  const seenGroupKeys = new Set();
  for (const b of boards) {
    const row = groupToRow(b, at, knownRepoKeys);
    const prior = (row.legacyId && idToKey.get(row.legacyId)) || (keySet.has(row.key) ? row.key : null);
    if (prior && prior !== row.key) repo.repos.renameRow(conn, prior, row.key, at);
    repo.repos.upsertRow(conn, row);
    repo.repos.replaceMembers(conn, row.key, row.members, at);
    seenGroupKeys.add(row.key);
  }
  for (const row of before) {
    const k = String(row.key);
    if (row.type !== 'group') continue;
    if (!seenGroupKeys.has(k)) repo.repos.softDeleteRow(conn, k, at);
  }
}

// v2 文档绑定归一：非法 DocRef 形状直接丢弃（盘上脏数据不炸读取）。
// 在内存完成即可，不强制落盘——下一次任何写都会把归一结果带下去。
// sanitizeDocRef 来自 docs/docref.js（叶子模块，刻意不反向依赖本文件之外的东西）。
function normalizeDocRefs(store) {
  for (const r of store.repos) {
    const ref = sanitizeDocRef(r.doc);
    if (ref) r.doc = ref;
    else delete r.doc;
    // 项目介绍文档集（多篇）：doc 是主篇，docLinks 是其余各篇
    const links = (Array.isArray(r.docLinks) ? r.docLinks : [])
      .map((l) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) r.docLinks = links;
    else delete r.docLinks;
  }
  for (const b of store.boards) {
    const ref = sanitizeDocRef(b.doc);
    if (ref) b.doc = ref;
    else delete b.doc;
    const links = (Array.isArray(b.docLinks) ? b.docLinks : [])
      .map((l) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) b.docLinks = links;
    else delete b.docLinks;
    const repoDocs = {};
    for (const [k, v] of Object.entries(b.repoDocs && typeof b.repoDocs === 'object' ? b.repoDocs : {})) {
      const d = sanitizeDocRef(v);
      if (d) repoDocs[k] = d;
    }
    if (Object.keys(repoDocs).length) b.repoDocs = repoDocs;
    else delete b.repoDocs;
  }
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
// 项目图标：emoji 或单字符（≤8 字）。留空 = 用默认图标。
// 位置：侧栏树行名之前、仓库管理页行首、设置面板项目卡标题旁。
function sanitizeIcon(raw) {
  return String(raw ?? '').trim().slice(0, 8);
}

function normalizeRepoInput({ path, name, notes, desc, type, remote, linked, key, keyCustom, remotes, icon }) {
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
    icon: sanitizeIcon(icon),
    remote: (remote || '').trim(),
    key,
    keyCustom: !!keyCustom,
    remotes,
  };
  // key 来源只有两个：用户显式给出，或远程地址归一化。**不再按名字生成 local/<name>**。
  // 没有远程地址时，key 是必填项 —— 静默造一个会让「用户以为没设、其实是猜的」。
  const finalKey = rk0 || deriveKey({ ...input, name: nm });
  if (!finalKey) {
    throw badInput(
      `仓库「${nm}」缺少 key：没有远程 git 地址时 key 必填（远程地址存在时会按 host/owner/repo 归一化自动得到）`
    );
  }
  return {
    id: newId('r'),
    name: nm,
    icon: sanitizeIcon(icon), // 项目图标（emoji/单字符；空 = 默认图标）
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

// key 归一化已下沉 shared/repo-key.js（前端自动填充与后端登记共用同一份口径）。
// localKeyOf 仍是 core 层的文档路径 slug 函数；这里转发导出，既有调用点不变。
import { localKeyOf } from '../../core/keys.js';
import { normalizeKey, keyFromRemote } from '../../shared/repo-key.js';
export { normalizeKey, localKeyOf, keyFromRemote };

// 兼容旧调用点（ref.js / transfer.js 都在用这个名字）
export const normalizeRemoteKey = keyFromRemote;

/**
 * 一个仓库的 key：显式 key（自定义）优先，其次 remote 派生。
 *
 * **没有 local/<name> 兜底**（2026-11 裁决）：key 是仓库身份，不能由显示名悄悄生成。
 * 新建/导入时若既没给 key 也没有远程地址，必须报错让用户显式输入。
 * 读路径仍兼容老数据（库里的 key 一定有值；JSON 时代老对象没有 key 时返回空串）。
 */
export function deriveKey(repo) {
  if (!repo) return '';
  if (repo.keyCustom && repo.key) return normalizeKey(repo.key);
  const fromRemote = keyFromRemote(repo.remote || '');
  if (fromRemote) return fromRemote;
  if (repo.key) return normalizeKey(repo.key);
  return '';
}

// 从 URL 推导目录名：取末段、剥 .git。非法字符替换成 -（Windows 目录名约束）。
export function dirnameFromRemote(url) {
  const key = keyFromRemote(url);
  const base = key.split('/').filter(Boolean).pop() || 'repo';
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'repo';
}

// 看板的 key（board/<slug(name)>）——**派生函数**（JSON 时代按名字现算）。
// 库化后组的 key 冻结落库（`group/<slug(初始 name)>`，import 裁决）：看板对象上
// 多带一个 `key` 字段，定位与导出用冻结 key（storedBoardKey）；本函数保留给
// 「新建看板时算初始 key」与 docs 模块的路径 slug（口径必须一致）。
export function boardKeyOf(name) {
  return 'board/' + localKeyOf(name).slice('local/'.length);
}

/**
 * 看板的**冻结 key**（身份）：优先库里的 stored key，缺省按名字现算
 *（JSON 时代形状的兜底——手工构造的 board 对象没有 key 字段）。
 * 关系引用（组成员、ref 绑定 {kind:'board'}、topics.group_key）一律用它。
 */
export function storedBoardKey(b) {
  return (b && b.key) || boardKeyOf(b && b.name);
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

// ─── 看板成员（一律显式）──────────────────────────────────────────
//
// 前缀分组规则已废除（2026-11-02）：原「仓库名以 nx 开头 → 自动算成员」的常驻规则
// 改成一次性命令 `board prefix <prefix> [--board <看板>]`——命令跑一次，命中的仓库
// 直接固化成看板的显式成员（repoKeys），之后与手工挂的成员完全同权。
// 好处：成员关系只有一个来源，读路径不用再叠加「规则命中」一层。

/** 找看板：按 id → 冻结 key → 名称依次找；都找不到返回 null */
export function findBoard(store, ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const boards = store.boards || [];
  return (
    boards.find((b) => b.id === raw) ||
    boards.find((b) => storedBoardKey(b) === normalizeKey(raw)) ||
    boards.find((b) => String(b.name).toLowerCase() === raw.toLowerCase()) ||
    null
  );
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
  // docs/paths 反过来依赖本文件的 normalizeKey（动态引入避免静态环）
  const { repoDocRel, groupNoteRel } = await import('../docs/paths.js');
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
        // 组内描述也是文档：前端点「描述」直接开这篇（绑定优先，缺省约定路径）
        noteDocRel: (b.repoDocs || {})[rk]?.rel || groupNoteRel(b.name, rk),
        noteDocPath: (b.repoDocs || {})[rk]?.path || '',
      });
    }
  }
  const { docSetOf } = await import('../docs/brief.js');
  const rows = s.repos.map(({ tags: _dropped, ...r }) => {
      const rk = deriveKey(r);
      return {
        ...r,
        type: r.type || 'dev', // 旧数据无 type 字段 = dev
        key: rk,                // 老数据没有 key 字段 → 现算（Projection 不落盘，导出照样可用）
        keyCustom: !!r.keyCustom,
        remotes: Array.isArray(r.remotes) ? r.remotes : [],
        linked: Array.isArray(r.linked) ? r.linked : [],
        // 文档路径（绑定优先，缺省约定路径）——纯字符串拼接，给前端零派生消费
        docRel: r.doc?.rel || repoDocRel(rk),
        boards: boardsOf.get(rk) || [],
      };
    });
  // 描述 = 绑定的文档集（主篇标题 + 补充篇），不再是 desc 字符串
  for (const row of rows) row.descDocs = await docSetOf(row, 'repo');
  return rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function addRepo(input) {
  if (!input || !input.path) throw badInput('path 不能为空');
  const repo = normalizeRepoInput(input);
  await mutateStore((s) => {
    if (s.repos.some((r) => r.path.toLowerCase() === repo.path.toLowerCase())) {
      throw conflict('该路径已登记: ' + repo.path);
    }
    // **key 全局唯一**（跨 dev/ref）：它是身份，也是导入导出的映射依据。
    const dup = s.repos.find((r) => deriveKey(r) === repo.key);
    if (dup) {
      throw conflict(
        `key「${repo.key}」已被仓库「${dup.name}」占用（path: ${dup.path || '未登记'}）—— key 是全局身份，不会自动加后缀；请换一个 key，或先修改/删除那条登记`
      );
    }
    s.repos.push(repo);
  });
  await seedRepoDoc(repo);
  return repo;
}

/**
 * 描述是文档：add 时给的 desc 只是**初始正文**，落到主篇 md（repo/<key>/index.md 的旧单文件位），
 * 再按 md 回写摘要。文档已在就不动——老仓库重登记不该把写过的介绍冲掉。
 * 动态 import 同 listRepos：docs 是叶子，repos 反向依赖它（静态引会成环）。
 */
async function seedRepoDoc(repo) {
  const desc = String((repo && repo.desc) || '').trim();
  if (!desc) return null;
  const { repoDocRel } = await import('../docs/paths.js');
  const store = await import('../docs/store.js');
  const rel = repoDocRel(repo.key);
  if (await store.ownDocExists(rel)) return null;
  return writeRepoDocContent(repo, desc);
}

/**
 * 把一段文本写成仓库的主篇文档（覆盖正文，标题取仓库名）。
 * 导入覆盖（transfer 的 overwrite 策略）走这里——描述不能再经 updateRepo 的 desc 字段。
 */
export async function writeRepoDocContent(repo, text) {
  const { repoDocRel } = await import('../docs/paths.js');
  const store = await import('../docs/store.js');
  const { writeBackSummary } = await import('../docs/seed.js');
  const rel = repoDocRel(repo.key);
  const body = `# ${repo.name || repo.key}\n\n${String(text || '').trim()}\n`;
  await store.writeOwnDoc(rel, body);
  await writeBackSummary(rel, body);
  return rel;
}

export async function updateRepo(id, patch) {
  return mutateStore((s) => {
    // 定位：id → key → 绝对路径 → 名称（与 getRepo 同一口径——
    // 「用本机仓库接管待初始化的 key」这类场景给的是路径或 key，不是行主键）
    const raw = String(id || '').trim();
    const r =
      s.repos.find((x) => x.id === raw) ||
      s.repos.find((x) => deriveKey(x) === normalizeKey(raw)) ||
      s.repos.find((x) => x.path && x.path.toLowerCase() === resolve(raw).toLowerCase()) ||
      s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
    if (!r) throw notFound('repo 不存在: ' + id);
    if (patch.name !== undefined) r.name = String(patch.name).trim();
    if (patch.icon !== undefined) r.icon = sanitizeIcon(patch.icon);
    if (patch.desc !== undefined) {
      throw badInput(
        '描述已改为文档（不再是字符串）：改正文用 `docs set <rel>`，换绑主篇用 ' +
        '`docs bind --repo <仓库> --rel <路径>`，加补充篇用 `docs link --board <看板> --doc <路径>`'
      );
    }
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
    if (patch.getLoop !== undefined) {
      // 项目级「持续 get」（waitgoal）配置：null/ false = 清除；对象 = 与已有字段合并后落库
      if (patch.getLoop === null) {
        delete r.getLoop;
      } else {
        const v = sanitizeGetLoop(patch.getLoop);
        const merged = sanitizeGetLoop({ ...(r.getLoop || {}), ...v });
        if (merged) r.getLoop = merged;
        else delete r.getLoop;
      }
    }
    if (patch.path !== undefined) {
      const abs = resolve(String(patch.path));
      // 改路径同样要防重复登记，否则两条记录指向同一目录，扫描时无法判断是否已登记
      if (s.repos.some((x) => x.id !== r.id && x.path.toLowerCase() === abs.toLowerCase())) {
        throw conflict('该路径已登记: ' + abs);
      }
      r.path = abs;
    }
    r.updatedAt = new Date().toISOString();
    // key 全局唯一：改 key / remote / keyCustom 后统一在这里兜底校验一次。
    // （放在最后、且对所有更新都跑——便宜，且不会漏掉某个分支。）
    const finalKey = deriveKey(r);
    if (!finalKey) throw badInput('key 不能为空：没有远程地址时，key 必须显式给出');
    const dup = s.repos.find((x) => x.id !== r.id && deriveKey(x) === finalKey);
    if (dup) {
      throw conflict(
        `key「${finalKey}」已被仓库「${dup.name}」占用（path: ${dup.path || '未登记'}）—— key 是全局身份，不会自动加后缀；请换一个 key`
      );
    }
    r.key = finalKey;
    return r;
  });
}

export async function removeRepo(id) {
  // 删仓库前置检查：队列绑定在 topics.repo_key（FK CASCADE）——真删会把
  // 该仓库下的队列连同任务一起级联掉，这是谁都不预期的副作用，必须先挡。
  const raw = String(id || '').trim();
  if (raw) {
    const k = await resolveRepoKey(raw).catch(() => null);
    if (k) {
      const bound = repo.txw((conn) => repo.repos.countTopicsOfRepo(k, conn));
      if (bound > 0) {
        throw conflict(`仓库「${k}」下还有 ${bound} 条队列绑定 —— 先解绑（或删除队列）再删除登记`);
      }
    }
  }
  return mutateStore((s) => {
    // 定位：id → key → 绝对路径 → 名称（与 getRepo/updateRepo 同一口径）
    const raw = String(id || '').trim();
    const idx = s.repos.findIndex(
      (x) =>
        x.id === raw ||
        deriveKey(x) === normalizeKey(raw) ||
        (x.path && x.path.toLowerCase() === resolve(raw).toLowerCase()) ||
        String(x.name).toLowerCase() === raw.toLowerCase()
    );
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
  const { repoDocRel } = await import('../docs/paths.js');
  const boards = s.boards
    .filter((b) => boardRepoKeys(b, s).includes(rk))
    .map((b) => ({ id: b.id, name: b.name, desc: b.desc || '', key: storedBoardKey(b) }));
  const { tags: _dropped, ...base } = r;
  return {
    ...base,
    type: base.type || 'dev',
    key: rk,
    keyCustom: !!base.keyCustom,
    remotes: Array.isArray(base.remotes) ? base.remotes : [],
    linked: Array.isArray(base.linked) ? base.linked : [],
    docRel: base.doc?.rel || repoDocRel(rk),
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

/** 定位看板的 key：入参可以是 id / 冻结 key / 名称派生 key / 名称。 */
export async function resolveBoardKey(locator) {
  const raw = String(locator || '').trim();
  if (!raw) throw badInput('缺少看板标识（id / key / 名称）');
  const s = await loadStore();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) {
    const k = normalizeKey(raw);
    if (k) b = s.boards.find((x) => storedBoardKey(x) === k);
  }
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  return storedBoardKey(b);
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

// ─── 队列绑定（T05）：把「未绑定」队列按路径前缀 re-point 到真实仓库 ─────
//
// 迁移裁决（D3）：legacy 队列全部挂哨兵仓库 `__unbound__`（旧 key 是目录名
// sha1，对不上任何真实仓库），**不做自动猜绑**——猜错比不猜糟。真实绑定
// 只有一个写入口：用户显式跑本命令（按登记的仓库路径前缀匹配，最长前缀赢）。
//
// **顺序：先建 refs 再绑 topic**（裁决原文）。绑定落库前先跑
// repo/refs.js 的 rebuildRefIndex 把文档索引（约定路径绑定 + 孤儿清单）
// 补齐 —— 队列绑到仓库后，面板立刻要展示「这个仓库有哪些文档」，索引
// 不能等到那时才现建。docs 树扫描（fs）在事务外完成，事务体内只有写库。

/** 文档索引的树根（与 docs/paths 的 NX_KV_DOCS_DIR 覆盖同一口径）。 */
export function docsIndexRoot() {
  return process.env.NX_KV_DOCS_DIR || join(APP_DIR, 'docs');
}

/**
 * 按路径前缀把哨兵上的队列绑到真实仓库。
 *
 * @param {object} [opts]
 * @param {string} [opts.repo]    仓库标识（id / key / 路径 / 名称）；缺省 = 全部登记仓库
 * @param {boolean} [opts.apply]  false = 预览（零副作用）；true = 先建 refs 再绑
 * @returns {{apply, scanned, bound: Array, left: Array, refs?: object}}
 *   bound  = 命中并绑定的队列（apply=false 时是计划）
 *   left   = 留在哨兵的队列（cwd 对不上任何仓库 / 全局池）
 */
export async function bindTopicsToRepos({ repo: repoLocator = '', apply = false } = {}) {
  const s = await loadStore();
  let targets;
  if (repoLocator) {
    targets = [await getRepo(repoLocator)];
  } else {
    targets = s.repos.filter((r) => r.path);
  }
  const prefixes = targets
    .map((r) => ({ key: deriveKey(r), name: r.name, prefix: normalizePathKey(r.path) }))
    .filter((x) => x.prefix);

  // docs 树扫描在事务外（fs 不进事务体）；正文一并读出来，索引重建时同步 ref_attach。
  const docsFiles = apply ? listDocFiles(docsIndexRoot()) : [];
  const docsBodies = new Map();
  if (apply) {
    for (const rel of docsFiles) {
      try {
        docsBodies.set(rel, readFileSync(join(docsIndexRoot(), ...String(rel).split('/')), 'utf8'));
      } catch {
        /* 读不到就跳过资源同步，索引本身仍建 */
      }
    }
  }

  const planFor = (conn) => {
    const topics = repo.repos.listUnboundTopics(conn);
    const bound = [];
    const left = [];
    for (const t of topics) {
      const nk = normalizePathKey(t.cwd);
      let hit = null;
      for (const p of prefixes) {
        // 相等或在其子目录下；嵌套登记时**最长前缀赢**（更具体的仓库接管）
        if (nk && (nk === p.prefix || nk.startsWith(p.prefix + '/'))) {
          if (!hit || p.prefix.length > hit.prefix.length) hit = p;
        }
      }
      if (hit) bound.push({ topicKey: String(t.key), name: String(t.name || ''), cwd: String(t.cwd || ''), repoKey: hit.key, repoName: hit.name });
      else left.push({ topicKey: String(t.key), name: String(t.name || ''), cwd: String(t.cwd || '') });
    }
    return { scanned: topics.length, bound, left };
  };

  if (!apply) {
    const plan = repo.txw(planFor);
    return { apply: false, ...plan };
  }
  return repo.txw((conn) => {
    const refs = repo.refs.rebuildRefIndex(conn, { docsFiles, docsBodies, atMs: nowMs() });
    const plan = planFor(conn);
    let changed = 0;
    for (const b of plan.bound) {
      const row = conn.get('SELECT id FROM topics WHERE key = :k', { k: b.topicKey });
      if (row && repo.repos.bindTopicToRepo(conn, row.id, b.repoKey, nowMs())) changed += 1;
    }
    return { apply: true, refs, bound: plan.bound, left: plan.left, scanned: plan.scanned, changed };
  });
}
