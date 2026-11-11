// schema v3 → v4 的数据迁移（在 v4.sql 的同一个事务里执行）。
//
// 把「仓库级」的参考仓库绑定搬到「组级」：
//   1. ref 侧 ext_linked 的 {kind:'board'} → 直接落 group_refs（它本来就是组级绑定）；
//   2. ref 侧 ext_linked 的 {kind:'repo'} → 解析目标仓库所属的**每一个组**，各落一条；
//   3. dev 侧 ext_linked 的 {kind:'ref'}（含旧键 ext_linked_refs）→ 同上；
//   4. 同组同参考的多条来源合并为一条（note 取优先级最高的非空值：
//      组级描述 > 仓库级描述）；
//   5. 已迁移的条目从 ext 里删掉，未迁移的（无归属组的仓库绑定 / 目标已不存在）保留。
//
// **无归属组的仓库**：它身上的绑定一条都不搬，原样留在 ext 里 —— 不静默丢弃。
// 这类仓库的绑定由 `repo ref check` 显式报「未迁移」，加入组后再跑一次迁移即可
//（或重新 repo ref bind）。真实库当前为 0 条。
//
// 幂等：INSERT OR IGNORE + 迁移后清 ext；重复执行不会重复计入。
// 失败：由 migrator 的 step 事务整体回滚，user_version 停在 3，库仍可用。
import { nowMs } from '../time.js';
import type { DbApi } from '../driver.js';

/** repos.ext 的键名（与 modules/repos/repo/rows.js 同一口径，迁移层不依赖上层）。 */
const EXT_LINKED = 'ext_linked';
const EXT_LINKED_REFS = 'ext_linked_refs';
const EXT_LEGACY_TYPE = 'ext_legacy_type';

/** ext 里的一条绑定条目。 */
interface LinkEntry {
  kind: string;
  id: string;
  note: string;
}

/** 待落的 (group, ref) 绑定（同键多条来源合并成一条）。 */
interface PendingBinding {
  groupKey: string;
  refKey: string;
  note: string;
  prio: number;
}

/** step 003 的结果统计。 */
export interface GroupRefsResult {
  bindings: number;
  groups: number;
  repos: number;
  merged: number;
  ungrouped: number;
  dead: number;
  stripped: number;
}

