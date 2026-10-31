// 看板（主题容器）service：仓库的多项目编排层。
//
// 一个看板 = 一个主题；成员关系挂 board.repoKeys（**按 key**，有序），
// 不在任何看板里的仓库 = 未分组。
//
// **为什么成员用 key 而不是仓库 id**：id 是本机行主键（r_xxx），换机导入后必然不同；
// key 才是仓库的身份（归一化远程地址派生，或自定义）。关系一律用 key，
// 导出导入才能精确映射——这正是「只有有序的 key 才能映射」的目的。
//
// 与 repo 登记的关系：看板只存 key 引用，登记数据（name/desc/path…）的唯一真相在 s.repos——
// 删看板不动登记，删登记要同步摘引用（见 service.js 的 removeRepo）。
//
// **成员可以是「本地未拥有」的 key**（导入时对方组里有、本地没有的仓库）：
// 位置保留在组里（完整复制导出方的布局），投影里 present=false 标出来，
// 有远程地址的还能一键 clone 补齐。clone 后 key 相同 → 占位自动转正。
//
// 本文件不含传输层概念（不认识 argv 与 HTTP）。
import { resolve } from 'node:path';
import {
  loadStore,
  mutateStore,
  newId,
  boardKeyOf,
  boardRepoKeys,
  boardMemberKeys,
  autoKeysByPrefix,
  prefixRulesOf,
  deriveKey,
  normalizeKey,
  findBoard,
} from './service.js';
import { badInput, notFound, conflict } from '../../core/errors.js';

const cleanText = (v) => String(v || '').trim();

// 组内描述：同一个仓库在不同看板里的角色可以各不相同（「fr 组里它是 API 契约方」，
// 「nx 组里它只是同族工具」），所以描述挂在**看板的成员关系**上（repoNotes，按 key），
// 而不是仓库登记上。登记里的 desc 回答「这个仓库是干什么的」，
// 组内描述回答「它在这个组里占什么位置、怎么配合」。
const noteOf = (b, rkey) => (b.repoNotes || {})[rkey] || '';

/**
 * 成员投影。key 在前，名字/描述在后面——
 * 本地未拥有的成员没有登记，只有 key + （导入文件里的）名字。
 *   present   = 本地有没有这条登记
 *   clonable  = 有远程地址 → 可以一键 clone 补齐
 *   auto      = 由前缀规则自动归入（不是手动挂的成员）
 */
function memberView(s, b, rkey, fallback, auto = false) {
  const note = noteOf(b, rkey);
  const local = s.repos.find((r) => deriveKey(r) === rkey);
  const base = {
    key: rkey,
    name: local ? local.name : (fallback && fallback.name) || rkey,
    desc: local ? local.desc || '' : (fallback && fallback.desc) || '',
    path: local ? local.path : '',
    remote: local ? local.remote || '' : (fallback && fallback.remote) || '',
    type: local ? local.type || 'dev' : (fallback && fallback.type) || 'dev',
    note,
    present: !!local,
    clonable: !!(local ? local.remote : fallback && fallback.remote),
    id: local ? local.id : '',
    auto,
  };
  return base;
}

/** 看板成员 = 显式成员 + 前缀规则命中（去重，规则的排后面） */
function membersOf(s, b, autoMap) {
  const explicit = boardRepoKeys(b, s);
  const auto = (autoMap || autoKeysByPrefix(s)).get(b.id) || [];
  const seen = new Set(explicit);
  const out = explicit.map((k) => memberView(s, b, k, null, false));
  for (const k of auto) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(memberView(s, b, k, null, true));
  }
  return out;
}

export async function listBoards() {
  const s = await loadStore();
  const autoMap = autoKeysByPrefix(s);
  const inBoard = new Set(s.boards.flatMap((b) => boardMemberKeys(b, s, autoMap)));
  const reposOf = (b) => membersOf(s, b, autoMap);
  return {
    boards: s.boards.map((b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      key: boardKeyOf(b.name),
      repos: reposOf(b),
    })),
    // 未分组 = 有登记但不在任何看板里（占位成员不算——它们在组里）
    unassigned: s.repos.filter((r) => !inBoard.has(deriveKey(r))).map((r) => ({
      id: r.id,
      key: deriveKey(r),
      name: r.name,
      desc: r.desc || '',
      path: r.path,
    })),
  };
}

