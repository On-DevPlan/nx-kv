// schema v5 → v6 的数据迁移（在 v6.sql 的同一个事务里执行）。
//
// 口径（2026-11-12 二轮确认，docs/decisions/2026-11-12-refs-body-in-db.md §11）：
//   1. 存量 refs 归位：相对 locator → rel=locator（origin=import）；
//      空 locator → rel=legacy/<id>；绝对路径 / URL → rel=external/<sha1(规范化)>；
//   2. 盘上 docs 树 31 篇正文 → ref_bodies，逐篇 sha256 回读比对（硬门禁）；
//   3. 外部绝对路径且文件仍在 → 登记 attachments(kind='mdfile') + ref_attach(role='source')；
//      文件不在 → 只留空壳；
//   4. 盘上无文件的 102 行保持空壳：不软删、不删行、body_bytes=0；
//   5. 存量 id 一律保留，不按新公式反推（方案 A）。
//
// 幂等：归位是 UPDATE、正文是 UPSERT；重复执行不产生新行。
// 失败：由 migrator 的 step 事务整体回滚，user_version 停在 5。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { refIdFor } from '../../attachmentdb/ids.js';
import { registerMdfile } from '../../attachmentdb/mdfile.js';
import type { DbApi } from '../driver.js';

/** 迁移上下文（bootstrap 传入，与 v2 同一份）。 */
export interface V6Context {
  docsDir?: string;
  atMs?: number;
}

/** step 006 的结果（落 meta.refs_v6，供迁移后核对与面板诊断）。 */
export interface RefsBodiesMigrationResult {
  files: number;
  bodies: number;
  legacy: number;
  external: number;
  emptyBody: number;
  relEmpty: number;
  mdfiles: number;
  sources: number;
  warnings: string[];
}

const MD_RE = /\.(md|markdown)$/i;
const HTTP_RE = /^https?:\/\//i;

const sha1 = (s: unknown): string => createHash('sha1').update(String(s), 'utf8').digest('hex');
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** 地址统一 POSIX（库里的 rel 永远是正斜杠）。 */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 绝对路径规范化：解析 `.`/`..`，Windows 盘符小写（大小写不敏感）。 */
function normAbs(p: string): string {
  let v = toPosix(resolve(p));
  if (/^[A-Z]:/.test(v)) v = v.charAt(0).toLowerCase() + v.slice(1);
  return v;
}

/** p 是否落在 root 内（Windows 大小写不敏感）。 */
function within(root: string, p: string): boolean {
  if (!root) return false;
  const norm = (v: string): string => toPosix(resolve(v)).replace(/\/+$/, '').toLowerCase();
  const a = norm(root);
  const b = norm(p);
  return b === a || b.startsWith(a + '/');
}

/** docs 树里的 .md（POSIX 相对路径，排序保证可复现）。 */
function listMd(root: string): string[] {
  const out: string[] = [];
  if (!root || !existsSync(root)) return out;
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
      else if (MD_RE.test(e.name)) out.push(prefix ? `${prefix}/${e.name}` : e.name);
    }
  };
  walk(root, '');
  return out.map(toPosix).sort();
}

/**
 * step 005 → 006 的 apply。`ctx` 由 bootstrap 传入：{ docsDir, atMs }。
 * @throws 归位失败 / 正文回读 sha256 不符 / 计数不一致 → 整步回滚
 */
