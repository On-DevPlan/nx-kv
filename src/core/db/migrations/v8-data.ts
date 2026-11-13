// schema v7 → v8 的数据迁移（在 v8.sql 的同一个事务里执行）。
//
// 口径（2026-11-13 用户拍板）：
//   · ref 不再有 rel（旧文档树相对路径）；地址只有 id（DB 身份）与 locator（外部实际位置）。
//   · `repo.doc` / `repo.docLinks` / `board.doc` / `board.docLinks` / `board.repoDocs`
//     从 DocRef{rel|path} 迁成 DocRef{ref}（refId），外部路径转成 origin='external'
//     的 ref 行，位置落在 locator。
//   · 历史「约定路径」（repo/<key>/index.md、board/<组>/index.md、group/<组>/<key>.md…）
//     在迁移时**一次性解析成显式 ref 绑定**，运行时不再到路径上找文档。
//   · 原字符串描述（repos.description / 组 desc / 成员 note）若还没有对应文档，
//     生成一条直接 ref（locator=''）承接正文，避免迁移丢内容。
//   · 已有的直接 ref 归属（v7 面板新建、只写在 ref_bindings）反向补进宿主 ext，
//     保证「ext 为语义、ref_bindings 为索引」两层一致。
//   · 最后删除 refs.rel 与 ux_refs_rel，建 locator 部分唯一索引。
//
// 幂等：重复执行时 DocRef{ref} 原样保留；约定路径已转成显式 ref 后不再重复生成。
// 失败：由 migrator 的 step 事务整体回滚，user_version 停在 7。
import { createHash } from 'node:crypto';
import { localKeyOf } from '../../keys.js';

/** 迁移期用的 key 归一（与 shared/repo-key 的 normalizeKey 同口径；core 不得依赖 shared）。 */
function normalizeKey(k: unknown): string {
  return String(k || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '-')
    .replace(/\.git$/i, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 160)
    .toLowerCase();
}

/** 迁移上下文（bootstrap 传入）。 */
export interface V8Context {
  atMs?: number;
}

/** step 008 的结果（落 meta.refs_v8，供迁移后核对）。 */
export interface RefsRelRemovalResult {
  repos: number;
  boards: number;
  refs: number;
  bindings: number;
  converted: number;
  seeded: number;
  droppedIndexes: string[];
  warnings: string[];
}

const sha1 = (s: unknown): string => createHash('sha1').update(String(s), 'utf8').digest('hex');
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const clean = (v: unknown): string => String(v ?? '').trim();

/** 旧 paths.ts 的段规则（迁移期一次性使用；运行时不再有这套推导）。 */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function fixWinSeg(seg: unknown): string {
  const s = String(seg || '').replace(/\.+$/g, '');
  if (!s) return 'x';
  return RESERVED.has(s.toLowerCase()) ? s + '_' : s;
}

const docSeg = (s: unknown): string => fixWinSeg(normalizeKey(s));
const boardSeg = (name: unknown): string => fixWinSeg(localKeyOf(name).slice('local/'.length));
const segPath = (key: unknown): string => String(key || '').split('/').map(docSeg).join('/');

function parseExt(raw: unknown): Record<string, any> {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** DocRef 迁移后的形状：只有 refId（+ 链接注解）。 */
interface RefDocRef {
  ref: string;
  note?: string;
  tag?: string;
}

/** 一个宿主的文档集（迁移中间态）。 */
interface HostDocs {
  doc: RefDocRef | null;
  links: RefDocRef[];
  repoDocs: Record<string, RefDocRef>;
}

// ─── refs 原语（迁移期；与运行时 store 解耦）────────────────────────────

function refExists(conn: any, id: string): boolean {
  return !!conn.get('SELECT 1 AS x FROM refs WHERE id = :id AND deleted_at IS NULL', { id });
}

function refIdByLocator(conn: any, locator: string): string {
  const hit = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL ORDER BY id LIMIT 1',
    { loc: locator }
  );
  return hit ? String(hit.id) : '';
}

