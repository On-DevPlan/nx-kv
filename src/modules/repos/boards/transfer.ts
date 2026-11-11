// 看板的导入导出（board import/export）与按前缀归组（board prefix，一次性命令）。
import {
  loadStore,
  mutateStore,
  newId,
  boardKeyOf,
  storedBoardKey,
  boardRepoKeys,
  deriveKey,
  normalizeKey,
  findBoard,
} from '../service.js';
import { badInput } from '../../../core/errors.js';
import { cleanText, hintOf, noteOf } from './core.js';
import type { RepoHint, Store } from '../repo/rows.js';

/** importBoards 的单条未匹配记录。 */
export interface ImportBoardsUnmatched {
  board: string;
  entry: string;
}

/** importBoards 的返回。 */
export interface ImportBoardsResult {
  created: number;
  merged: number;
  matched: number;
  unmatched: ImportBoardsUnmatched[];
}

// 导入：一段 JSON = 一批主题。{boards:[{name, desc?, repos:[{key|name, desc?}]}]}
// 条目按 key（优先）或名称匹配**已登记**仓库——导入不硬造登记，
// 匹配不上的如实报告（数量与清单）。同名看板 = 合并（追加匹配到的仓库）。
export async function importBoards({ json }: { json?: unknown } = {}): Promise<ImportBoardsResult> {
  let data: any;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw badInput('看板 JSON 解析失败（请粘整个导出对象）');
  }
  const incoming = Array.isArray(data?.boards) ? data.boards : null;
  if (!incoming || !incoming.length) throw badInput('JSON 里没有 boards 数组');
  return mutateStore((s) => {
    const byName = new Map(s.repos.map((r): [string, string] => [String(r.name).trim(), deriveKey(r)]));
    // path 匹配（大小写不敏感、分隔符归一）——老格式的导入文件按 path 引用
    const byPath = new Map(s.repos.map((r): [string, string] => [String(r.path).toLowerCase().replace(/\\/g, '/'), deriveKey(r)]));
    let created = 0;
    let merged = 0;
    let matched = 0;
    const unmatched: ImportBoardsUnmatched[] = [];
    for (const raw of incoming) {
      const nm = cleanText(raw?.name);
      if (!nm) continue;
      let b = s.boards.find((x) => x.name === nm);
      if (!b) {
        b = { id: newId('b'), name: nm, desc: cleanText(raw.desc), createdAt: new Date().toISOString(), repoKeys: [] };
        s.boards.push(b);
        created += 1;
      } else {
        merged += 1;
      }
      if (!Array.isArray(b.repoKeys)) b.repoKeys = [];
      for (const entry of Array.isArray(raw.repos) ? raw.repos : []) {
        const e = typeof entry === 'string' ? { name: entry } : entry;
        const k = e.key
          ? normalizeKey(e.key)
          : (e.path
            ? byPath.get(String(e.path).toLowerCase().replace(/\\/g, '/'))
            : (e.name ? byName.get(String(e.name).trim()) : null));
        if (!k) {
          unmatched.push({ board: nm, entry: e.key || e.path || e.name || '(空)' });
          continue;
        }
        if (!b.repoKeys.includes(k)) {
          b.repoKeys.push(k);
          matched += 1;
        }
        // 解析不到本地登记的成员 = 占位：把布局里的线索（name/remote/desc）一起记下来。
        // 只留 key 的话，这个位置既没有名字也没有远程地址，"克隆补齐"无从下手。
        if (!s.repos.some((r) => deriveKey(r) === k)) {
          const hint = {
            name: cleanText(e.name),
            remote: cleanText(e.remote),
            desc: cleanText(e.desc),
            type: e.type === 'ref' ? 'ref' : 'dev',
          };
          if (!b.repoHints) b.repoHints = {};
          b.repoHints[k] = Object.fromEntries(Object.entries(hint).filter(([, v]) => v));
        }
        const note = cleanText(e.note);
        if (note) {
          if (!b.repoNotes) b.repoNotes = {};
          b.repoNotes[k] = note;
        }
      }
    }
    return { created, merged, matched, unmatched };
  });
}

/** exportBoards 的一条成员（占位成员带导出方给的线索）。 */
export interface ExportBoardsRepoEntry {
  key: string;
  name: string;
  desc: string;
  remote: string;
  /** 组内描述（有才带） */
  note?: string;
}

