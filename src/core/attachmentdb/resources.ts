// 资源行写入：file / url / task / ref 四类资源的 upsert。
// dedupe_key 保证「同一资源重挂不重复建行」；file 资源例外（id 即 fileId，自带唯一性）。
import {
  isFileId,
  metaOf,
  mimeFromName,
  refAttachmentId,
  taskAttachmentId,
  urlAttachmentId,
} from './ids.js';
import type { AttachmentRef } from './ids.js';

export interface UpsertFileAttachmentInput {
  id?: string;
  name?: string;
  localPath?: string;
  mime?: string;
  size?: number;
  hash?: string;
  storage?: string;
  groupId?: number;
  meta?: Record<string, unknown>;
  atMs?: number;
}

/** 插入/更新一个本机或云端文件资源（id = fileId）。 */
export function upsertFileAttachment(conn: any, {
  id,
  name = '',
  localPath = '',
  mime = '',
  size = 0,
  hash = '',
  storage = '',
  groupId = 0,
  meta = {},
  atMs = Date.now(),
}: UpsertFileAttachmentInput = {}): string {
  const fid = String(id || '').trim();
  if (!isFileId(fid)) throw new Error(`非法 fileId: ${fid}`);
  const cur = conn.get('SELECT * FROM attachments WHERE id = :id', { id: fid });
  const mergedMeta = { ...(cur ? metaOf(cur) : {}), ...(meta || {}) };
  if (!cur) {
    conn.run(
      `INSERT INTO attachments
         (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
          target_kind, target_key, target_seq, dedupe_key, meta, deleted_at, created_at, updated_at)
       VALUES (:id, 'file', :name, :localPath, '', :mime, :size, :hash, :storage, :groupId,
               '', '', NULL, '', :meta, NULL, :at, :at)`,
      {
        id: fid,
        name: String(name || ''),
        localPath: String(localPath || ''),
        mime: String(mime || ''),
        size: Math.max(0, Number(size) || 0),
        hash: String(hash || ''),
        storage: String(storage || ''),
        groupId: Number(groupId) || 0,
        meta: JSON.stringify(mergedMeta),
        at: atMs,
      }
    );
    return fid;
  }
  conn.run(
    `UPDATE attachments SET
       name = :name,
       local_path = :localPath,
       mime = :mime,
       size = :size,
       hash = :hash,
       storage = :storage,
       group_id = :groupId,
       meta = :meta,
       deleted_at = NULL,
       updated_at = :at
     WHERE id = :id`,
    {
      id: fid,
      // 空值不覆盖已有真实值（正文先落占位、上传后补元数据的场景）
      name: String(name || cur.name || ''),
      localPath: String(localPath || cur.local_path || ''),
      mime: String(mime || cur.mime || ''),
      size: Math.max(0, Number(size) || Number(cur.size) || 0),
      hash: String(hash || cur.hash || ''),
      storage: String(storage || cur.storage || ''),
      groupId: Number(groupId) || Number(cur.group_id) || 0,
      meta: JSON.stringify(mergedMeta),
      at: atMs,
    }
  );
  return fid;
}

interface UpsertDedupedInput {
  id: string;
  kind: string;
  name?: string;
  dedupeKey: string;
  url?: string;
  targetKind?: string;
  targetKey?: string;
  targetSeq?: number | null;
  meta?: Record<string, unknown>;
  atMs?: number;
}

function upsertDeduped(conn: any, {
  id, kind, name, dedupeKey, url = '', targetKind = '', targetKey = '', targetSeq = null,
  meta = {}, atMs = Date.now(),
}: UpsertDedupedInput): string {
  const row = conn.get(
    'SELECT * FROM attachments WHERE dedupe_key = :key AND deleted_at IS NULL',
    { key: dedupeKey }
  );
  if (row) {
    // 存量脏数据自愈：旧行把正文写进 name（多行/超长）时，后续 attach 用新值覆盖。
    const dirtyName = String(row.name || '').includes('\n') || String(row.name || '').length > 200;
    if (name && (!row.name || dirtyName)) {
      conn.run('UPDATE attachments SET name = :name, updated_at = :at WHERE id = :id', {
        id: row.id, name, at: atMs,
      });
    }
    return row.id;
  }
  conn.run(
    `INSERT INTO attachments
       (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
        target_kind, target_key, target_seq, dedupe_key, meta, deleted_at, created_at, updated_at)
     VALUES (:id, :kind, :name, '', :url, '', 0, '', '', 0,
             :targetKind, :targetKey, :targetSeq, :dedupeKey, :meta, NULL, :at, :at)`,
    {
      id,
      kind,
      name: String(name || ''),
      url: String(url || ''),
      targetKind,
      targetKey: String(targetKey || ''),
      targetSeq,
      dedupeKey,
      meta: JSON.stringify(meta || {}),
      at: atMs,
    }
  );
  return id;
}

export function ensureUrlAttachment(conn: any, { url, name = '', atMs = Date.now() }: {
  url?: string; name?: string; atMs?: number;
} = {}): string | null {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;
  return upsertDeduped(conn, {
    id: urlAttachmentId(u),
    kind: 'url',
    name: name || u,
    dedupeKey: 'url:' + u.toLowerCase(),
    url: u,
    atMs,
  });
}