export function migrateRefsBodies(conn: DbApi, { docsDir = '', atMs = Date.now() }: V6Context = {}): RefsBodiesMigrationResult {
  const root = String(docsDir || '');
  const warnings: string[] = [];
  const relOwner = new Map<string, string>();

  /** 给一条 ref 分配唯一 rel（重复时加序号后缀；绝不覆盖别人的 rel）。 */
  const claim = (base: string, id: string): string => {
    const owner = relOwner.get(base);
    if (!owner || owner === id) {
      relOwner.set(base, id);
      return base;
    }
    for (let n = 2; n < 500; n++) {
      const cand = `${base}-${n}`;
      const cur = relOwner.get(cand);
      if (!cur || cur === id) {
        relOwner.set(cand, id);
        return cand;
      }
    }
    const cand = `${base}-${sha1(id).slice(0, 8)}`;
    relOwner.set(cand, id);
    return cand;
  };

  // ── 1. 存量 refs 归位 ────────────────────────────────────────────────
  const rows: any[] = conn.all('SELECT id, locator FROM refs ORDER BY id');
  for (const row of rows) {
    const id = String(row.id);
    const raw = String(row.locator ?? '').trim();
    const loc = toPosix(raw);
    let rel: string;
    let origin: string;
    let externalAbs = '';

    if (!loc) {
      rel = claim(`legacy/${id}`, id);
      origin = 'import';
    } else if (HTTP_RE.test(loc)) {
      rel = claim(`external/${sha1(loc).slice(0, 16)}`, id);
      origin = 'external';
    } else if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || loc.startsWith('//')) {
      const abs = normAbs(raw);
      if (within(root, abs)) {
        // 绝对路径落在文档树内：文件本身由下面的扫盘统一入库，这一行只留空壳，
        // 避免同一文件出现两条正文。
        rel = claim(`legacy/${id}`, id);
        origin = 'import';
      } else {
        rel = claim(`external/${sha1(abs).slice(0, 16)}`, id);
        origin = 'external';
        externalAbs = abs;
      }
    } else {
      rel = claim(loc, id);
      origin = 'import';
    }

    conn.run('UPDATE refs SET rel = :rel, origin = :origin WHERE id = :id', { rel, origin, id });

    if (!externalAbs) continue;
    // 外部文件：仍在 → mdfile 指针 + source 边；不在 → 只留空壳
    if (!MD_RE.test(externalAbs) || !existsSync(externalAbs)) {
      warnings.push(`外部文件不在，只留空壳: ${id} -> ${externalAbs}`);
      continue;
    }
    try {
      const rec = registerMdfile(conn, {
        path: externalAbs,
        name: basename(externalAbs),
        atMs,
      });
      conn.run(
        `INSERT OR IGNORE INTO ref_attach (ref_id, attachment_id, role, position, note, created_at)
         VALUES (:ref, :att, 'source', 0, '', :at)`,
        { ref: id, att: rec.id, at: atMs }
      );
    } catch (e: any) {
      // 登记冲突不阻断迁移：refs 行保留为空壳，原因进 meta 供人工核对。
      warnings.push(`mdfile 登记失败（只留空壳）: ${id} -> ${externalAbs}: ${e?.message || e}`);
    }
  }

  // ── 2. 盘上正文入库 + 硬门禁 ─────────────────────────────────────────
  // 口径（2026-11 收口）：这些盘上文件入库后**磁盘那份保留、但不再被读取**——
  // 它们不再是文档来源，只是历史残留（CSV 清单标注「已入库、盘上副本仅留档」）。
  // 不要删它们（迁移不回滚用户文件），也不要再从这里读正文。
  const files = listMd(root);
  let bodies = 0;
  for (const rel of files) {
    const abs = join(root, ...rel.split('/'));
    const buf = readFileSync(abs);
    const body = buf.toString('utf8');
    const hash = sha256(buf);
    const id = relOwner.get(rel) || refIdFor(rel);

    conn.run(
      `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'md', :rel, :rel, 'import', 'orphan', 0, NULL, :at, :at)
       ON CONFLICT(id) DO UPDATE SET
         rel = CASE WHEN refs.rel = '' THEN excluded.rel ELSE refs.rel END,
         origin = CASE WHEN refs.origin = 'external' THEN refs.origin ELSE 'import' END`,
      { id, rel, at: atMs }
    );
    relOwner.set(rel, id);

    conn.run(
      `INSERT INTO ref_bodies (ref_id, body, body_bytes, body_hash, updated_at)
       VALUES (:id, :body, :n, :hash, :at)
       ON CONFLICT(ref_id) DO UPDATE SET
         body = excluded.body,
         body_bytes = excluded.body_bytes,
         body_hash = excluded.body_hash,
         updated_at = excluded.updated_at`,
      { id, body, n: buf.length, hash, at: atMs }
    );

    // 硬门禁：从库里回读正文，重算 sha256，与盘上文件逐篇比对。
    const saved = conn.get('SELECT body FROM ref_bodies WHERE ref_id = :id', { id });
    const reHash = sha256(Buffer.from(String(saved?.body ?? ''), 'utf8'));
    if (!saved || reHash !== hash) {
      throw new Error(
        `v6 正文校验失败（整步回滚）：${rel} 盘上 sha256=${hash} 库内=${reHash}`
      );
    }

    conn.run('UPDATE refs SET rel = :rel, body_bytes = :n WHERE id = :id', {
      rel,
      n: buf.length,
      id,
    });
    bodies += 1;
  }

  const count = (sql: string): number => Number(conn.get(sql)?.c || 0);

  // ── 3. 计数校验（归位不许留空；正文数必须等于盘上文件数） ────────────
  const relEmpty = count("SELECT count(*) AS c FROM refs WHERE rel = '' AND deleted_at IS NULL");
  if (relEmpty > 0) {
    throw new Error(`v6 归位失败（整步回滚）：仍有 ${relEmpty} 行 rel 为空`);
  }
  if (bodies !== files.length) {
    throw new Error(`v6 正文入库不完整（整步回滚）：盘上 ${files.length} 篇，入库 ${bodies} 篇`);
  }

  const result: RefsBodiesMigrationResult = {
    files: files.length,
    bodies,
    legacy: count("SELECT count(*) AS c FROM refs WHERE rel LIKE 'legacy/%'"),
    external: count("SELECT count(*) AS c FROM refs WHERE origin = 'external'"),
    emptyBody: count(
      `SELECT count(*) AS c FROM refs r
        LEFT JOIN ref_bodies b ON b.ref_id = r.id
        WHERE r.deleted_at IS NULL AND b.ref_id IS NULL`
    ),
    relEmpty,
    mdfiles: count("SELECT count(*) AS c FROM attachments WHERE kind = 'mdfile' AND deleted_at IS NULL"),
    sources: count("SELECT count(*) AS c FROM ref_attach WHERE role = 'source'"),
    warnings,
  };

  conn.run(
    `INSERT INTO meta (key, value, updated_at) VALUES ('refs_v6', :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { v: JSON.stringify(result), at: atMs }
  );

  return result;
}
