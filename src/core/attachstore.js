// 云端附件的「本地镜像」：把某个用户空间（group）里的附件落到本机，
// 好让 agent 直接读本地文件，不再依赖网络与出图地址。
//
// 目录：
//   ~/.nx-kv/attachments/<groupId|default>/        ← NX_KV_ATTACHMENTS 可改根目录
//
// 元数据（schema v2 起）：**唯一真相在 attachments 表**（kind='file', storage='cloud',
// group_id=<groupId>）。旧的 manifest.json 只在 v1→v2 迁移时读一次，之后归档。
//
// 为什么早先需要台账：后端 FileInfoRes 不回传原始文件名，本地落点只能自己定。
// 现在 attachments.name / local_path 承担同一职责，且能与任务/文档关系 JOIN。
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, parse as parsePath, resolve } from 'node:path';
import { attachmentsRootFromEnv } from './paths.js';
import { normalizeGroupId } from './config.js';
import { downloadFile, listAllFiles } from './fileapi.js';
import { getDb } from './db/index.js';
import { upsertFileAttachment } from './attachmentdb.js';

const nowIso = () => new Date().toISOString();

/** 该 group 的本地目录。override 优先（来自设置里的 attachmentsDir）。 */
export function localDirFor(groupId, override = '') {
  if (override) return resolve(String(override));
  const n = normalizeGroupId(groupId);
  return join(attachmentsRootFromEnv(), n === undefined ? 'default' : String(n));
}

// Windows 保留设备名做文件名会让文件无法访问
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** 收成跨平台可用的单段文件名（保留中文）。 */
export function safeFileName(name) {
  let s = String(name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!s) s = 'file';
  if (RESERVED.has(parsePath(s).name.toLowerCase())) s = '_' + s;
  return s.slice(0, 120);
}

const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain; charset=utf-8': '.txt',
  'text/markdown; charset=utf-8': '.md',
};

/**
 * 本地落点文件名。优先用调用方给的「人读名字」（任务里 markdown 的说明/链接文字），
 * 否则退回 fileId；两者都没有扩展名时，再按 fileId 自带后缀 / Content-Type 补一个。
 */
export function localNameFor(fileId, preferred, contentType = '') {
  let base = safeFileName(preferred || fileId);
  if (!extname(base)) {
    const fromId = extname(String(fileId));
    const guess = fromId || EXT_BY_TYPE[String(contentType).toLowerCase()] || '';
    if (guess) base += guess;
  }
  return base;
}