/** 按 locator 找/建 ref（历史文档路径或外部绝对路径）。 */
function ensureRefByLocator(
  conn: any,
  locator: string,
  { external, atMs }: { external: boolean; atMs: number }
): string {
  const loc = clean(locator).replace(/\\/g, '/');
  if (!loc) return '';
  const found = refIdByLocator(conn, loc);
  if (found) return found;
  let id = 'ref_' + sha1(loc).slice(0, 16);
  if (refExists(conn, id) || conn.get('SELECT 1 AS x FROM refs WHERE id = :id', { id })) {
    for (let n = 2; n < 200; n += 1) {
      const cand = 'ref_' + sha1(loc + '#' + n).slice(0, 16);
      if (!conn.get('SELECT 1 AS x FROM refs WHERE id = :id', { id: cand })) { id = cand; break; }
    }
  }
  conn.run(
    `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :rel, :loc, :origin, 'orphan', 0, NULL, :at, :at)
     ON CONFLICT(id) DO NOTHING`,
    {
      id,
      rel: external ? 'external/' + sha1(loc).slice(0, 16) : loc,
      loc,
      origin: external ? 'external' : 'own',
      at: atMs,
    }
  );
  return id;
}

/** 字符串描述 → 直接 ref（locator=''）：标题 + 正文都落库。 */
function seedDirectRef(
  conn: any,
  { seed, title, text, atMs }: { seed: string; title: string; text: string; atMs: number }
): string {
  const id = 'ref_' + sha1('v8-seed:' + seed).slice(0, 16);
  if (!conn.get('SELECT 1 AS x FROM refs WHERE id = :id AND deleted_at IS NULL', { id })) {
    const body = '# ' + title + '\n\n' + clean(text) + '\n';
    conn.run(
      `INSERT INTO refs (id, type, rel, locator, origin, state, version, deleted_at, created_at, updated_at, "desc")
       VALUES (:id, 'md', :id, '', 'own', 'orphan', 0, NULL, :at, :at, :desc)`,
      { id, at: atMs, desc: clean(text).slice(0, 120) }
    );
    conn.run(
      `INSERT INTO ref_bodies (ref_id, body, body_bytes, body_hash, updated_at)
       VALUES (:id, :body, :n, :hash, :at)
       ON CONFLICT(ref_id) DO UPDATE SET
         body = excluded.body, body_bytes = excluded.body_bytes,
         body_hash = excluded.body_hash, updated_at = excluded.updated_at`,
      { id, body, n: Buffer.byteLength(body, 'utf8'), hash: sha256(body), at: atMs }
    );
  }
  return id;
}

/** DocRef{ref|rel|path} → DocRef{ref}；无法解析返回 null。 */
function convertDoc(
  conn: any,
  raw: unknown,
  atMs: number,
  warnings: string[],
  label: string
): RefDocRef | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const existing = clean(o.ref);
  if (existing) {
    if (refExists(conn, existing)) return withMeta({ ref: existing }, o);
    warnings.push(`${label}: ref ${existing} 不存在，已跳过`);
    return null;
  }
  const rel = clean(o.rel);
  if (rel) {
    const id = ensureRefByLocator(conn, rel, { external: false, atMs });
    return id ? withMeta({ ref: id }, o) : null;
  }
  const path = clean(o.path);
  if (path) {
    const id = ensureRefByLocator(conn, path, { external: true, atMs });
    return id ? withMeta({ ref: id }, o) : null;
  }
  return null;
}

function withMeta(base: RefDocRef, o: Record<string, unknown>): RefDocRef {
  const note = clean(o.note);
  const tag = clean(o.tag);
  if (note) base.note = note;
  if (tag) base.tag = tag;
  return base;
}

/** 某个 locator 前缀下的全部 ref（按 locator 排序）。 */
function refsUnder(conn: any, prefix: string): Array<{ id: string; locator: string }> {
  if (!prefix) return [];
  return conn
    .all(
      `SELECT id, locator FROM refs
        WHERE deleted_at IS NULL AND substr(locator, 1, length(:p)) = :p
        ORDER BY locator`,
      { p: prefix }
    )
    .map((r: any) => ({ id: String(r.id), locator: String(r.locator || '') }));
}