export async function getBoard(idOrKey) {
  const s = await loadStore();
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => boardKeyOf(x.name) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  if (!b) throw notFound('看板不存在: ' + raw);
  return { id: b.id, name: b.name, desc: b.desc, key: boardKeyOf(b.name), repos: membersOf(s, b) };
}

export async function createBoard({ name, desc } = {}) {
  const nm = cleanText(name);
  if (!nm) throw badInput('看板名称不能为空');
  return mutateStore((s) => {
    if (s.boards.some((b) => b.name === nm)) throw conflict('同名看板已存在: ' + nm);
    const b = {
      id: newId('b'),
      name: nm,
      desc: cleanText(desc),
      createdAt: new Date().toISOString(),
      repoKeys: [], // 成员按 key 存（不再用随机 id）
    };
    s.boards.push(b);
    return { id: b.id, name: b.name, desc: b.desc, key: boardKeyOf(nm), repos: [] };
  });
}

export async function updateBoard(idOrKey, { name, desc } = {}) {
  const nm = name === undefined ? undefined : cleanText(name);
  if (nm !== undefined && !nm) throw badInput('看板名称不能为空');
  return mutateStore((s) => {
    const b = findBoardIn(s, idOrKey);
    if (!b) throw notFound('看板不存在: ' + idOrKey);
    if (nm !== undefined && s.boards.some((x) => x.id !== b.id && x.name === nm)) {
      throw conflict('同名看板已存在: ' + nm);
    }
    if (nm !== undefined) b.name = nm;
    if (desc !== undefined) b.desc = cleanText(desc);
    return { id: b.id, name: b.name, desc: b.desc, key: boardKeyOf(b.name) };
  });
}

function findBoardIn(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  let b = s.boards.find((x) => x.id === raw);
  if (!b) b = s.boards.find((x) => boardKeyOf(x.name) === normalizeKey(raw));
  if (!b) b = s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
  return b || null;
}

/** 仓库在 store 里的 key（id / key / 路径 / 名称 都认）。找不到 → null。 */
function repoKeyIn(s, idOrKey) {
  const raw = String(idOrKey || '').trim();
  if (!raw) return null;
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
  return r ? deriveKey(r) : null;
}

// 删看板 = 摘容器：repoKeys 随之消失，里面的仓库自动回未分组（登记不动）。
// 参考仓库对它的绑定（linked 里 kind:'board'）同步摘除——看板没了，绑定就是死链。
export async function removeBoard(idOrKey) {
  return mutateStore((s) => {
    const b = findBoardIn(s, idOrKey);
    if (!b) throw notFound('看板不存在: ' + idOrKey);
    const bkey = boardKeyOf(b.name);
    const released = boardRepoKeys(b, s).length;
    s.boards = s.boards.filter((x) => x.id !== b.id);
    for (const r of s.repos) {
      if (!Array.isArray(r.linked)) continue;
      r.linked = r.linked.filter((l) => !(l.kind === 'board' && l.id === bkey));
    }
    return { removed: b.name, released, key: bkey };
  });
}

/**
 * 聚合一张卡片：成员按 **key** 存。加入看板**不动其他看板里的成员关系**，
 * 一个仓库可以同时聚合在多个主题里。
 *   默认                → 加入 board（已在板内则按 before 调位次，幂等不重复）
 *   before              → 插到某张卡片之前（缺省追加到末尾）
 *   remove + board      → 从该看板移出（其他看板保留）
 *   remove 且无 board   → 从所有看板移出（回未分组）
 *
 * key 可以是「本地未拥有」的占位——那样只占位置，不建登记（导入时用）。
 * 占位与本地登记的 key 相同 → clone 补齐后自动「转正」（求差是动态的）。
 */