/** 同目录内不重名的落点（`名字 (2).ext`）。files 是 id → 记录。 */
function uniqueName(files, name, selfId) {
  const taken = new Set(
    Object.entries(files)
      .filter(([id]) => id !== selfId)
      .map(([, rec]) => String(rec?.name || ''))
  );
  if (!taken.has(name)) return name;
  const { name: stem, ext } = parsePath(name);
  let n = 1;
  let candidate = name;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

function groupRows(groupId) {
  const gid = normalizeGroupId(groupId);
  return getDb().all(
    `SELECT id, name, local_path, mime, size, meta
       FROM attachments
      WHERE kind = 'file' AND storage = 'cloud' AND group_id = :g AND deleted_at IS NULL
      ORDER BY id`,
    { g: gid === undefined ? 0 : Number(gid) }
  );
}

function recordOf(row) {
  let meta = {};
  try {
    meta = JSON.parse(String(row.meta || '{}')) || {};
  } catch {
    meta = {};
  }
  return {
    name: String(row.name || ''),
    local_path: String(row.local_path || ''),
    size: Number(row.size) || 0,
    contentType: String(row.mime || ''),
    syncedAt: String(meta.syncedAt || ''),
  };
}

function absOf(rec, dir) {
  if (rec.local_path && existsSync(rec.local_path)) return rec.local_path;
  return rec.name ? join(dir, rec.name) : '';
}

/** 只在**当前目录内**找已落盘副本：同步用这个判断「这个根下是否需要下载」。 */
function absInDir(rec, dir) {
  const p = absOf(rec, dir);
  if (!p) return '';
  return dirname(resolve(p)) === resolve(dir) ? p : '';
}

/**
 * 读 DB + 落盘文件，判断某个附件是否已经在本地且内容未变。
 * 返回绝对路径；没同步过（或本地文件被删了）返回 null。
 */
export async function resolveLocal(groupId, fileId, overrideDir = '') {
  const gid = normalizeGroupId(groupId);
  const dir = localDirFor(groupId, overrideDir);
  const row = getDb().get(
    `SELECT id, name, local_path, mime, size, meta FROM attachments
      WHERE id = :id AND kind = 'file' AND storage = 'cloud' AND group_id = :g AND deleted_at IS NULL`,
    { id: String(fileId || ''), g: gid === undefined ? 0 : Number(gid) }
  );
  if (!row) return null;
  const rec = recordOf(row);
  const abs = absOf(rec, dir);
  return abs && existsSync(abs) ? { path: abs, name: rec.name, size: rec.size } : null;
}

/** 该目录下已同步的全部条目（id → {path,name,size}），供批量标注用。 */
export async function localIndex(groupId, overrideDir = '') {
  const dir = localDirFor(groupId, overrideDir);
  const out = new Map();
  for (const row of groupRows(groupId)) {
    const rec = recordOf(row);
    const abs = absOf(rec, dir);
    if (abs && existsSync(abs)) out.set(row.id, { path: abs, name: rec.name, size: rec.size });
  }
  return { dir, index: out };
}

/**
 * 同步附件到本地。
 *
 * - `ids` 为空 → 同步该 group 的全部附件（`file sync` 的默认语义）
 * - `ids` 非空 → 只同步这些 id（读任务时按引用同步走这条）
 * - `names` → fileId 的人读文件名（来自任务里 markdown 的说明文字）
 * - `prune` → 删掉本地已不在后端的文件（仅在 sync-all 时生效）
 *
 * 单个文件下载失败不中断整体：如实记进 failures 让调用方知道哪些没拿到。
 */
export async function syncAttachments({
  groupId,
  ids = null,
  names = {},
  dir: overrideDir = '',
  prune = false,
  dryRun = false,
} = {}) {
  const dir = localDirFor(groupId, overrideDir);
  const db = getDb();
  const files = {};
  for (const row of groupRows(groupId)) files[row.id] = recordOf(row);

  const remote = await listAllFiles({ groupId });
  const wanted = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  const remoteIds = new Set(remote.items.map((f) => f.fileId));

  const failures = [];
  const missing = [];
  if (wanted) for (const id of wanted) if (!remoteIds.has(id)) missing.push(id);

  const entries = [];
  let downloaded = 0;
  let skipped = 0;

  for (const meta of remote.items) {
    const id = meta.fileId;
    if (wanted && !wanted.has(id)) continue;

    const desired = localNameFor(id, names[id], meta.contentType);
    const prev = files[id];
    // 换根（attachmentsDir / NX_KV_ATTACHMENTS）后旧绝对路径不算数：
    // 必须在新目录里重新落一份，否则看起来像「没下载」。
    const prevAbs = prev ? absInDir(prev, dir) : '';
    const sizeKnown = Number(prev?.size) > 0;
    const unchanged = prevAbs && existsSync(prevAbs) && sizeKnown && Number(prev.size) === Number(meta.size);

    if (unchanged) {
      skipped++;
      entries.push({ id, name: prev.name, path: prevAbs, size: Number(prev.size), contentType: meta.contentType, synced: true });
      continue;
    }
    if (dryRun) {
      entries.push({ id, name: desired, path: join(dir, desired), size: meta.size, contentType: meta.contentType, synced: false });
      continue;
    }

    let buf;
    try {
      buf = await downloadFile(id);
    } catch (e) {
      failures.push({ id, error: String((e && e.message) || e) });
      if (prevAbs && existsSync(prevAbs)) {
        entries.push({ id, name: prev.name, path: prevAbs, size: Number(prev.size), contentType: meta.contentType, synced: true, stale: true });
      }
      continue;
    }

    const name = uniqueName(files, desired, id);
    const abs = join(dir, name);
    try {
      await fsp.mkdir(dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buf);
    } catch (e) {
      failures.push({ id, error: String((e && e.message) || e) });
      continue;
    }
    files[id] = { name, local_path: abs, size: buf.length, contentType: meta.contentType, syncedAt: nowIso() };
    upsertFileAttachment(db, {
      id,
      name,
      localPath: abs,
      mime: meta.contentType,
      size: buf.length,
      storage: 'cloud',
      groupId: normalizeGroupId(groupId) || 0,
      meta: { syncedAt: nowIso(), contentType: meta.contentType },
    });
    downloaded++;
    entries.push({ id, name, path: abs, size: buf.length, contentType: meta.contentType, synced: true });
  }

  // prune：只在同步全部时生效（理由见函数头）。被任务/文档引用过的行不删，
  // 只清本地缓存并保留元数据——否则 CASCADE 会把关系边一起删掉。
  const removed = [];
  if (prune && !wanted && !dryRun) {
    const gid = normalizeGroupId(groupId);
    for (const id of Object.keys(files)) {
      if (remoteIds.has(id)) continue;
      const rec = files[id];
      const abs = absOf(rec, dir);
      if (abs) {
        try {
          if (existsSync(abs)) await fsp.unlink(abs);
        } catch {
          /* 删不掉就留着 */
        }
      }
      removed.push(rec.name || id);
      const linked = db.get(
        `SELECT 1 AS x FROM task_attach WHERE attachment_id = :id
         UNION ALL SELECT 1 FROM ref_attach WHERE attachment_id = :id LIMIT 1`,
        { id }
      );
      if (linked) {
        db.run(
          `UPDATE attachments SET local_path = '', size = 0, meta = :meta, updated_at = :at
            WHERE id = :id AND kind = 'file' AND storage = 'cloud' AND group_id = :g`,
          {
            id,
            g: gid === undefined ? 0 : Number(gid),
            meta: JSON.stringify({ syncedAt: rec.syncedAt, remoteDeleted: true }),
            at: Date.now(),
          }
        );
      } else {
        db.run(
          `DELETE FROM attachments
            WHERE id = :id AND kind = 'file' AND storage = 'cloud' AND group_id = :g AND deleted_at IS NULL`,
          { id, g: gid === undefined ? 0 : Number(gid) }
        );
      }
    }
  }

  return {
    dir,
    groupId: normalizeGroupId(groupId) || 0,
    dryRun: !!dryRun,
    totalRemote: remote.items.length,
    target: wanted ? wanted.size : remote.items.length,
    downloaded,
    skipped,
    removed,
    missing,
    failures,
    files: entries,
  };
}
