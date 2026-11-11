// repos / boards / members 阶段：legacy repos.json → repos 表 + repo_group_members。
//
// 审计裁定：不做远程融合、不做"按路径猜 key"，key 原样入驻；
// legacy 的 type（ref / dev）不是新 schema 的二分（repo/group），存 ext 取证。
import { groupKeyOf } from '../../keys.js';
import { anyTimeMs } from '../time.js';
import { emptyReport, jsonText, stringOrNull, SENTINEL_REPO_KEY, SENTINEL_REPO_NAME } from './data.js';
import type { ImportReport } from './data.js';
import type { DbApi } from '../driver.js';

/** 本阶段的结果（后续阶段（refs / members）要用 legacy id → 真实 key 的映射）。 */
export interface ImportReposResult {
  legacyIdToKey: Map<string, string>;
  boardLegacyIdToKey: Map<string, string>;
  groupKeys: string[];
  boardNames: string[];
}

/** 哨兵仓库必须**永远在场**：topics.repo_key 是 NOT NULL 外键，没有它连一条队列都建不出来。
 *  幂等（已存在跳过）。bootstrap 在建表后无条件调用 —— 与「有没有 legacy JSON」无关。 */
export function ensureSentinelRepo(db: DbApi, atMs: number, report: ImportReport = emptyReport()): void {
  const exists = db.get('SELECT key FROM repos WHERE key = :k', { k: SENTINEL_REPO_KEY });
  if (exists) return;
  db.run(
    `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                        deleted_at, created_at, updated_at)
     VALUES (:key, 'repo', :name, :desc, '', '', -1, :ext, '', 0, NULL, :at, :at)`,
    {
      key: SENTINEL_REPO_KEY,
      name: SENTINEL_REPO_NAME,
      desc: '迁移时承载"对不上真实仓库"的队列与全局池；不是用户登记的仓库（面板默认隐藏）',
      ext: jsonText({ ext_sentinel: 1 }),
      at: atMs,
    }
  );
  report.imported.repos += 1;
}

