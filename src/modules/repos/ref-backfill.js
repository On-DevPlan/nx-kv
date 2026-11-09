// 仓库级参考绑定的**补录**工具（不是迁移）。
//
// 背景（2026-11-09）：v4 迁移把「ref 挂在开发仓库上」搬成了「ref 挂在组上」，
// 迁移完成后清掉了 dev 侧 ext.ext_linked 里的 {kind:'ref'} 条目。事后口径澄清：
// **组级与仓库级不是二选一**——参考仓库既可以绑到组，也可以绑到单个开发仓库，
// 两者并存、互不折算。因此需要把 v4 迁移时搬走的 20 条仓库级绑定恢复回来。
//
// **为什么不做成 v5 迁移**：
//   1. 仓库级绑定的存放位置从来没变过（repos.ext.ext_linked），这次不新增表/列，
//      升版本只会留下一条「对所有库都生效、但数据源是某一份外部快照」的迁移边；
//   2. 迁移是「结构演进」，必须对每个库都可执行；而这次的数据源是**一份特定的 v3
//      快照**，别的库没有这份快照，也不该被强制补录；
//   3. 补录要可重复、可审计、可预演（dry-run）——这正是工具命令的职责。
//
// 本工具只做一件事：读 v3（或更早）快照里每个 dev 仓库的仓库级 ref 绑定，
// 按 **key** 合并进当前库同名仓库的 linked。**不写 group_refs、不删不改组级绑定**。
// 因此重复执行是幂等的：第二次跑只会得到 0 条新增。
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { badInput } from '../../core/errors.js';
import * as service from './service.js';

function parseExt(text) {
  try {
    return JSON.parse(text || '{}') || {};
  } catch {
    return {};
  }
}

/**
 * 从快照读出「仓库 → 仓库级 ref 绑定」。只读打开源库，绝不改它。
 * v4 起的快照里这些条目已被迁移清空（user_version >= 4），直接拒绝，
 * 避免用户拿错文件后得到「0 条 = 看起来成功」的假结果。
 */
function readSource(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
    if (version >= 4) {
      throw badInput(
        `快照是 v${version}：v4 迁移已把仓库级绑定搬到组级并清空 ext —— 请给 v3 或更早的快照（~/.nx-kv/backups/nxkv-v3-*.db）`
      );
    }
    const rows = db.prepare('SELECT key, type, ext FROM repos WHERE deleted_at IS NULL').all();
    const repos = [];
    for (const row of rows) {
      if (row.type === 'group') continue;
      const ext = parseExt(row.ext);
      if (String(ext.ext_legacy_type || 'dev') === 'ref') continue;
      const links = [];
      const seen = new Set();
      const push = (id, note) => {
        const key = String(id || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        links.push(note ? { id: key, note: String(note) } : { id: key });
      };
      // v3 现在的键是 ext_linked；更早的库可能还是 ext_linked_refs（纯 id 数组）
      for (const l of Array.isArray(ext.ext_linked) ? ext.ext_linked : []) {
        if (l && l.kind === 'ref') push(l.id, l.note);
      }
      for (const id of Array.isArray(ext.ext_linked_refs) ? ext.ext_linked_refs : []) push(id, '');
      if (links.length) repos.push({ repo: String(row.key), links });
    }
    return { version, repos };
  } finally {
    db.close();
  }
}

const refKeysOf = (store) =>
  new Set(store.repos.filter((r) => (r.type || 'dev') === 'ref').map((r) => service.deriveKey(r)));

const directIdsOf = (repo) => (repo.linked || []).filter((l) => l && l.kind === 'ref').map((l) => String(l.id));

const countRepoLinks = (store) =>
  store.repos
    .filter((r) => (r.type || 'dev') !== 'ref')
    .reduce((n, r) => n + directIdsOf(r).length, 0);

const countGroupRefs = (store) => store.boards.reduce((n, b) => n + (b.refs || []).length, 0);

/**
 * 补录仓库级 ref 绑定。
 *   from     v3 快照 db 路径（只读）
 *   dryRun   只算差异，不落盘
 */
export async function backfillRepoLinks({ from, dryRun = false } = {}) {
  const raw = String(from || '').trim();
  if (!raw) throw badInput('请给 v3 快照路径: nx-kv repo ref backfill <v3.db> [--dry-run]');
  const file = resolve(raw);
  if (!existsSync(file)) throw badInput('快照不存在: ' + file);

  const src = readSource(file);
  const before = await service.loadStore();
  const refKeys = refKeysOf(before);
  const liveByKey = new Map(before.repos.map((r) => [service.deriveKey(r), r]));
  const missing = { repos: [], refs: [] };
  const perRepo = [];
  let wantAdd = 0;
  let already = 0;

  for (const item of src.repos) {
    const live = liveByKey.get(item.repo);
    if (!live) {
      missing.repos.push(item.repo);
      continue;
    }
    const had = new Set(directIdsOf(live));
    const added = [];
    const kept = [];
    for (const l of item.links) {
      if (!refKeys.has(l.id)) {
        if (!missing.refs.includes(l.id)) missing.refs.push(l.id);
        continue;
      }
      if (had.has(l.id)) kept.push(l.id);
      else added.push(l.id);
    }
    wantAdd += added.length;
    already += kept.length;
    perRepo.push({
      repo: item.repo,
      name: live.name,
      source: item.links.map((l) => l.id).sort(),
      before: [...had].sort(),
      after: [...had, ...added].sort(),
      added: added.sort(),
      already: kept.sort(),
    });
  }

  if (!dryRun && wantAdd) {
    await service.mutateStore((s) => {
      const byKey = new Map(s.repos.map((r) => [service.deriveKey(r), r]));
      const liveRefKeys = refKeysOf(s);
      for (const item of src.repos) {
        const live = byKey.get(item.repo);
        if (!live) continue;
        if (!Array.isArray(live.linked)) live.linked = [];
        for (const l of item.links) {
          if (!liveRefKeys.has(l.id)) continue;
          const hit = live.linked.find((x) => x && x.kind === 'ref' && String(x.id) === l.id);
          if (!hit) live.linked.push(l.note ? { kind: 'ref', id: l.id, note: l.note } : { kind: 'ref', id: l.id });
          else if (l.note && !hit.note) hit.note = l.note;
        }
      }
    });
  }

  const after = dryRun ? null : await service.loadStore();
  return {
    from: file,
    sourceVersion: src.version,
    dryRun,
    counts: {
      source: src.repos.reduce((n, x) => n + x.links.length, 0),
      before: countRepoLinks(before),
      after: dryRun ? countRepoLinks(before) + wantAdd : countRepoLinks(after),
      added: wantAdd,
      already,
    },
    groupRefs: {
      before: countGroupRefs(before),
      after: after ? countGroupRefs(after) : countGroupRefs(before),
    },
    perRepo,
    missing,
  };
}