/**
 * 去掉正文头部的 frontmatter（与 shared/frontmatter.js 的 stripFrontmatter 同口径）。
 * core 是最底层，不能反向 import shared，所以这里保留一份最小实现。
 */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FM_KV_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;
function stripFrontmatter(src: unknown): string {
  return String(src ?? '').replace(FM_RE, (block: string, inner: string) => {
    const kv = String(inner || '').split(/\r?\n/).some((l) => FM_KV_RE.test(l));
    return kv ? '' : block;
  });
}

/** 任务标题 = 正文（去 frontmatter）首个非空行，去 # 前缀，截 80 字。 */
function taskTitleOf(body: unknown): string {
  const text = String(stripFrontmatter(String(body || ''))).trim();
  const first = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return first.replace(/^#+\s*/, '').trim().slice(0, 80);
}

/**
 * task 型附件的展示名：只允许「#seq 标题」这种短标签，**绝不允许正文**。
 * 调用方（CLI/面板）可能把整段正文当 name 传进来，这里统一兜底：
 *   - 单行且 ≤80 字 → 视为用户给的别名，去 #seq/# 前缀后保留；
 *   - 多行或超长 → 判定为正文，改用任务实时标题。
 */
function taskAttachmentName(name: string, seq: number, title: string): string {
  const raw = String(name || '').trim();
  const firstLine = (raw.split(/\r?\n/)[0] ?? '').trim();
  const alias = firstLine.replace(/^#\s*\d+\s*/u, '').replace(/^#+\s*/u, '').trim();
  const bodyLike = raw.includes('\n') || raw.length > 80 || !alias;
  const label = bodyLike ? title || `任务 #${seq}` : alias.slice(0, 80);
  return `#${seq} ${label}`.trim();
}

export function ensureTaskAttachment(conn: any, { taskId, atMs = Date.now(), name = '' }: {
  taskId?: string | number; atMs?: number; name?: string;
} = {}): string | null {
  const row = conn.get(
    `SELECT t.id AS taskId, t.seq, t.body, k.key AS topicKey
       FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE t.id = :id`,
    { id: Number(taskId) }
  );
  if (!row) return null;
  const seq = Number(row.seq) || 0;
  return upsertDeduped(conn, {
    id: taskAttachmentId(row.topicKey, seq),
    kind: 'task',
    name: taskAttachmentName(name, seq, taskTitleOf(row.body)),
    dedupeKey: `task:${row.topicKey}:${seq}`,
    targetKind: 'task',
    targetKey: String(row.topicKey),
    targetSeq: seq,
    meta: { taskId: Number(row.taskId), topicKey: String(row.topicKey), seq },
    atMs,
  });
}

export function ensureRefAttachment(conn: any, { refId, atMs = Date.now(), name = '' }: {
  refId?: string | null; atMs?: number; name?: string;
} = {}): string | null {
  const row = conn.get('SELECT id, locator FROM refs WHERE id = :id', { id: String(refId || '') });
  if (!row) return null;
  return upsertDeduped(conn, {
    id: refAttachmentId(row.id),
    kind: 'ref',
    name: name || String(row.locator || row.id).split('/').pop(),
    dedupeKey: `ref:${row.id}`,
    targetKind: 'ref',
    targetKey: String(row.id),
    meta: { refId: String(row.id), locator: String(row.locator || '') },
    atMs,
  });
}

/**
 * mdfile 是「已登记的外部文件指针」：正文引用只能命中已有行，**不能凭 id 造行**
 * （没有路径就无从读取）。未登记时返回 null，由调用方报「先 docs attach --mdfile」。
 */
export function ensureMdfileAttachment(conn: any, { id, name = '', atMs = Date.now() }: {
  id?: string | null; name?: string; atMs?: number;
} = {}): string | null {
  const attId = String(id || '').trim();
  if (!attId) return null;
  const row = conn.get(
    "SELECT id, name FROM attachments WHERE id = :id AND kind = 'mdfile' AND deleted_at IS NULL",
    { id: attId }
  );
  if (!row) return null;
  if (name && !row.name) {
    conn.run('UPDATE attachments SET name = :name, updated_at = :at WHERE id = :id', {
      id: attId, name: String(name), at: atMs,
    });
  }
  return attId;
}

/** 一条正文引用 → 资源 id（无法解析到真实目标的返回 null）。 */
export function ensureAttachment(conn: any, ref: AttachmentRef | null | undefined, { atMs = Date.now() }: {
  atMs?: number;
} = {}): string | null {
  if (!ref) return null;
  if (ref.kind === 'file') {
    return upsertFileAttachment(conn, {
      id: ref.id,
      name: ref.name,
      mime: mimeFromName(ref.name),
      storage: '',
      meta: { isImage: !!ref.isImage, source: 'body' },
      atMs,
    });
  }
  if (ref.kind === 'url') return ensureUrlAttachment(conn, { url: ref.url, name: ref.name, atMs });
  if (ref.kind === 'task') {
    return ensureTaskAttachment(conn, { taskId: ref.targetTaskId, name: ref.name, atMs });
  }
  if (ref.kind === 'ref') return ensureRefAttachment(conn, { refId: ref.targetRefId, name: ref.name, atMs });
  if (ref.kind === 'mdfile') return ensureMdfileAttachment(conn, { id: ref.targetMdfileId, name: ref.name, atMs });
  return null;
}
