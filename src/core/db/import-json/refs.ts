// refs / ref_bindings 阶段：refs 磁盘上从来没有过 JSON 数据源，初值从两处重建 ——
//   1. `repos.json` 的 DocRef（doc / docLinks / repoDocs）
//   2. `docs/` 树扫描（未被任何 DocRef 指到的 → state='orphan'）
// `ref_relations` 本轮留空。
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { groupKeyOf } from '../../keys.js';
import { refIdOf } from './data.js';
import type { ImportReport } from './data.js';
import type { DbApi } from '../driver.js';
import type { Dirent } from 'node:fs';

/** 一条 DocRef（repos.json 里对文档的引用）。 */
interface DocRefEntry {
  locator: string;
  type: string;
  note: string;
  extPath: string;
}

/** docs 树的相对路径 → POSIX（库里的地址永远是正斜杠）。 */
function toPosix(rel: string): string {
  return rel.split(sep).join('/');
}

/** 外部绝对路径 / URL → v6 的逻辑 rel（与 v6-data 同一口径）。 */
function externalRel(locator: string): string {
  let seed = isAbsolute(locator) ? toPosix(resolve(locator)) : locator;
  if (/^[A-Z]:/.test(seed)) seed = seed.charAt(0).toLowerCase() + seed.slice(1);
  return 'external/' + createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16);
}

/** 递归收集旧文档目录里的 .md（返回 POSIX 相对路径）。**仅 legacy JSON 导入用。** */
export function listDocFiles(docsDir: string): string[] {
  const out: string[] = [];
  if (!docsDir || !existsSync(docsDir)) return out;
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, prefix ? `${prefix}/${e.name}` : e.name);
      else if (/\.md$/i.test(e.name)) out.push(prefix ? `${prefix}/${e.name}` : e.name);
    }
  };
  walk(docsDir, '');
  return out.map(toPosix).sort();
}

/**
 * 索引层初值重建。另外按**约定路径**把"仓库介绍 / 组介绍 / 组内成员说明"绑到宿主上
 * （`repo/<key>.md`、`board/<slug>.md`、`group/<slug>/<key>.md`，以及它们的
 *  目录主篇 `<dir>/index.md`）。约定路径是 docs 模块读文档时的回落顺序，
 * 迁移时按同一顺序探一次，绑定关系才不会丢。
 */