export async function assignRepo({ id, key, board, before, remove } = {}) {
  const locator = key || id;
  if (!locator) throw badInput('缺少仓库 id 或 key');
  return mutateStore((s) => {
    const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
    const target = board ? findBoardIn(s, board) : null;
    if (board && !target) throw notFound('看板不存在: ' + board);

    if (remove) {
      let n = 0;
      const drop = (b) => {
        if (!Array.isArray(b.repoKeys)) b.repoKeys = [];
        const at = b.repoKeys.indexOf(rkey);
        if (at < 0) return;
        b.repoKeys.splice(at, 1);
        // 摘出成员时组内描述一起带走（它只对这个成员关系有意义）
        if (b.repoNotes) delete b.repoNotes[rkey];
        n += 1;
      };
      if (target) drop(target);
      else for (const b of s.boards) drop(b);
      return { key: rkey, board: target ? boardKeyOf(target.name) : '', removed: true, count: n };
    }

    if (!target) throw badInput('请给 --board <看板id>');
    if (!Array.isArray(target.repoKeys)) target.repoKeys = [];
    const at = target.repoKeys.indexOf(rkey);
    // 已在板内：摘出后按 before 回插（纯调位次）；不在：追加。
    // before 同样按仓库标识解析成 key（id/key/路径/名称 都认）
    if (at >= 0) target.repoKeys.splice(at, 1);
    const beforeKey = before ? repoKeyIn(s, before) || normalizeKey(before) : null;
    const want = beforeKey ? target.repoKeys.indexOf(beforeKey) : -1;
    if (want >= 0) target.repoKeys.splice(want, 0, rkey);
    else target.repoKeys.push(rkey);
    return { key: rkey, board: boardKeyOf(target.name), removed: false, added: at < 0 };
  });
}

/**
 * 设置组内描述：key = 仓库（id / key / 路径 / 名称 均可），board = 看板。
 * 只对**已在板内**的成员有意义——不是成员就显式报错，别静默挂到没人读的地方。
 * note 为空 = 清除。
 */
export async function setBoardRepoNote({ id, key, board, note } = {}) {
  const locator = key || id;
  if (!locator) throw badInput('缺少仓库 id 或 key');
  if (!board) throw badInput('缺少看板 id');
  return mutateStore((s) => {
    // 占位成员（本地未拥有）也允许写描述——描述挂在 key 上，clone 补齐后自动生效
    const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
    const b = findBoardIn(s, board);
    if (!b) throw notFound('看板不存在: ' + board);
    if (!boardRepoKeys(b, s).includes(rkey)) {
      throw conflict(`仓库「${rkey}」不在看板「${b.name}」里——组内描述只对成员有意义`);
    }
    const text = String(note || '').trim();
    if (!b.repoNotes) b.repoNotes = {};
    if (text) b.repoNotes[rkey] = text;
    else delete b.repoNotes[rkey];
    const r = s.repos.find((x) => deriveKey(x) === rkey);
    return {
      key: rkey,
      name: r ? r.name : rkey,
      board: b.id,
      boardKey: boardKeyOf(b.name),
      boardName: b.name,
      note: text,
    };
  });
}

