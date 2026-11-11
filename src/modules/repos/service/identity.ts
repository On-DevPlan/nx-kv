// 仓库/看板的身份与输入归一：key 派生、冻结 key、成员 key 兼容读取、登记输入收敛。
// 纯函数层——不碰存储（store.js），也不认识传输层。
import { basename, resolve } from 'node:path';
import { badInput } from '../../../core/errors.js';
import type { RepoEntry, RepoLink, BoardEntry, Store } from '../repo/rows.js';

export function newId(prefix: string): string {
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
function sanitizeIcon(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 8);
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
function sanitizeLinks(raw: unknown): RepoLink[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: RepoLink[] = [];
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
import { localKeyOf } from '../../../core/keys.js';
import { normalizeKey, keyFromRemote } from '../../../shared/repo-key.js';
export { normalizeKey, localKeyOf, keyFromRemote };

// 兼容旧调用点（ref.js / transfer.js 都在用这个名字）
export const normalizeRemoteKey = keyFromRemote;

/** deriveKey 只关心这三个字段（老 JSON / 手工构造的部分对象也能传；name 随调用点一并传入但不参与派生）。 */
export interface RepoKeySource {
  keyCustom?: unknown;
  key?: unknown;
  remote?: unknown;
  name?: unknown;
}

/**
 * 一个仓库的 key：显式 key（自定义）优先，其次 remote 派生。
 *
 * **没有 local/<name> 兜底**（2026-11 裁决）：key 是仓库身份，不能由显示名悄悄生成。
 * 新建/导入时若既没给 key 也没有远程地址，必须报错让用户显式输入。
 * 读路径仍兼容老数据（库里的 key 一定有值；JSON 时代老对象没有 key 时返回空串）。
 */
export function deriveKey(repo: RepoKeySource | null | undefined): string {
  if (!repo) return '';
  if (repo.keyCustom && repo.key) return normalizeKey(repo.key);
  const fromRemote = keyFromRemote(repo.remote || '');
  if (fromRemote) return fromRemote;
  if (repo.key) return normalizeKey(repo.key);
  return '';
}

// 从 URL 推导目录名：取末段、剥 .git。非法字符替换成 -（Windows 目录名约束）。
export function dirnameFromRemote(url: unknown): string {
  const key = keyFromRemote(url);
  const base = key.split('/').filter(Boolean).pop() || 'repo';
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 80) || 'repo';
}

// 看板的 key（board/<slug(name)>）——**派生函数**（JSON 时代按名字现算）。
// 库化后组的 key 冻结落库（`group/<slug(初始 name)>`，import 裁决）：看板对象上
// 多带一个 `key` 字段，定位与导出用冻结 key（storedBoardKey）；本函数保留给
// 「新建看板时算初始 key」与 docs 模块的路径 slug（口径必须一致）。
export function boardKeyOf(name: unknown): string {
  return 'board/' + localKeyOf(name).slice('local/'.length);
}

/**
 * 看板的**冻结 key**（身份）：优先库里的 stored key，缺省按名字现算
 *（JSON 时代形状的兜底——手工构造的 board 对象没有 key 字段）。
 * 关系引用（组成员、ref 绑定 {kind:'board'}、topics.group_key）一律用它。
 */
export function storedBoardKey(b: BoardEntry | null | undefined): string {
  return (b && b.key) || boardKeyOf(b && b.name);
}

/**
 * 看板的成员 key 列表（有序）。
 *
 * 新结构存 board.repoKeys；**迁移前**的存量数据存 board.repoIds（随机 id）。
 * 这里做兼容读取：没有 repoKeys 时按 id 现算 key ——这样**迁移前后都能正常用**
 * （迁移只是把 id 换成 key 的固化，不必先跑迁移才能看清单）。
 */
export function boardRepoKeys(board: BoardEntry | null | undefined, store: Store | null | undefined): string[] {
  if (!board) return [];
  if (Array.isArray(board.repoKeys)) return board.repoKeys;
  // 老结构：repoIds（随机 id）→ 现算 key
  const ids = Array.isArray(board.repoIds) ? board.repoIds : [];
  if (!ids.length || !store) return [];
  const byId = new Map<string, RepoEntry>(store.repos.map((r): [string, RepoEntry] => [r.id, r]));
  const out: string[] = [];
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
export function findBoard(store: Store, ref: unknown): BoardEntry | null {
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

export { sanitizeIcon, sanitizeLinks };

/** normalizeRepoInput 的输入形状（字符串归一在函数内完成）。 */
export interface RepoInputFields {
  path?: string;
  name?: string;
  notes?: string;
  desc?: string;
  type?: string;
  remote?: string;
  linked?: unknown;
  key?: string;
  keyCustom?: boolean;
  remotes?: string[];
  icon?: string;
}

export function normalizeRepoInput({ path, name, notes, desc, type, remote, linked, key, keyCustom, remotes, icon }: RepoInputFields): RepoEntry {
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
