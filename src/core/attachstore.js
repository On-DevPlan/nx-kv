// 附件的「本地镜像」：把某个用户空间（group）里的附件落到本机，
// 好让 agent **直接读本地文件**，不再依赖网络与出图地址。
//
// 目录（刻意落在 nx-kv 的用户目录下）：
//   ~/.nx-kv/attachments/<groupId|default>/        ← NX_KV_ATTACHMENTS 可改根目录
// 台账：
//   同目录 manifest.json → { groupId, dir, updatedAt, files: { <fileId>: {name, size, contentType, syncedAt} } }
//
// 为什么需要台账：后端 FileInfoRes **不回传原始文件名**，本地落点只能自己定；
// 台账把「fileId → 本地文件名 + 大小」固定下来，于是反复同步能跳过未变更的，
// 也不会每 sync 一次就换一个名字（那样等于每次重新下载）。
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, parse as parsePath, resolve } from 'node:path';
import { attachmentsRootFromEnv } from './paths.js';
import { normalizeGroupId } from './config.js';
import { downloadFile, listAllFiles } from './fileapi.js';

export const MANIFEST_NAME = 'manifest.json';

const nowIso = () => new Date().toISOString();

/** 该 group 的本地目录。override 优先（来自设置里的 attachmentsDir）。 */
export function localDirFor(groupId, override = '') {
  if (override) return resolve(String(override));
  const n = normalizeGroupId(groupId);
  return join(attachmentsRootFromEnv(), n === undefined ? 'default' : String(n));
}

export function manifestPath(dir) {
  return join(dir, MANIFEST_NAME);
}

export async function readManifest(dir) {
  try {
    const raw = JSON.parse(await fsp.readFile(manifestPath(dir), 'utf8'));
    return {
      groupId: Number(raw.groupId) || 0,
      dir: String(raw.dir || dir),
      updatedAt: String(raw.updatedAt || ''),
      files: raw.files && typeof raw.files === 'object' ? raw.files : {},
    };
  } catch {
    // 台账不存在或损坏：当成空台账。它只是缓存，不是真相源 —— 真相源是后端。
    return { groupId: 0, dir, updatedAt: '', files: {} };
  }
}

export async function writeManifest(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  const tmp = manifestPath(dir) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, manifestPath(dir));
  return data;
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
 * 补后缀是刚需：没有扩展名，Windows 上双击打不开、内联预览也认不出类型。
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

/** 同目录内不重名的落点（`名字 (2).ext`）。files 是 id → 台账记录。 */
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

/**
 * 读台账 + 落盘文件，判断某个附件是否**已经在本地且内容未变**。
 * 返回绝对路径；没同步过（或本地文件被删了）返回 null。
 */
export async function resolveLocal(groupId, fileId, overrideDir = '') {
  const dir = localDirFor(groupId, overrideDir);
  const man = await readManifest(dir);
  const rec = man.files[fileId];
  if (!rec || !rec.name) return null;
  const abs = join(dir, String(rec.name));
  return existsSync(abs) ? { path: abs, name: String(rec.name), size: Number(rec.size) || 0 } : null;
}

/** 该目录下已同步的全部条目（id → {path,name,size}），供 `todo attachments` 批量标注用。 */
export async function localIndex(groupId, overrideDir = '') {
  const dir = localDirFor(groupId, overrideDir);
  const man = await readManifest(dir);
  const out = new Map();
  for (const [id, rec] of Object.entries(man.files)) {
    const abs = join(dir, String(rec?.name || ''));
    if (rec?.name && existsSync(abs)) {
      out.set(id, { path: abs, name: String(rec.name), size: Number(rec.size) || 0 });
    }
  }
  return { dir, index: out };
}

/**
 * 同步附件到本地。
 *
 * - `ids` 为空 → 同步该 group 的**全部**附件（`file sync` 的默认语义）
 * - `ids` 非空 → 只同步这些 id（读任务时按引用同步走这条）
 * - `names` → fileId 的人读文件名（来自任务里 markdown 的说明文字）
 * - `prune` → 删掉本地已不在后端的文件（**仅在 sync-all 时生效**：
 *   带了 ids 过滤还 prune，会把没列出来的附件一起删掉）
 *
 * 单个文件下载失败**不中断整体**：如实记进 failures 让调用方知道哪些没拿到。
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
  const man = await readManifest(dir);
  const files = { ...man.files };

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
    const prevAbs = prev?.name ? join(dir, String(prev.name)) : '';
    const sizeKnown = Number(prev?.size) > 0;
    const unchanged = prevAbs && existsSync(prevAbs) && sizeKnown && Number(prev.size) === Number(meta.size);

    if (unchanged) {
      skipped++;
      entries.push({ id, name: String(prev.name), path: prevAbs, size: Number(prev.size), contentType: meta.contentType, synced: true });
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
      // 本地已有旧版本就继续用它，避免「网络抖一下附件就消失」
      if (prevAbs && existsSync(prevAbs)) {
        entries.push({ id, name: String(prev.name), path: prevAbs, size: Number(prev.size), contentType: meta.contentType, synced: true, stale: true });
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
    files[id] = { name, size: buf.length, contentType: meta.contentType, syncedAt: nowIso() };
    downloaded++;
    entries.push({ id, name, path: abs, size: buf.length, contentType: meta.contentType, synced: true });
  }

  // prune：只在同步全部时生效（理由见函数头）
  const removed = [];
  if (prune && !wanted && !dryRun) {
    for (const id of Object.keys(files)) {
      if (remoteIds.has(id)) continue;
      const abs = join(dir, String(files[id]?.name || ''));
      try {
        if (existsSync(abs)) await fsp.unlink(abs);
      } catch {
        // 删不掉就留着（可能被占用）；台账条目仍移除，下次同步不会误认它是最新的
      }
      removed.push(files[id]?.name || id);
      delete files[id];
    }
  }

  if (!dryRun) {
    await writeManifest(dir, {
      groupId: normalizeGroupId(groupId) || 0,
      dir,
      updatedAt: nowIso(),
      files,
    });
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