/** 旧「约定路径」解析：目录主篇 index.md → 目录内第一篇 → 旧单文件。 */
function introOf(
  conn: any,
  { dir, legacyFile }: { dir: string; legacyFile: string }
): { main: string; extras: string[] } {
  const inDir = refsUnder(conn, dir + '/');
  const byLoc = new Map(inDir.map((x) => [x.locator, x.id]));
  const main = byLoc.get(dir + '/index.md') || (inDir[0] && inDir[0].id) || '';
  const extras = inDir.filter((x) => x.id !== main).map((x) => x.id);
  if (main) return { main, extras };
  const legacy = refIdByLocator(conn, legacyFile);
  return { main: legacy, extras: [] };
}

/** 一个宿主的 DocRef 列表 → 去重、剔除与主篇重复的条目。 */
function normalizeDocs(doc: RefDocRef | null, links: RefDocRef[]): { doc: RefDocRef | null; links: RefDocRef[] } {
  const seen = new Set<string>();
  const main = doc && doc.ref && !seen.has(doc.ref) ? doc : null;
  if (main) seen.add(main.ref);
  const out: RefDocRef[] = [];
  for (const l of links) {
    if (!l || !l.ref || seen.has(l.ref)) continue;
    seen.add(l.ref);
    out.push(l);
  }
  return { doc: main, links: out };
}

// ─── 主流程 ────────────────────────────────────────────────────────────