export function importRefs(
  db: DbApi,
  reposData: any,
  docsDir: string,
  atMs: number,
  report: ImportReport
): void {
  const files = listDocFiles(docsDir);
  const fileSet = new Set(files);
  for (const locator of files) {
    const r = db.run(
      `INSERT INTO refs (id, type, rel, locator, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :rel, :locator, 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      { id: refIdOf(locator), rel: locator, locator, at: atMs }
    );
    if (Number(r.changes) > 0) report.imported.refs += 1;
  }

  // legacy id → 真实 key：repos 合并/重名加后缀后，旧 id 对应的 key 可能已经不是
  // 原始字符串。绑定前必须按真实行校验（否则 FK 一拒，整个迁移回滚）。
  const repoKeyById = new Map<string, string>();
  const groupKeyById = new Map<string, string>();
  for (const row of db.all("SELECT key, type, ext FROM repos WHERE deleted_at IS NULL")) {
    let ext: Record<string, any> = {};
    try {
      ext = JSON.parse(String(row.ext || '{}')) || {};
    } catch {
      ext = {};
    }
    const lid = ext && ext.ext_legacy_id;
    if (lid === undefined || lid === null || lid === '') continue;
    if (row.type === 'group') groupKeyById.set(String(lid), String(row.key));
    else repoKeyById.set(String(lid), String(row.key));
  }
  const isRepo = (k: string): boolean =>
    !!db.get("SELECT 1 AS x FROM repos WHERE key = :k AND type <> 'group' AND deleted_at IS NULL", { k });
  const isGroup = (k: string): boolean =>
    !!db.get("SELECT 1 AS x FROM repos WHERE key = :k AND type = 'group' AND deleted_at IS NULL", { k });

  const bind = (
    repoKey: string,
    groupKey: string | null,
    locator: string,
    type: string,
    position: number,
    note: string
  ): boolean => {
    if (!fileSet.has(locator)) return false;
    const id = refIdOf(locator);
    db.run(`UPDATE refs SET state = '' WHERE id = :id`, { id });
    // ON CONFLICT 的冲突目标带表达式（COALESCE）在 SQLite 里要写成一模一样的表达式，
    // 这里用 INSERT OR IGNORE：绑定边重复插是幂等的正常情况，不该报错。
    const r = db.run(
      `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
       VALUES (:repo, :group, :ref, :type, :pos, :note, :at)`,
      { repo: repoKey, group: groupKey, ref: id, type, pos: position, note, at: atMs }
    );
    if (Number(r.changes) > 0) report.imported.refBindings += 1;
    return true;
  };

  const repos = Array.isArray(reposData && reposData.repos) ? reposData.repos : [];
  const boards = Array.isArray(reposData && reposData.boards) ? reposData.boards : [];

  // DocRef（本机 repos.json 没有这些字段，代码保留给别的机器）
  const docRefsOf = (host: any): DocRefEntry[] => {
    const out: DocRefEntry[] = [];
    const pushRef = (ref: any, note: string = ''): void => {
      if (!ref || typeof ref !== 'object') return;
      const rel = String(ref.rel || '').trim();
      const path = String(ref.path || '').trim();
      if (rel) out.push({ locator: rel, type: 'md', note: String(ref.tag || note || ''), extPath: '' });
      // v2 起 refs 只装文档：外部 .md 绝对路径也是文档，type 统一为 md。
      else if (path) out.push({ locator: path, type: 'md', note: String(ref.tag || note || ''), extPath: path });
    };
    pushRef(host && host.doc);
    for (const l of Array.isArray(host && host.docLinks) ? host.docLinks : []) pushRef(l);
    if (host && host.repoDocs && typeof host.repoDocs === 'object') {
      for (const [k, v] of Object.entries(host.repoDocs)) pushRef(v, k);
    }
    return out;
  };

  let position = 0;
  for (const r of repos) {
    const legacyKey = String((r && r.key) || '').trim();
    if (!legacyKey) continue;
    const key = repoKeyById.get(String(r.id)) || legacyKey;
    if (!isRepo(key)) {
      report.warnings.push({ what: 'docRef', why: '宿主仓库不存在（合并/改名后失配），已跳过该仓库的文档绑定', repo: legacyKey });
      continue;
    }
    // 约定路径：目录主篇优先，其次旧单文件（与 docs 模块的读回落顺序一致）
    position = 0;
    const boundMain = bind(key, null, `repo/${key}/index.md`, 'repo', position, '');
    if (!boundMain) bind(key, null, `repo/${key}.md`, 'repo', position, '');
    position += 1;
    for (const d of docRefsOf(r)) {
      if (d.extPath) {
        // 外部路径（Obsidian 等）：只在库里留地址，字节在库外
        db.run(
          `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at)
           VALUES (:id, :type, :rel, :locator, 'external', '', 0, NULL, :at, :at)
           ON CONFLICT(id) DO NOTHING`,
          {
            id: refIdOf(d.locator),
            type: d.type,
            rel: externalRel(d.locator),
            locator: d.locator,
            at: atMs,
          }
        );
        report.imported.refs += 1;
      } else if (!fileSet.has(d.locator)) {
        // 相对 DocRef 指向的文件不在 docs 树里：没有 refs 行，绑定会撞 FK → 跳过并记账
        report.warnings.push({ what: 'docRef', why: '引用文件不在 docs 树里，已跳过绑定', repo: key, locator: d.locator });
        continue;
      }
      const br = db.run(
        `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, created_at)
         VALUES (:repo, NULL, :ref, 'repo', :pos, :note, :at)`,
        { repo: key, ref: refIdOf(d.locator), pos: position, note: d.note, at: atMs }
      );
      if (Number(br.changes) > 0) report.imported.refBindings += 1;
      position += 1;
    }
  }

  // 组（boards）自身的介绍 + 组内成员说明
  for (const b of boards) {
    const name = String((b && b.name) || '').trim();
    if (!name) continue;
    const base = groupKeyOf(name);
    const byName = db.get("SELECT key FROM repos WHERE type = 'group' AND name = :n AND deleted_at IS NULL", { n: name });
    const gk: string = groupKeyById.get(String(b.id)) || (isGroup(base) ? base : byName && byName.key) || base;
    if (!isGroup(gk)) {
      report.warnings.push({ what: 'docRef', why: '组宿主不存在，已跳过该组的文档绑定', group: name });
      continue;
    }
    const seg = base.slice('group/'.length);
    const boundGroup = bind(gk, null, `board/${seg}/index.md`, 'group', 0, '');
    if (!boundGroup) bind(gk, null, `board/${seg}.md`, 'group', 0, '');
    for (const repoKeyRaw of Array.isArray(b.repoKeys) ? b.repoKeys : []) {
      const repoKey = repoKeyById.get(String(repoKeyRaw || '').trim()) || String(repoKeyRaw || '').trim();
      if (!repoKey) continue;
      if (!isRepo(repoKey)) {
        report.warnings.push({ what: 'docRef', why: '组成员不存在，已跳过成员文档绑定', group: gk, repo: repoKey });
        continue;
      }
      const boundMember = bind(repoKey, gk, `group/${seg}/${repoKey}/index.md`, 'group_repo', 0, '');
      if (!boundMember) bind(repoKey, gk, `group/${seg}/${repoKey}.md`, 'group_repo', 0, '');
    }
  }

  // 没被任何绑定引用的 ref 保持 state='orphan'（面板要能列出"孤儿文档"）
  const orphans = db.get("SELECT count(*) AS c FROM refs WHERE state = 'orphan'");
  if (orphans && orphans.c) {
    report.warnings.push({ what: 'refs', why: '孤儿文档（未被任何宿主绑定）', count: Number(orphans.c) });
  }
}