export function importRepos(db: DbApi, reposData: any, atMs: number, report: ImportReport): ImportReposResult {
  const repos = Array.isArray(reposData && reposData.repos) ? reposData.repos : [];
  const boards = Array.isArray(reposData && reposData.boards) ? reposData.boards : [];

  ensureSentinelRepo(db, atMs, report);

  const seen = new Set([SENTINEL_REPO_KEY]);
  const legacyIdToKey = new Map<string, string>(); // 旧 r_xxx → 新 key
  const boardLegacyIdToKey = new Map<string, string>(); // 旧 b_xxx → 组 key

  repos.forEach((r: any, index: number) => {
    const key = String((r && r.key) || '').trim();
    if (!key) {
      report.warnings.push({ what: 'repo', why: 'key 为空（repos.key 是身份，不能伪造）', legacy: r && r.id });
      return;
    }
    if (seen.has(key)) {
      report.warnings.push({ what: 'repo', why: 'key 重复', key });
      return;
    }
    seen.add(key);
    if (r.id) legacyIdToKey.set(String(r.id), key);

    const ext: Record<string, any> = {};
    if (r.id) ext.ext_legacy_id = String(r.id);
    if (r.type) ext.ext_legacy_type = String(r.type);
    if (r.notes) ext.ext_notes = String(r.notes);
    if (r.icon) ext.ext_icon = String(r.icon);
    if (Array.isArray(r.remotes) && r.remotes.length) ext.ext_remotes = r.remotes.map(String);
    if (r.keyCustom) ext.ext_key_custom = 1;
    if (r.keyUpdatedAt) ext.ext_key_updated_at = stringOrNull(r.keyUpdatedAt);
    // `linked` 里 kind='board' 的是 repo_group_members 的反向查询（下面的入组边负责），
    // kind='ref' 的是"参考仓库"关系 —— 新 schema 没有这张表，存 ext 取证 + 报告。
    const refLinks = Array.isArray(r.linked) ? r.linked.filter((x: any) => x && x.kind === 'ref').map((x: any) => String(x.id)) : [];
    if (refLinks.length) {
      ext.ext_linked_refs = refLinks;
      report.discarded.push({ what: 'repo.linked(kind=ref)', key, count: refLinks.length, note: '新 schema 无仓库↔仓库关系表，存 ext 取证' });
    }

    const createdAt = anyTimeMs(r.addedAt, atMs);
    const updatedAt = anyTimeMs(r.updatedAt, createdAt);
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:key, 'repo', :name, :desc, :path, :remote, :sort, :ext, :state, :version,
               :deleted, :created, :updated)`,
      {
        key,
        name: String(r.name || key),
        desc: String(r.desc || ''),
        path: String(r.path || ''),
        remote: String(r.remote || (Array.isArray(r.remotes) ? r.remotes[0] : '') || ''),
        sort: index,
        ext: jsonText(ext),
        state: String(r.state || ''),
        version: Number(r.version) || 0,
        deleted: r.deletedAt ? anyTimeMs(r.deletedAt, null) : null,
        created: createdAt,
        updated: updatedAt,
      }
    );
    report.imported.repos += 1;
  });

  // ── boards → repos(type='group') ──
  // key = `group/<slug(初始 name)>`：**冻结**（name 之后可改，key 不变）。
  // 冻结的理由与 repos.key 同理：key 是身份，跟着显示名漂会让外部引用全断。
  const groupKeys: string[] = [];
  boards.forEach((b: any, index: number) => {
    const name = String((b && b.name) || '').trim();
    if (!name) {
      report.warnings.push({ what: 'board', why: 'name 为空，无法派生组 key', legacy: b && b.id });
      return;
    }
    let key = groupKeyOf(name);
    if (seen.has(key)) {
      // slug 冲突（同名组 / 与仓库 key 撞车）→ 加序号后缀 + 报告，绝不覆盖
      let n = 2;
      while (seen.has(`${key}-${n}`)) n += 1;
      report.warnings.push({ what: 'board', why: `组 key 冲突，改用后缀 -${n}`, from: key, to: `${key}-${n}` });
      key = `${key}-${n}`;
    }
    seen.add(key);
    groupKeys.push(key);
    if (b.id) boardLegacyIdToKey.set(String(b.id), key);

    const ext: Record<string, any> = {};
    if (b.id) ext.ext_legacy_id = String(b.id);
    const createdAt = anyTimeMs(b.createdAt, atMs);
    db.run(
      `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version,
                          deleted_at, created_at, updated_at)
       VALUES (:key, 'group', :name, :desc, '', '', :sort, :ext, '', 0, NULL, :created, :updated)`,
      {
        key,
        name,
        desc: String(b.desc || ''),
        sort: index,
        ext: jsonText(ext),
        created: createdAt,
        updated: anyTimeMs(b.updatedAt, createdAt),
      }
    );
    report.imported.repos += 1;
  });

  // ── members（组 ← 仓库）──
  boards.forEach((b: any, bi: number) => {
    const groupKey = groupKeys[bi];
    if (!groupKey) return;
    const notesIn = b.repoNotes && typeof b.repoNotes === 'object' ? b.repoNotes : {};
    let keys: any[] = Array.isArray(b.repoKeys) ? b.repoKeys : [];
    let notes: any = notesIn;
    // 老结构（迁移前的存量数据）：成员存随机 id（repoIds / repoNotes 按 id 键）。
    // repos 已全部入库（legacyIdToKey 齐），一次性换算成 key；换算不到的丢弃 + 报告
    //（与 JSON 时代 keys.js migrateRelations 同一口径，只是搬进了导入事务）。
    const oldIds = Array.isArray(b.repoIds) ? b.repoIds : null;
    if (!keys.length && oldIds && oldIds.length) {
      keys = [];
      for (const id of oldIds) {
        const k = legacyIdToKey.get(String(id));
        if (k) keys.push(k);
        else report.warnings.push({ what: 'member', why: 'repoIds 里的 id 换算不到 key（登记缺失），已丢弃', group: groupKey, id: String(id) });
      }
      notes = {};
      for (const [k, v] of Object.entries(notesIn)) notes[legacyIdToKey.get(String(k)) || k] = v;
      report.warnings.push({ what: 'member', why: 'repoIds（旧结构）已换算为 repoKeys', group: groupKey, count: keys.length });
    }
    keys.forEach((repoKeyRaw: any, position: number) => {
      const repoKey = String(repoKeyRaw || '').trim();
      if (!repoKey) return;
      if (!db.get('SELECT key FROM repos WHERE key = :k', { k: repoKey })) {
        // 脏数据（组里挂了一个不存在的仓库）→ 记报告丢弃，不整体回滚
        report.warnings.push({ what: 'member', why: '成员仓库不存在，已丢弃', group: groupKey, repo: repoKey });
        return;
      }
      if (repoKey === groupKey) {
        report.warnings.push({ what: 'member', why: '组把自己当成员，已丢弃', group: groupKey });
        return;
      }
      db.run(
        `INSERT INTO repo_group_members (group_key, repo_key, position, note, created_at)
         VALUES (:g, :r, :pos, :note, :at)
         ON CONFLICT(group_key, repo_key) DO NOTHING`,
        { g: groupKey, r: repoKey, pos: position, note: String(notes[repoKey] || ''), at: atMs }
      );
      report.imported.members += 1;
    });
  });

  return { legacyIdToKey, boardLegacyIdToKey, groupKeys, boardNames: boards.map((b: any) => String((b && b.name) || '')) };
}
