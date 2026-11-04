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
  deriveKey,
  normalizeKey,
  findBoard,
} from './service.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import { boardDocRel, groupNoteRel } from '../docs/paths.js';

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
 */
function memberView(s, b, rkey, fallback) {
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
    // 组内描述文档（绑定优先，缺省约定路径）——前端点开 doc 页签用
    noteDocRel: (b.repoDocs || {})[rkey]?.rel || groupNoteRel(b.name, rkey),
    noteDocPath: (b.repoDocs || {})[rkey]?.path || '',
    present: !!local,
    clonable: !!(local ? local.remote : fallback && fallback.remote),
    id: local ? local.id : '',
  };
  return base;
}

// 占位成员的线索（导入布局时记下的 name/remote/desc/type）。
// 以前占位只留一个 key：既显示不出名字，也没有远程地址 —— 「克隆到本地」按钮
// 永远不出现，「待初始化」于是成了一个只能看、不能救的清单。
const hintOf = (b, rkey) => (b.repoHints && b.repoHints[rkey]) || null;

/** 看板成员（全是显式成员——前缀归组命令跑一次后也固化成显式成员） */
function membersOf(s, b) {
  return boardRepoKeys(b, s).map((k) => memberView(s, b, k, hintOf(b, k)));
}

export async function listBoards() {
  const s = await loadStore();
  const inBoard = new Set(s.boards.flatMap((b) => boardRepoKeys(b, s)));
  const reposOf = (b) => membersOf(s, b);
  return {
    boards: s.boards.map((b) => ({
      id: b.id,
      name: b.name,
      desc: b.desc,
      key: boardKeyOf(b.name),
      // 组介绍文档与组级附加文档列表（绑定优先；前端渲染介绍 md 与 docLinks chips）
      docRel: b.doc?.rel || boardDocRel(b.name),
      docPath: b.doc?.path || '',
      docLinks: Array.isArray(b.docLinks) ? b.docLinks : [],
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
  return {
    id: b.id,
    name: b.name,
    desc: b.desc,
    key: boardKeyOf(b.name),
    docRel: b.doc?.rel || boardDocRel(b.name),
    docPath: b.doc?.path || '',
    docLinks: Array.isArray(b.docLinks) ? b.docLinks : [],
    repos: membersOf(s, b),
  };
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
 * 记下占位成员的线索（导入布局时用）：name / remote / desc / type。
 *
 * 只对**本地没有登记**的成员有意义——已有登记的成员，真相在登记里，
 * 线索只会变成一份会过期的副本。已有线索不覆盖：先导进来的那份是它的来历。
 */
export async function setMemberHint({ board, key, name, remote, desc, type } = {}) {
  const rkey = normalizeKey(key);
  if (!rkey) throw badInput('缺少成员 key');
  return mutateStore((s) => {
    const b = board ? findBoardIn(s, board) : null;
    if (!b) throw notFound('看板不存在: ' + board);
    if (!boardRepoKeys(b, s).includes(rkey)) return { key: rkey, stored: false };
    if (s.repos.some((r) => deriveKey(r) === rkey)) return { key: rkey, stored: false };
    const clean = Object.fromEntries(
      Object.entries({ name: cleanText(name), remote: cleanText(remote), desc: cleanText(desc), type: type === 'ref' ? 'ref' : 'dev' })
        .filter(([, v]) => v)
    );
    if (!Object.keys(clean).length) return { key: rkey, stored: false };
    if (!b.repoHints) b.repoHints = {};
    b.repoHints[rkey] = { ...clean, ...(b.repoHints[rkey] || {}) };
    return { key: rkey, stored: true };
  });
}

/**
 * 把看板里的**占位 key** 重绑到本机真实 key（关系改，登记不动）。
 *
 * **为什么需要**：占位成员的 key 来自导出方——对方那个仓库没有 remote 时，
 * key 就是 `local/<名称>`；而本机同名仓库的 key 是 `github.com/org/name`。
 * 两个 key 永远不会相遇，这个成员就**永久停在「待初始化」**：
 * 显示着一个不属于任何仓库的名字，克隆按钮也点不动。
 *
 * 以前面板上的「用本机仓库接管」改的是**本机仓库的 key**（PATCH /api/repos/:id
 * {key: 占位 key}）——方向反了：真实身份被降级成 local/xxx，再导出就把这个假
 * key 传播给所有人。正确的动作是改关系：把组里的 from 换成 to。
 *
 * 组内描述（repoNotes）与组内文档绑定（repoDocs）都挂在 key 上，必须跟着搬，
 * 否则描述留在原地变成孤儿。
 */
export async function rekeyMember({ board, from, to } = {}) {
  const src = normalizeKey(from);
  if (!src) throw badInput('需要 from（组里的占位 key）');
  if (!to) throw badInput('需要 to（本机仓库的 id / key / 路径 / 名称）');
  return mutateStore((s) => {
    // to 认 id / key / 路径 / 名称（agent 手边常只有名字），落盘一律用 key
    const dst = repoKeyIn(s, to) || normalizeKey(to);
    if (src === dst) throw badInput('from 与 to 解析成了同一个 key，无需重绑');
    if (!s.repos.some((r) => deriveKey(r) === dst)) {
      throw notFound(`本机没有 key 为「${dst}」的仓库 —— 先 repo add / repo ref clone，或改用「克隆到本地」`);
    }
    const b = board ? findBoardIn(s, board) : s.boards.find((x) => boardRepoKeys(x, s).includes(src));
    if (!b) throw notFound('看板不存在: ' + (board || '（也没有任何看板包含 ' + src + '）'));
    // 不给 board = 全组重绑：假 key 是**身份**问题，同一个占位在几个组里都是假的，
    // 只改一个组会留下一半仍然「待初始化」的残局。给了 board 就只动那一个组。
    const targets = board ? [b] : s.boards.filter((x) => boardRepoKeys(x, s).includes(src));
    let movedNote = false;
    let movedDoc = false;
    let mergedAny = false;
    let touched = 0;
    for (const t of targets) {
      const keys = Array.isArray(t.repoKeys) ? t.repoKeys : (t.repoKeys = boardRepoKeys(t, s));
      const at = keys.indexOf(src);
      if (at < 0) continue;
      touched += 1;
      const dup = keys.includes(dst);
      if (dup) keys.splice(at, 1); // 目标已在组里 → 合并：只把占位摘掉
      else keys[at] = dst;         // 原位替换，成员顺序不变
      mergedAny = mergedAny || dup;
      // 描述与文档绑定跟着 key 走（目标已有则保留目标自己的——它属于真实成员关系）
      if (t.repoNotes && t.repoNotes[src] !== undefined) {
        if ((!dup || t.repoNotes[dst] === undefined) && t.repoNotes[src]) t.repoNotes[dst] = t.repoNotes[src];
        delete t.repoNotes[src];
        movedNote = true;
      }
      if (t.repoDocs && t.repoDocs[src] !== undefined) {
        if (!dup || t.repoDocs[dst] === undefined) t.repoDocs[dst] = t.repoDocs[src];
        delete t.repoDocs[src];
        movedDoc = true;
      }
      if (t.repoHints) delete t.repoHints[src];
    }
    if (!touched) throw notFound(`看板「${b.name}」里没有成员 ${src}`);
    // 绑定关系里也有这个 key：ref 侧 {kind:'repo'} 指向开发仓库，dev 侧 {kind:'ref'}
    // 反向指向参考仓库。只改成员不改绑定，`repo ref check` 会继续报「绑定目标已不存在」。
    let relinked = 0;
    for (const r of s.repos) {
      if (!Array.isArray(r.linked) || !r.linked.length) continue;
      const seen = new Set();
      const next = [];
      for (const l of r.linked) {
        const id = (l.kind === 'repo' || l.kind === 'ref') && l.id === src ? dst : l.id;
        const sig = l.kind + ':' + id;
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (id !== l.id) relinked += 1;
        next.push(id === l.id ? l : { ...l, id });
      }
      r.linked = next;
    }
    return {
      board: boardKeyOf(b.name),
      boardName: b.name,
      boards: targets.map((t) => t.name),
      from: src,
      to: dst,
      merged: mergedAny,
      movedNote,
      movedDoc,
      relinked,
    };
  });
}

/**
 * 清理占位成员：组里引用了、本机却没有登记的仓库。
 *
 * 「没初始化的可能是不需要的」——占位只能从导入布局来，而本机这份
 * 未必还想要对方那一整套结构。默认只清**无来源**的（没有远程地址，克隆不回来，
 * 也就永远转不了正：典型是 `local/<名称>`）；带 remote 的留着等 clone，
 * 除非显式 --all。
 *
 * 默认 dry-run（零副作用），--apply 才落盘。
 */
export async function prunePlaceholders({ board, all = false, apply = false } = {}) {
  const s = await loadStore();
  const known = new Set(s.repos.map((r) => deriveKey(r)));
  const only = board ? findBoardIn(s, board) : null;
  if (board && !only) throw notFound('看板不存在: ' + board);
  const items = [];
  for (const b of s.boards) {
    if (only && b.id !== only.id) continue;
    for (const k of boardRepoKeys(b, s)) {
      if (known.has(k)) continue;
      const hint = hintOf(b, k) || {};
      const remote = String(hint.remote || '');
      if (remote && !all) continue; // 能克隆回来的不算"无来源"
      items.push({ board: b.name, boardKey: boardKeyOf(b.name), key: k, name: hint.name || k, remote });
    }
  }
  if (apply && items.length) {
    await mutateStore((cur) => {
      const gone = new Set(items.map((it) => it.key));
      for (const it of items) {
        const b = cur.boards.find((x) => boardKeyOf(x.name) === it.boardKey);
        if (!b) continue;
        if (!Array.isArray(b.repoKeys)) b.repoKeys = boardRepoKeys(b, cur);
        b.repoKeys = b.repoKeys.filter((k) => k !== it.key);
        if (b.repoNotes) delete b.repoNotes[it.key];
        if (b.repoDocs) delete b.repoDocs[it.key];
        if (b.repoHints) delete b.repoHints[it.key];
      }
      // 指向这些占位的绑定一并摘掉：目标都不存在了，留着就是一条死链
      // （不摘的话 `repo ref check` 会一直报「绑定目标已不存在」）。
      for (const r of cur.repos) {
        if (!Array.isArray(r.linked)) continue;
        r.linked = r.linked.filter(
          (l) => !((l.kind === 'repo' || l.kind === 'ref') && gone.has(l.id))
        );
      }
    });
  }
  return { apply, total: items.length, items };
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

// 导出：看板 + 仓库的 key/name/desc + 组内描述 note（可回灌给 import 的同一结构）
export async function exportBoards() {
  const s = await loadStore();
  return {
    version: 1,
    boards: s.boards.map((b) => ({
      name: b.name,
      desc: b.desc,
      // 占位成员（本机没有登记）也导出——以前这里 filter 掉了它们，
      // 结果是「导出的看板比屏幕上看到的少人」，对方的组结构也跟着缺角。
      repos: boardRepoKeys(b, s).map((rkey) => {
        const r = s.repos.find((x) => deriveKey(x) === rkey);
        const hint = hintOf(b, rkey) || {};
        const note = noteOf(b, rkey);
        const entry = {
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
export async function applyPrefixGroup({ prefix: rawPrefix, board: rawBoard } = {}) {
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