export function migrateRefsRel(conn: any, { atMs = Date.now() }: V8Context = {}): RefsRelRemovalResult {
  const warnings: string[] = [];
  const rows: any[] = conn.all(
    "SELECT key, type, name, description, ext FROM repos WHERE deleted_at IS NULL ORDER BY type, key"
  );
  const memberRows: any[] = conn.all(
    'SELECT group_key, repo_key, note FROM repo_group_members'
  );
  const membersOf = new Map<string, Array<{ key: string; note: string }>>();
  for (const m of memberRows) {
    const gk = String(m.group_key || '');
    if (!membersOf.has(gk)) membersOf.set(gk, []);
    membersOf.get(gk)!.push({ key: String(m.repo_key || ''), note: String(m.note || '') });
  }

  const hosts = new Map<string, HostDocs>();
  const repoHosts = new Set<string>();
  const groupHosts = new Set<string>();
  let converted = 0;
  let seeded = 0;

  for (const row of rows) {
    const key = String(row.key || '');
    if (key === '__unbound__') continue; // 哨兵不是用户仓库，不生成任何文档
    const isGroup = row.type === 'group';
    const ext = parseExt(row.ext);
    const docKey = isGroup ? 'ext_doc' : 'ext_doc';
    const linksKey = isGroup ? 'ext_doc_links' : 'ext_doc_links';
    const repoDocsKey = 'ext_repo_docs';

    let doc = convertDoc(conn, ext[docKey], atMs, warnings, `${key} 主篇`);
    const links: RefDocRef[] = [];
    for (const l of Array.isArray(ext[linksKey]) ? ext[linksKey] : []) {
      const d = convertDoc(conn, l, atMs, warnings, `${key} 补充篇`);
      if (d) links.push(d);
    }
    const repoDocs: Record<string, RefDocRef> = {};
    if (isGroup && ext[repoDocsKey] && typeof ext[repoDocsKey] === 'object') {
      for (const [rk, raw] of Object.entries(ext[repoDocsKey])) {
        const d = convertDoc(conn, raw, atMs, warnings, `${key} 组内描述 ${rk}`);
        if (d) repoDocs[String(rk)] = d;
      }
    }
    if (doc || links.length) converted += 1;

    // 约定路径 → 显式 ref（只对还没有主篇的宿主做）
    const name = String(row.name || '');
    if (isGroup) {
      const seg = boardSeg(name);
      const intro = introOf(conn, { dir: `board/${seg}`, legacyFile: `board/${seg}.md` });
      if (!doc && intro.main) doc = { ref: intro.main };
      for (const id of intro.extras) links.push({ ref: id });
      // 组内成员描述：显式 repoDocs 缺失时按约定路径解析
      const members = membersOf.get(key) || [];
      for (const m of members) {
        if (repoDocs[m.key]) continue;
        const noteIntro = introOf(conn, {
          dir: `group/${seg}/${segPath(m.key)}`,
          legacyFile: `group/${seg}/${segPath(m.key)}.md`,
        });
        if (noteIntro.main) repoDocs[m.key] = { ref: noteIntro.main };
      }
    } else {
      const intro = introOf(conn, { dir: `repo/${segPath(key)}`, legacyFile: `repo/${segPath(key)}.md` });
      if (!doc && intro.main) doc = { ref: intro.main };
      for (const id of intro.extras) links.push({ ref: id });
    }

    // 字符串描述兜底：还没有主篇 → 生成直接 ref，正文就是这段描述
    const descText = clean(row.description);
    if (!doc && descText) {
      const id = seedDirectRef(conn, {
        seed: (isGroup ? 'board/' : 'repo/') + key,
        title: isGroup ? name : name || key,
        text: descText,
        atMs,
      });
      doc = { ref: id };
      seeded += 1;
    }

    const host: HostDocs = { doc, links, repoDocs };
    hosts.set(key, host);
    if (isGroup) groupHosts.add(key);
    else repoHosts.add(key);
  }

  // 组内成员 note 字符串兜底（没有对应描述文档时，把 note 变成文档）
  for (const row of rows) {
    if (row.type !== 'group') continue;
    const key = String(row.key || '');
    const host = hosts.get(key);
    if (!host) continue;
    for (const m of membersOf.get(key) || []) {
      if (host.repoDocs[m.key] || !clean(m.note)) continue;
      const repoRow = conn.get('SELECT name FROM repos WHERE key = :k AND deleted_at IS NULL', { k: m.key });
      const id = seedDirectRef(conn, {
        seed: `note/${key}/${m.key}`,
        title: `${row.name} · ${(repoRow && repoRow.name) || m.key}`,
        text: m.note,
        atMs,
      });
      host.repoDocs[m.key] = { ref: id };
      seeded += 1;
    }
  }

  // 已有直接 ref 归属（v7 只写 ref_bindings）反向补进宿主 ext
  const existingBindings: any[] = conn.all(
    'SELECT repo_key, group_key, ref_id, type, position, note, tag FROM ref_bindings ORDER BY type, position, rowid'
  );
  for (const b of existingBindings) {
    const refId = String(b.ref_id || '');
    if (!refId) continue;
    const type = String(b.type || '');
    const note = clean(b.note);
    const tag = clean(b.tag);
    const withMeta2 = (): RefDocRef => {
      const x: RefDocRef = { ref: refId };
      if (note) x.note = note;
      if (tag) x.tag = tag;
      return x;
    };
    if (type === 'group_repo') {
      const gk = String(b.group_key || '');
      const rk = String(b.repo_key || '');
      const host = hosts.get(gk);
      if (!host || !rk) continue;
      if (!host.repoDocs[rk]) host.repoDocs[rk] = withMeta2();
      continue;
    }
    const hostKey = String(b.repo_key || '');
    const host = hosts.get(hostKey);
    if (!host) continue;
    if (type === 'repo' && !repoHosts.has(hostKey)) continue;
    if (type === 'group' && !groupHosts.has(hostKey)) continue;
    const doc = host.doc;
    const links = host.links;
    if (doc && doc.ref === refId) continue;
    if (links.some((l) => l.ref === refId)) continue;
    const entry = withMeta2();
    if (Number(b.position) === 0 && !doc) host.doc = entry;
    else host.links.push(entry);
  }

  // 写回 ext + 重建 ref_bindings
  const writeHost = (key: string, isGroup: boolean, host: HostDocs): { bindings: number } => {
    const { doc, links } = normalizeDocs(host.doc, host.links);
    const ext = parseExt(
      (conn.get('SELECT ext FROM repos WHERE key = :k', { k: key }) || {}).ext
    );
    const docKey = 'ext_doc';
    const linksKey = 'ext_doc_links';
    if (doc) ext[docKey] = doc;
    else delete ext[docKey];
    if (links.length) ext[linksKey] = links;
    else delete ext[linksKey];
    if (isGroup) {
      if (Object.keys(host.repoDocs).length) ext.ext_repo_docs = host.repoDocs;
      else delete ext.ext_repo_docs;
    }
    conn.run('UPDATE repos SET ext = :ext WHERE key = :k', { ext: JSON.stringify(ext), k: key });

    let n = 0;
    const put = (repoKey: string, groupKey: string | null, d: RefDocRef, type: string, pos: number): void => {
      if (!refExists(conn, d.ref)) {
        warnings.push(`${key}: 绑定目标 ${d.ref} 不存在，已跳过`);
        return;
      }
      const r = conn.run(
        `INSERT OR IGNORE INTO ref_bindings (repo_key, group_key, ref_id, type, position, note, tag, created_at)
         VALUES (:repo, :group, :ref, :type, :pos, :note, :tag, :at)`,
        {
          repo: repoKey,
          group: groupKey,
          ref: d.ref,
          type,
          pos,
          note: clean(d.note),
          tag: clean(d.tag),
          at: atMs,
        }
      );
      if (Number(r.changes) > 0) n += 1;
    };
    if (isGroup) {
      if (doc) put(key, null, doc, 'group', 0);
      links.forEach((l, i) => put(key, null, l, 'group', i + 1));
      for (const [rk, d] of Object.entries(host.repoDocs)) put(rk, key, d, 'group_repo', 0);
    } else {
      if (doc) put(key, null, doc, 'repo', 0);
      links.forEach((l, i) => put(key, null, l, 'repo', i + 1));
    }
    return { bindings: n };
  };

  // 先清空索引，再按迁移后的 ext 整表重建（此时 ext 已覆盖全部直接绑定）
  conn.run('DELETE FROM ref_bindings');
  for (const key of repoHosts) {
    const host = hosts.get(key);
    if (host) writeHost(key, false, host);
  }
  for (const key of groupHosts) {
    const host = hosts.get(key);
    if (host) writeHost(key, true, host);
  }

  // 没有绑定的 ref → orphan；有绑定的 → state 清空
  conn.run(
    `UPDATE refs SET state = 'orphan', updated_at = :at
      WHERE deleted_at IS NULL AND id NOT IN (SELECT ref_id FROM ref_bindings)`,
    { at: atMs }
  );
  conn.run(
    `UPDATE refs SET state = '', updated_at = :at
      WHERE deleted_at IS NULL AND state = 'orphan' AND id IN (SELECT ref_id FROM ref_bindings)`,
    { at: atMs }
  );

  // 删除 rel：先删依赖它的索引，再删列，最后用 locator 建部分唯一索引
  const droppedIndexes: string[] = [];
  for (const idx of conn.all("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'refs'")) {
    const sql = String(idx.sql || '');
    if (/\brel\b/.test(sql) && String(idx.name || '') !== 'ix_refs_locator') {
      conn.run('DROP INDEX IF EXISTS "' + String(idx.name) + '"');
      droppedIndexes.push(String(idx.name));
    }
  }
  conn.run('DROP INDEX IF EXISTS ux_refs_rel');
  conn.exec('ALTER TABLE refs DROP COLUMN rel');
  conn.run(
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_refs_locator ON refs (locator) WHERE locator <> '' AND deleted_at IS NULL"
  );

  const count = (sql: string): number => Number(conn.get(sql)?.c || 0);
  const result: RefsRelRemovalResult = {
    repos: repoHosts.size,
    boards: groupHosts.size,
    refs: count('SELECT count(*) AS c FROM refs WHERE deleted_at IS NULL'),
    bindings: count('SELECT count(*) AS c FROM ref_bindings'),
    converted,
    seeded,
    droppedIndexes,
    warnings,
  };
  conn.run(
    `INSERT INTO meta (key, value, updated_at) VALUES ('refs_v8', :v, :at)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    { v: JSON.stringify(result), at: atMs }
  );
  return result;
}
