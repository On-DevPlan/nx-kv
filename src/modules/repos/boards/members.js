// 看板成员操作：聚合/移出（assign）、占位线索（hint）、占位重绑（rekey）、占位清理（prune）。
import {
  loadStore,
  mutateStore,
  storedBoardKey,
  boardRepoKeys,
  deriveKey,
  normalizeKey,
} from '../service.js';
import { badInput, notFound } from '../../../core/errors.js';
import { cleanText, findBoardIn, repoKeyIn, hintOf } from './core.js';

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
    if (rkey === '__unbound__') {
      throw badInput('哨兵仓库 __unbound__ 不能入组（它是「未绑定」占位，不是真实仓库）');
    }
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
      return { key: rkey, board: target ? storedBoardKey(target) : '', removed: true, count: n };
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
    return { key: rkey, board: storedBoardKey(target), removed: false, added: at < 0 };
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
      board: storedBoardKey(b),
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
      items.push({ board: b.name, boardKey: storedBoardKey(b), key: k, name: hint.name || k, remote });
    }
  }
  if (apply && items.length) {
    await mutateStore((cur) => {
      const gone = new Set(items.map((it) => it.key));
      for (const it of items) {
        const b = cur.boards.find((x) => storedBoardKey(x) === it.boardKey);
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