// 导入：一段 JSON = 一批主题。{boards:[{name, desc?, repos:[{key|name, desc?}]}]}
// 条目按 key（优先）或名称匹配**已登记**仓库——导入不硬造登记，
// 匹配不上的如实报告（数量与清单）。同名看板 = 合并（追加匹配到的仓库）。
export async function importBoards({ json } = {}) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw badInput('看板 JSON 解析失败（请粘整个导出对象）');
  }
  const incoming = Array.isArray(data?.boards) ? data.boards : null;
  if (!incoming || !incoming.length) throw badInput('JSON 里没有 boards 数组');
  return mutateStore((s) => {
    const byName = new Map(s.repos.map((r) => [String(r.name).trim(), deriveKey(r)]));
    // path 匹配（大小写不敏感、分隔符归一）——老格式的导入文件按 path 引用
    const byPath = new Map(s.repos.map((r) => [String(r.path).toLowerCase().replace(/\\/g, '/'), deriveKey(r)]));
    let created = 0;
    let merged = 0;
    let matched = 0;
    const unmatched = [];
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

// 导出：看板 + 仓库的 key/name/desc + 组内描述 note（可回灌给 import 的同一结构）
export async function exportBoards() {
  const s = await loadStore();
  return {
    version: 1,
    boards: s.boards.map((b) => ({
      name: b.name,
      desc: b.desc,
      repos: boardRepoKeys(b, s)
        .map((rkey) => {
          const r = s.repos.find((x) => deriveKey(x) === rkey);
          if (!r) return null;
          const note = noteOf(b, rkey);
          return note ? { key: rkey, name: r.name, desc: r.desc, note } : { key: rkey, name: r.name, desc: r.desc };
        })
        .filter(Boolean),
    })),
  };
}

// ─── 前缀分组规则 ────────────────────────────────────────────────
//
// 规则 = 「仓库名以 prefix 开头 → 归入看板 X」。看板不存在时按名字自动建一个
// （「nx 开头的仓库归一类」= 建一个叫 nx 的看板，规则指向它）。
// 规则只影响**成员关系**，看板本身仍是唯一的分组载体。

/** 规则列表（带目标看板名与当前命中数） */
export async function listPrefixRules() {
  const s = await loadStore();
  const autoMap = autoKeysByPrefix(s);
  return {
    groups: prefixRulesOf(s).map((g) => {
      const b = findBoard(s, g.boardId || g.boardKey);
      return {
        prefix: String(g.prefix || ''),
        boardId: b ? b.id : g.boardId || '',
        boardKey: b ? boardKeyOf(b.name) : g.boardKey || '',
        boardName: b ? b.name : '',
        matched: b ? (autoMap.get(b.id) || []).length : 0,
        alive: !!b,
      };
    }),
  };
}

/** 新增/覆盖一条规则（同 prefix 覆盖）。board 省略 = 用 prefix 当看板名（不存在则建） */
export async function addPrefixRule({ prefix: rawPrefix, board: rawBoard } = {}) {
  const prefix = String(rawPrefix || '').trim();
  if (!prefix) throw badInput('需要前缀 <prefix>（如 nx：nx-* 的仓库归一类）');
  return mutateStore((s) => {
    const want = String(rawBoard || '').trim() || prefix;
    let b = findBoard(s, want);
    let created = false;
    if (!b) {
      b = {
        id: newId('b'),
        name: want,
        desc: `按前缀「${prefix}」自动归组`,
        createdAt: new Date().toISOString(),
        repoKeys: [],
        autoPrefix: prefix, // 由规则建的看板：规则删掉时若无手动成员，一并清掉
      };
      s.boards.push(b);
      created = true;
    }
    s.prefixGroups = (s.prefixGroups || []).filter(
      (g) => String(g.prefix || '').toLowerCase() !== prefix.toLowerCase()
    );
    s.prefixGroups.push({ prefix, boardId: b.id, boardKey: boardKeyOf(b.name) });
    const matched = (autoKeysByPrefix(s).get(b.id) || []).length;
    return { prefix, boardId: b.id, boardName: b.name, boardCreated: created, matched };
  });
}

/**
 * 删规则（不动看板本身——手动成员还在）。
 * 但**规则建的空看板**会一起清掉：规则没了，组也就没了，留个空壳只是噪音。
 * 判据：看板由该规则创建（autoPrefix 相同）+ 没有手动成员 + 没有别的规则指向它。
 */
export async function removePrefixRule({ prefix: rawPrefix } = {}) {
  const prefix = String(rawPrefix || '').trim();
  if (!prefix) throw badInput('需要前缀 <prefix>');
  return mutateStore((s) => {
    const before = (s.prefixGroups || []).length;
    const rule = (s.prefixGroups || []).find(
      (g) => String(g.prefix || '').toLowerCase() === prefix.toLowerCase()
    );
    s.prefixGroups = (s.prefixGroups || []).filter(
      (g) => String(g.prefix || '').toLowerCase() !== prefix.toLowerCase()
    );
    const removed = before - s.prefixGroups.length;
    if (!removed) throw notFound(`没有前缀为「${prefix}」的规则`);

    let boardRemoved = '';
    if (rule) {
      const b = findBoard(s, rule.boardId || rule.boardKey);
      const explicit = b ? boardRepoKeys(b, s).length : 0;
      const stillUsed = (s.prefixGroups || []).some(
        (g) => g.boardId === (b && b.id) || (b && g.boardKey === boardKeyOf(b.name))
      );
      if (b && b.autoPrefix && String(b.autoPrefix) === prefix && !explicit && !stillUsed) {
        s.boards = s.boards.filter((x) => x.id !== b.id);
        boardRemoved = b.name;
      }
    }
    return { prefix, removed, boardRemoved };
  });
}
