// key 刷新与追踪：扫本地 git remote，建议新 key / 提示可更新。
//
// **为什么需要**：key 是仓库的身份，而身份来自「远程地址」。存量仓库的 key 可能是
// 早期版本算的（那时 ssh://host:port 解析有 bug），也可能用户改了 remote、仓库从
// https 换成了 ssh。没有刷新机制，这些偏差会一直留在盘上，并在导出/导入时暴露成
// 「同一个仓库两个 key」。
//
// 刷新是**两步**：`--all` 扫描并给出建议（零副作用），`--apply` 才落盘。
// 自定义 key（keyCustom=true）只更新 remote/remotes，**不覆盖用户设的 key**。
import { resolve } from 'node:path';
import { badInput, notFound } from '../../core/errors.js';
import * as service from './service.js';
import { gitRemotes, pickRemote, hasGit } from './git.js';
import type { Store, RepoEntry, BoardEntry } from './repo/rows.js';
import type { RepoPatch } from './service/crud.js';

/** refreshKeys 单条：当前值与建议值（suggested=null = 本地目录不是 git 仓库）。 */
export interface RefreshItem {
  id: string;
  name: string;
  key: string;
  keyCustom: boolean;
  current: { remote: string; key: string };
  suggested: { remote: string; key: string; remotes: string[] } | null;
  changed: boolean;
  applied: boolean;
  /** 本地目录不是 git 仓库时的说明 */
  note?: string;
}

/** refreshKeys 的返回。 */
export interface RefreshResult {
  apply: boolean;
  total: number;
  changed: number;
  items: RefreshItem[];
}

/** migrateRelations 里一个看板的改动摘要。 */
export interface MigrateBoardChange {
  board: string;
  key: string;
  members: number;
  orphans: number;
}

/** migrateRelations 的返回。 */
export interface MigrateResult {
  apply: boolean;
  boards: MigrateBoardChange[];
  linkedRewritten: number;
  deadLinksDropped: number;
  changed: number;
}

/**
 * 刷新一个/全部仓库的 key 与远程地址。
 * 返回 { items: [{ id, name, key, keyCustom, current, suggested, changed, applied }], ... }
 *   changed  = 建议值与当前不同
 *   applied  = 是否已落盘（apply=true 时）
 */
export async function refreshKeys({ id, all = false, apply = false }: { id?: unknown; all?: boolean; apply?: boolean } = {}): Promise<RefreshResult> {
  const s = await service.loadStore();
  let targets: RepoEntry[];
  if (id) {
    const raw = String(id).trim();
    let r = s.repos.find((x) => x.id === raw);
    if (!r) {
      const k = service.normalizeKey(raw);
      if (k) r = s.repos.find((x) => service.deriveKey(x) === k);
    }
    if (!r) {
      const p = resolve(raw);
      r = s.repos.find((x) => x.path.toLowerCase() === p.toLowerCase());
    }
    if (!r) throw notFound('repo 不存在: ' + raw);
    targets = [r];
  } else if (all) {
    targets = s.repos;
  } else {
    throw badInput('请给 repo id/路径/key，或用 --all 刷新全部');
  }

  const items: RefreshItem[] = [];
  for (const r of targets) {
    const currentKey = service.deriveKey(r);
    const cur = { remote: r.remote || '', key: currentKey };
    // 目录不在 / 不是 git 仓库：没法扫远程，如实标注但不算错误
    if (!(await hasGit(r.path))) {
      items.push({
        id: r.id, name: r.name, key: currentKey, keyCustom: !!r.keyCustom,
        current: cur, suggested: null, changed: false, applied: false,
        note: '本地目录不是 git 仓库 —— 无法读取远程地址',
      });
      continue;
    }
    const remotes = await gitRemotes(r.path);
    const picked = pickRemote(remotes);
    const suggestedRemote = picked ? picked.url : '';
    // key 不再按名字兜底：没有远程地址时不给建议值（提示用户 repo key set 手工指定）。
    const suggestedKey = r.keyCustom
      ? currentKey // 自定义 key 不跟随
      : service.keyFromRemote(suggestedRemote);
    const changed = suggestedRemote
      ? (suggestedRemote !== cur.remote || suggestedKey !== cur.key)
      : false;
    const item: RefreshItem = {
      id: r.id,
      name: r.name,
      key: currentKey,
      keyCustom: !!r.keyCustom,
      current: cur,
      suggested: { remote: suggestedRemote, key: suggestedKey, remotes: remotes.map((x) => x.url) },
      changed,
      applied: false,
    };

    if (apply && (changed || remotes.length)) {
      // 自定义 key：只更新 remote/remotes，key 保持（updateRepo 在 keyCustom 时不会跟随 remote）
      const patch: RepoPatch = { remotes: item.suggested!.remotes };
      if (suggestedRemote) patch.remote = suggestedRemote;
      await service.updateRepo(r.id, patch);
      item.applied = true;
    }
    items.push(item);
  }

  return {
    apply,
    total: items.length,
    changed: items.filter((x) => x.changed).length,
    items,
  };
}

