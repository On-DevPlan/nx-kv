// 文档索引：refs 行的解析/建/删，与任务、文档两块正文的整库重扫（迁移与索引用；幂等）。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { refIdFor } from './ids.js';
import { syncRefAttachments, syncTaskAttachments } from './relations.js';

/**
 * 把一个「文档标识」解析成 refs.id：先按 id，再按 locator（原样 / 反斜杠归一），
 * 都没有返回 null。CLI `--ref` 与面板选择器共用这一条，避免各自猜地址语法。
 */
export function resolveRefId(conn, input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const byId = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: raw });
  if (byId) return byId.id;
  const loc = raw.replace(/\\/g, '/');
  const byLoc = conn.get(
    'SELECT id FROM refs WHERE locator = :loc AND deleted_at IS NULL', { loc }
  );
  if (byLoc) return byLoc.id;
  const derived = refIdFor(loc);
  const byDerived = conn.get('SELECT id FROM refs WHERE id = :id AND deleted_at IS NULL', { id: derived });
  return byDerived ? byDerived.id : null;
}

/** 确保 refs 行存在（文档保存 / 索引重建共用；已有行不重置 state）。 */
export function ensureDocRef(conn, { locator, atMs = Date.now() } = {}) {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return null;
  const id = refIdFor(loc);
  conn.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :locator, 'orphan', 0, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET type = 'md', locator = excluded.locator, updated_at = excluded.updated_at`,
    { id, locator: loc, at: atMs }
  );
  return id;
}

/** 文档删除：refs 行消失，ref_attach / ref_bindings 随之 CASCADE。 */
export function forgetDocRef(conn, locator) {
  const loc = String(locator || '').trim().replace(/\\/g, '/');
  if (!loc) return 0;
  const r = conn.run('DELETE FROM refs WHERE id = :id', { id: refIdFor(loc) });
  return Number(r.changes) || 0;
}

/** 全量重扫任务正文（迁移与导入后用；幂等）。 */
export function syncTaskAttachmentIndex(conn, { atMs = Date.now() } = {}) {
  const rows = conn.all('SELECT id, body FROM tasks ORDER BY id');
  let n = 0;
  for (const row of rows) n += syncTaskAttachments(conn, { taskId: row.id, text: row.body, atMs });
  return n;
}

/** 全量重扫 docs 自有树 + 外部 .md（迁移与索引重建用；幂等）。 */
export function syncDocAttachmentIndex(conn, { docsRoot, atMs = Date.now() } = {}) {
  const root = String(docsRoot || '');
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && /\.md$/i.test(e.name)) files.push(abs);
    }
  };
  if (root && existsSync(root)) walk(root);
  let n = 0;
  const covered = new Set();
  for (const abs of files.sort()) {
    const locator = relative(root, abs).replace(/\\/g, '/');
    covered.add(resolve(abs).replace(/\\/g, '/').toLowerCase());
    let text = '';
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const refId = ensureDocRef(conn, { locator, atMs });
    n += syncRefAttachments(conn, { refId, text, atMs });
  }
  // 外部 .md（refs.locator 是绝对路径）：不在 docs 树里，但同样是文档库的一行。
  // 迁移必须把它们的正文引用也落库，否则「存量文档的图片」只有正文 fileId 字符串。
  for (const row of conn.all("SELECT id, locator FROM refs WHERE type = 'md'")) {
    const loc = String(row.locator || '');
    if (!isAbsolute(loc) || !existsSync(loc)) continue;
    if (covered.has(resolve(loc).replace(/\\/g, '/').toLowerCase())) continue;
    if (!/\.md$/i.test(loc)) continue;
    let text = '';
    try {
      text = readFileSync(loc, 'utf8');
    } catch {
      continue;
    }
    n += syncRefAttachments(conn, { refId: row.id, text, atMs });
  }
  return n;
}