function parseExt(raw: unknown): Record<string, any> {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** 行是参考仓库还是开发仓库（列 type 只二分 repo/group，dev/ref 在 ext）。 */
const legacyTypeOf = (ext: Record<string, any>): string =>
  String(ext[EXT_LEGACY_TYPE] || '') === 'ref' ? 'ref' : 'dev';

/** ext 里的绑定条目归一成 [{kind,id,note}]；旧键 ext_linked_refs 视为 kind='ref'。 */
function linksOf(ext: Record<string, any>): LinkEntry[] {
  const out: LinkEntry[] = [];
  const raw = ext[EXT_LINKED];
  if (Array.isArray(raw)) {
    for (const l of raw) {
      if (l && typeof l === 'object' && l.kind && l.id) {
        out.push({ kind: String(l.kind), id: String(l.id), note: String(l.note || '') });
      } else if (typeof l === 'string' && l) {
        out.push({ kind: 'ref', id: l, note: '' });
      }
    }
  }
  const legacy = ext[EXT_LINKED_REFS];
  if (Array.isArray(legacy)) {
    for (const id of legacy) if (id) out.push({ kind: 'ref', id: String(id), note: '' });
  }
  return out;
}

/**
 * step 003 的 apply。`ctx` 由 bootstrap 传入：{ atMs }。
 * @returns {{bindings:number, groups:number, repos:number, merged:number,
 *            ungrouped:number, dead:number, stripped:number}}
 */
export function migrateGroupRefs(conn: DbApi, { atMs = nowMs() }: { atMs?: number } = {}): GroupRefsResult {
  const rows = conn.all("SELECT key, type, ext FROM repos WHERE deleted_at IS NULL");
  const refKeys = new Set<string>();
  const groupKeys = new Set<string>();
  for (const row of rows) {
    const ext = parseExt(row.ext);
    if (String(row.type) === 'group') groupKeys.add(String(row.key));
    else if (legacyTypeOf(ext) === 'ref') refKeys.add(String(row.key));
  }

  const groupsByRepo = new Map<string, string[]>();
  for (const m of conn.all('SELECT group_key, repo_key FROM repo_group_members')) {
    const gk = String(m.group_key);
    const rk = String(m.repo_key);
    if (!groupKeys.has(gk)) continue;
    if (!groupsByRepo.has(rk)) groupsByRepo.set(rk, []);
    groupsByRepo.get(rk)?.push(gk);
  }

  // (group, ref) → { note, prio }；prio 越小优先级越高（0=组级描述，1=仓库级描述）
  const pending = new Map<string, PendingBinding>();
  const push = (groupKey: string, refKey: string, note: unknown, prio: number): void => {
    const k = groupKey + '\u0000' + refKey;
    const cur = pending.get(k) || { groupKey, refKey, note: '', prio: Number.POSITIVE_INFINITY };
    const text = String(note || '').trim();
    if (text && (prio < cur.prio || !cur.note)) {
      cur.note = text;
      cur.prio = prio;
    }
    pending.set(k, cur);
  };

  // ext 改写表：key → 剩下的 linked 数组（undefined = 不改；null = 删干净）
  const strip = new Map<string, LinkEntry[]>();
  let ungrouped = 0;
  let dead = 0;

  // ① ref 侧：组级绑定（board）优先，其次目标仓库所属的每个组
  for (const row of rows) {
    const key = String(row.key);
    if (String(row.type) === 'group') continue;
    const ext = parseExt(row.ext);
    if (legacyTypeOf(ext) !== 'ref') continue;
    const links = linksOf(ext);
    if (!links.length) continue;
    const remain: LinkEntry[] = [];
    let changed = Array.isArray(ext[EXT_LINKED_REFS]);
    for (const l of links) {
      if (l.kind === 'board' && groupKeys.has(l.id)) {
        push(l.id, key, l.note, 0);
        changed = true;
        continue;
      }
      if (l.kind === 'repo') {
        const groups = groupsByRepo.get(l.id) || [];
        if (groups.length) {
          for (const gk of groups) push(gk, key, l.note, 1);
          changed = true;
          continue;
        }
        // 目标仓库没有组：绑定原样保留（等仓库入组后再迁移）
      }
      remain.push(l);
    }
    if (changed) strip.set(key, remain);
  }

  // ② dev 侧：{kind:'ref'} 反向引用（含旧键 ext_linked_refs）
  for (const row of rows) {
    const key = String(row.key);
    if (String(row.type) === 'group') continue;
    const ext = parseExt(row.ext);
    if (legacyTypeOf(ext) === 'ref') continue;
    const links = linksOf(ext);
    const refLinks = links.filter((l) => l.kind === 'ref');
    if (!refLinks.length) continue;
    const groups = groupsByRepo.get(key) || [];
    if (!groups.length) {
      // 无组仓库：一条都不搬，原样留在 ext（不静默丢弃）
      ungrouped += refLinks.length;
      continue;
    }
    for (const l of refLinks) {
      if (!refKeys.has(l.id)) {
        dead += 1;
        continue;
      }
      for (const gk of groups) push(gk, l.id, l.note, 1);
    }
    strip.set(key, links.filter((l) => l.kind !== 'ref'));
  }

  // ③ 落 group_refs（同组内按首次出现排位）
  let bindings = 0;
  const pos = new Map<string, number>();
  for (const { groupKey, refKey, note } of pending.values()) {
    const p = pos.get(groupKey) || 0;
    const r = conn.run(
      `INSERT OR IGNORE INTO group_refs (group_key, ref_key, note, position, created_at)
       VALUES (:g, :r, :n, :p, :at)`,
      { g: groupKey, r: refKey, n: note, p, at: atMs }
    );
    if (Number(r.changes) > 0) {
      bindings += 1;
      pos.set(groupKey, p + 1);
    }
  }

  // ④ 清掉已迁移的 ext 条目（保留未迁移的）
  for (const [key, remain] of strip) {
    const row = rows.find((x) => String(x.key) === key);
    if (!row) continue;
    const ext = parseExt(row.ext);
    delete ext[EXT_LINKED_REFS];
    if (remain.length) ext[EXT_LINKED] = remain;
    else delete ext[EXT_LINKED];
    conn.run('UPDATE repos SET ext = :ext, updated_at = :at WHERE key = :key', {
      ext: JSON.stringify(ext),
      at: atMs,
      key,
    });
  }

  return {
    bindings,
    groups: new Set([...pending.values()].map((x) => x.groupKey)).size,
    repos: new Set([...pending.values()].map((x) => x.refKey)).size,
    merged: pending.size - bindings,
    ungrouped,
    dead,
    stripped: strip.size,
  };
}