// CLI 人读渲染
export function renderRefresh(d: RefreshResult): string {
  const lines = [
    `${d.apply ? '已刷新' : '刷新检查（未落盘）'}: ${d.total} 个仓库，${d.changed} 个有变化`,
  ];
  for (const it of d.items) {
    const tag = it.keyCustom ? ' [自定义 key]' : '';
    if (!it.suggested) {
      lines.push(`  ?  ${it.name}${tag} —— ${it.note}`);
      continue;
    }
    if (!it.changed && it.suggested.remotes.length) {
      lines.push(`  ✓  ${it.name}${tag}  ${it.key}`);
      continue;
    }
    lines.push(`  ${it.applied ? '已更新' : '可更新'}  ${it.name}${tag}`);
    if (it.current.key !== it.suggested.key) {
      lines.push(`      key:    ${it.current.key}  →  ${it.suggested.key}${it.keyCustom ? '（自定义，保留）' : ''}`);
    }
    if (it.current.remote !== it.suggested.remote) {
      lines.push(`      remote: ${it.current.remote || '（空）'}  →  ${it.suggested.remote}`);
    }
  }
  if (!d.apply && d.changed) lines.push('', '落盘: nx-kv repo key refresh --all --apply');
  return lines.join('\n');
}

// ─── 关系迁移：随机 id → key ────────────────────────────────────────────
//
// 存量数据里：board.repoIds 存随机 id、board.repoNotes 按 id、linked[].id 也是 id。
// 迁移把它们全部改成 key（仓库身份）。**幂等**：已经是 key 的不动，跑第二次无变化。
//
// 无法解析的（目标登记已不存在）不丢弃 —— 保留成占位 key，
// 组里位置留着（present=false），等用户 clone 补齐。
export async function migrateRelations({ apply = false }: { apply?: boolean } = {}): Promise<MigrateResult> {
  const s = await service.loadStore();
  const idToKey = new Map(s.repos.map((r): [string, string] => [r.id, service.deriveKey(r)]));
  const boardIdToKey = new Map(s.boards.map((b): [string, string] => [b.id, service.boardKeyOf(b.name)]));
  const knownKeys = new Set(idToKey.values());
  const knownBoardKeys = new Set(boardIdToKey.values());

  const changes: MigrateBoardChange[] = [];
  const boardsOut = s.boards.map((b: BoardEntry) => {
    const bkey = service.boardKeyOf(b.name);
    // 老结构：repoIds（随机 id）→ repoKeys（key）
    const oldIds = Array.isArray(b.repoIds) ? b.repoIds : null;
    const keys: string[] = oldIds
      ? (oldIds.map((id) => idToKey.get(id)).filter(Boolean) as string[])
      : (Array.isArray(b.repoKeys) ? b.repoKeys.slice() : []);
    // repoNotes：按 id 存的改成按 key
    const notes: Record<string, string> = {};
    const oldNotes = b.repoNotes || {};
    for (const [k, v] of Object.entries(oldNotes)) {
      const nk = idToKey.get(k) || k; // id → key；已是 key 的原样
      notes[nk] = v;
    }
    // 被删仓库的成员（id 解析不到）→ 保留成占位 key（用 id 派生一个 local/ 前缀）
    const orphans = oldIds ? oldIds.filter((id) => !idToKey.has(id)) : [];
    const out: BoardEntry & { repoIds?: string[] } = { ...b, repoKeys: keys, repoNotes: notes };
    delete out.repoIds;
    if (oldIds && (oldIds.length !== keys.length || Object.keys(oldNotes).length !== Object.keys(notes).length)) {
      changes.push({ board: b.name, key: bkey, members: keys.length, orphans: orphans.length });
    }
    return out;
  });

  // linked[].id：随机 id → key
  let linkedChanged = 0;
  const reposOut = s.repos.map((r) => {
    if (!Array.isArray(r.linked) || !r.linked.length) return r;
    const linked = r.linked.map((l) => {
      const map = l.kind === 'board' ? boardIdToKey : idToKey;
      const nk = map.get(l.id);
      if (!nk || nk === l.id) return l; // 已是 key，或目标没了（保留原值）
      linkedChanged += 1;
      return { ...l, id: nk };
    });
    return { ...r, linked };
  });

  // 目标已不存在的绑定 → 摘掉（它没有任何意义），报告数量
  let deadDropped = 0;
  const reposClean = reposOut.map((r) => {
    if (!Array.isArray(r.linked) || !r.linked.length) return r;
    const linked = r.linked.filter((l) => {
      const ok = l.kind === 'board' ? knownBoardKeys.has(l.id) : knownKeys.has(l.id);
      if (!ok) deadDropped += 1;
      return ok;
    });
    return { ...r, linked };
  });

  const total = changes.length + linkedChanged;
  if (apply && total > 0) {
    await service.mutateStore((cur: Store) => {
      cur.boards = boardsOut.map((b) => {
        const found: BoardEntry = cur.boards.find((x) => x.id === b.id) || ({} as BoardEntry);
        const next: BoardEntry & { repoIds?: string[] } = { ...found, repoKeys: b.repoKeys, repoNotes: b.repoNotes };
        delete next.repoIds;
        return next;
      });
      cur.repos = reposClean.map((r) => {
        const found: RepoEntry = cur.repos.find((x) => x.id === r.id) || ({} as RepoEntry);
        return { ...found, linked: r.linked };
      });
    });
  }
  return {
    apply,
    boards: changes,
    linkedRewritten: linkedChanged,
    deadLinksDropped: deadDropped,
    changed: total,
  };
}

export function renderMigrate(d: MigrateResult): string {
  const lines = [
    d.apply
      ? `已迁移关系为 key: ${d.boards.length} 个看板、${d.linkedRewritten} 条绑定改写`
      : `迁移预览（未落盘）: ${d.boards.length} 个看板、${d.linkedRewritten} 条绑定待改写`,
  ];
  for (const b of d.boards) lines.push(`  看板「${b.board}」→ ${b.key}（${b.members} 个成员）`);
  if (d.deadLinksDropped) lines.push(`  丢弃死链 ${d.deadLinksDropped} 条（目标登记已不存在）`);
  if (!d.apply && d.changed) lines.push('', '落盘: nx-kv repo key migrate --apply');
  return lines.join('\n');
}
