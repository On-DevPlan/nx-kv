// 查询与生命周期：行视图、列表查询、孤儿资源清理、删除、旧 manifest 归档。
import { existsSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { metaOf } from './ids.js';

const ATT_SELECT = `SELECT id, kind, name, local_path, url, mime, size, hash, storage, group_id,
       target_kind, target_key, target_seq, meta, deleted_at, created_at, updated_at
  FROM attachments`;

function rowView(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    localPath: row.local_path,
    url: row.url,
    mime: row.mime,
    size: Number(row.size) || 0,
    hash: row.hash,
    storage: row.storage,
    groupId: Number(row.group_id) || 0,
    targetKind: row.target_kind,
    targetKey: row.target_key,
    targetSeq: row.target_seq === null || row.target_seq === undefined ? null : Number(row.target_seq),
    meta: metaOf(row),
    deletedAt: row.deleted_at,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function getAttachment(conn, id) {
  const row = conn.get(`${ATT_SELECT} WHERE id = :id`, { id: String(id || '') });
  return row ? rowView(row) : null;
}

export function listTaskAttachments(conn, taskId) {
  return conn
    .all(
      `SELECT a.id, a.kind, a.name, a.local_path, a.url, a.mime, a.size, a.hash, a.storage,
              a.group_id, a.target_kind, a.target_key, a.target_seq, a.meta,
              a.deleted_at, a.created_at, a.updated_at, ta.role, ta.position, ta.note
         FROM task_attach ta JOIN attachments a ON a.id = ta.attachment_id
        WHERE ta.task_id = :id AND a.deleted_at IS NULL
        ORDER BY ta.position, a.id`,
      { id: Number(taskId) }
    )
    .map((r) => ({ ...rowView(r), role: r.role, position: Number(r.position) || 0, note: r.note }));
}

/** CLI 只有 topicKey + seq 时的查询入口。 */
export function listTaskAttachmentsBySeq(conn, { topicKey, seq }) {
  const row = conn.get(
    `SELECT t.id FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.key = :key AND t.seq = :seq`,
    { key: String(topicKey || ''), seq: Number(seq) }
  );
  return row ? listTaskAttachments(conn, Number(row.id)) : [];
}

export function listRefAttachments(conn, refId) {
  return conn
    .all(
      `SELECT a.id, a.kind, a.name, a.local_path, a.url, a.mime, a.size, a.hash, a.storage,
              a.group_id, a.target_kind, a.target_key, a.target_seq, a.meta,
              a.deleted_at, a.created_at, a.updated_at, ra.role, ra.position, ra.note
         FROM ref_attach ra JOIN attachments a ON a.id = ra.attachment_id
        WHERE ra.ref_id = :id AND a.deleted_at IS NULL
        ORDER BY ra.position, a.id`,
      { id: String(refId || '') }
    )
    .map((r) => ({ ...rowView(r), role: r.role, position: Number(r.position) || 0, note: r.note }));
}

/**
 * 无主资源：没有任何 task_attach / ref_attach 边。
 * 软删的任务/文档仍算「有主」（软删可恢复，不能在这里把字节删掉）。
 */
export function listOrphans(conn) {
  return conn
    .all(
      `${ATT_SELECT}
       WHERE deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM task_attach ta WHERE ta.attachment_id = attachments.id)
         AND NOT EXISTS (SELECT 1 FROM ref_attach ra WHERE ra.attachment_id = attachments.id)
       ORDER BY created_at, id`
    )
    .map(rowView);
}

function within(root, p) {
  if (!root || !p) return false;
  const a = resolve(root).replace(/\\/g, '/').toLowerCase();
  const b = resolve(p).replace(/\\/g, '/').toLowerCase();
  return b === a || b.startsWith(a.replace(/\/+$/, '') + '/');
}

/**
 * 删除资源行（可选连字节一起删）。仍被任何任务/文档引用时拒绝——关系表是权威，
 * 「解除关系」和「删资源」是两步，不能因为一次 detach --purge 误删别人在用的文件。
 * @returns {{removed:boolean, reason?:string, attachment?:object}}
 */
export function deleteAttachment(conn, id, { attachmentsRoot, purgeBytes = true } = {}) {
  const row = getAttachment(conn, id);
  if (!row) return { removed: false, reason: 'not-found' };
  const still = conn.get(
    `SELECT 1 AS x FROM task_attach WHERE attachment_id = :id
     UNION ALL SELECT 1 FROM ref_attach WHERE attachment_id = :id LIMIT 1`,
    { id: row.id }
  );
  if (still) return { removed: false, reason: 'in-use', attachment: row };
  let bytesRemoved = false;
  if (purgeBytes && row.kind === 'file' && row.localPath && within(attachmentsRoot, row.localPath)) {
    try {
      if (existsSync(row.localPath)) {
        unlinkSync(row.localPath);
        bytesRemoved = true;
      }
    } catch {
      return { removed: false, reason: 'file-locked', attachment: row };
    }
  }
  conn.run('DELETE FROM attachments WHERE id = :id', { id: row.id });
  return { removed: true, bytesRemoved, attachment: row };
}

export function pruneOrphans(conn, { attachmentsRoot, dryRun = false } = {}) {
  const rows = listOrphans(conn);
  const removed = [];
  const skipped = [];
  for (const row of rows) {
    if (dryRun) {
      removed.push(row);
      continue;
    }
    const still = conn.get(
      `SELECT 1 AS x FROM task_attach WHERE attachment_id = :id
       UNION ALL SELECT 1 FROM ref_attach WHERE attachment_id = :id LIMIT 1`,
      { id: row.id }
    );
    if (still) {
      skipped.push(row);
      continue;
    }
    if (row.kind === 'file' && row.localPath && within(attachmentsRoot, row.localPath)) {
      try {
        if (existsSync(row.localPath)) unlinkSync(row.localPath);
      } catch {
        /* 文件被占用：留到下次，先不删行（否则会变成无记录的残文件） */
        skipped.push(row);
        continue;
      }
    }
    conn.run('DELETE FROM attachments WHERE id = :id AND deleted_at IS NULL', { id: row.id });
    removed.push(row);
  }
  return { removed, skipped };
}

/** 迁移后归档旧 manifest（运行时不再写它，归档只是留证据）。 */
export function archiveAttachmentManifests(root, tag) {
  const out = [];
  if (!root || !existsSync(root)) return out;
  const candidates = [];
  const local = join(root, 'local', 'manifest.json');
  if (existsSync(local)) candidates.push(local);
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'local') continue;
    const p = join(root, e.name, 'manifest.json');
    if (existsSync(p)) candidates.push(p);
  }
  for (const from of candidates) {
    const to = from.replace(/manifest\.json$/i, `manifest.migrated-${tag}.json`);
    try {
      if (existsSync(to)) continue;
      renameSync(from, to);
      out.push({ from, to });
    } catch {
      /* 归档失败不影响运行时（DB 已是唯一真相） */
    }
  }
  return out;
}