/** exportBoards 的一条看板。 */
export interface ExportBoardsBoard {
  key: string;
  name: string;
  desc: string;
  repos: ExportBoardsRepoEntry[];
}

/** exportBoards 的返回（可回灌给 importBoards 的同一结构）。 */
export interface ExportBoardsResult {
  version: number;
  boards: ExportBoardsBoard[];
}

// 导出：看板 + 仓库的 key/name/desc + 组内描述 note（可回灌给 import 的同一结构）
export async function exportBoards(): Promise<ExportBoardsResult> {
  const s: Store = await loadStore();
  return {
    version: 1,
    boards: s.boards.map((b) => ({
      // 冻结 key 随导出走：改名过的组往返后 key 不漂（导入端按 key 优先匹配）
      key: storedBoardKey(b),
      name: b.name,
      desc: b.desc,
      // 占位成员（本机没有登记）也导出——以前这里 filter 掉了它们，
      // 结果是「导出的看板比屏幕上看到的少人」，对方的组结构也跟着缺角。
      repos: boardRepoKeys(b, s).map((rkey): ExportBoardsRepoEntry => {
        const r = s.repos.find((x) => deriveKey(x) === rkey);
        const hint: RepoHint = hintOf(b, rkey) || {};
        const note = noteOf(b, rkey);
        const entry: ExportBoardsRepoEntry = {
          key: rkey,
          name: r ? r.name : (hint.name || rkey),
          desc: r ? r.desc || '' : (hint.desc || ''),
          remote: r ? r.remote || '' : (hint.remote || ''),
        };
        if (note) entry.note = note;
        return entry;
      }),
    })),
  };
}

/** applyPrefixGroup 的返回。 */
export interface PrefixGroupResult {
  prefix: string;
  boardId: string;
  boardName: string;
  boardCreated: boolean;
  added: number;
  total: number;
}

/** applyPrefixGroup 的参数。 */
export interface PrefixGroupInput {
  prefix?: unknown;
  board?: unknown;
}

// ─── 按前缀归组（一次性命令）─────────────────────────────────────
//
// 「把名字以 nx 开头的仓库归成一类」= 跑一次 `board prefix nx`：
// 命中的仓库直接固化成看板的**显式成员**（repoKeys），与手工挂的完全同权。
// 目标看板省略 = 用前缀当名字（不存在就建一个）。规则不驻留——之后再登记的
// 仓库要再跑一次，成员关系的来源始终只有显式成员一种。

/**
 * 按前缀归组：名字以 prefix 开头（大小写不敏感）的已登记仓库 → 挂进目标看板。
 * 返回 { prefix, boardName, boardCreated, added, total }：
 *   added = 这次新挂进去的个数（已在内的不动、不重复、不调位次）；
 *   total = 命令后看板的成员总数。
 */
export async function applyPrefixGroup({ prefix: rawPrefix, board: rawBoard }: PrefixGroupInput = {}): Promise<PrefixGroupResult> {
  const prefix = String(rawPrefix || '').trim();
  if (!prefix) throw badInput('需要前缀 <prefix>（如 nx：把名字以 nx 开头的仓库归一类）');
  return mutateStore((s) => {
    const want = String(rawBoard || '').trim() || prefix;
    let b = findBoard(s, want);
    let created = false;
    if (!b) {
      b = {
        id: newId('b'),
        name: want,
        desc: `按前缀「${prefix}」归组`,
        createdAt: new Date().toISOString(),
        repoKeys: [],
        key: boardKeyOf(want), // 冻结 key：新建组按初始名字派生
      };
      s.boards.push(b);
      created = true;
    }
    if (!Array.isArray(b.repoKeys)) b.repoKeys = [];
    const p = prefix.toLowerCase();
    let added = 0;
    for (const r of s.repos) {
      if (!String(r.name || '').toLowerCase().startsWith(p)) continue;
      const rk = deriveKey(r);
      if (b.repoKeys.includes(rk)) continue;
      b.repoKeys.push(rk);
      added += 1;
    }
    return { prefix, boardId: b.id, boardName: b.name, boardCreated: created, added, total: b.repoKeys.length };
  });
}
