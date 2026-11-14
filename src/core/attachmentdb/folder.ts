// 本地文件夹附件（#127）：只登记一个绝对路径指针，目录内容不入库。
//
// 与 mdfile 同为 `storage='external'`，区别在于：
//   · mdfile 是单个 .md 文件，登记时读指纹、交付时附正文；
//   · folder 是目录，没有字节（size=0 / hash='' / mime=''），交付只给路径，
//     由 agent 按需列目录 / 读里面的文件。
import { existsSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { badInput, conflict } from '../errors.js';

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

/** 规范化文件夹绝对路径：解析相对路径、去掉尾部斜杠、身份种子用 POSIX + 小写盘符。 */
export function normalizeFolderPath(input: unknown): string {
  const raw = String(input ?? '').trim().replace(/["']+$/, '');
  if (!raw) return '';
  const abs = resolve(raw);
  return abs.replace(/[\\/]+$/, '') || abs;
}

/** 稳定 id：`att_folder_<sha1(规范化路径).slice(0,16)>`；同一路径幂等。 */
export function folderAttachmentId(path: unknown): string {
  let seed = normalizeFolderPath(path).replace(/\\/g, '/');
  if (/^[A-Z]:/.test(seed)) seed = seed.charAt(0).toLowerCase() + seed.slice(1);
  return 'att_folder_' + sha1(seed).slice(0, 16);
}

/** 登记（或刷新）一条文件夹附件；返回 { id, name, absPath }。 */
export function registerFolder(conn: any, { path, name, atMs = Date.now() }: {
  path?: unknown; name?: unknown; atMs?: number;
} = {}): { id: string; name: string; absPath: string } {
  const absPath = normalizeFolderPath(path);
  if (!absPath) throw badInput('folder 需要文件夹路径');
  if (!existsSync(absPath)) throw badInput(`文件夹不存在: ${absPath}`);
  const st = statSync(absPath);
  if (!st.isDirectory()) throw badInput(`不是文件夹: ${absPath}`);

  const displayName = String(name || '').trim() || basename(absPath);
  const id = folderAttachmentId(absPath);
  const cur = conn.get('SELECT id, kind FROM attachments WHERE id = :id', { id });
  if (cur && cur.kind !== 'folder') {
    throw conflict(`附件 id 冲突：${id} 已被 kind=${cur.kind} 占用，无法登记为 folder`);
  }

  const upsert = (targetId: string): void => conn.run(
    `INSERT INTO attachments
       (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
        target_kind, target_key, target_seq, dedupe_key, meta,
        abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at)
     VALUES (:id, 'folder', :name, '', '', '', 0, '', 'external', 0,
             '', '', NULL, '', '{}',
             :absPath, :absPath, NULL, :at, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       abs_path = excluded.abs_path,
       anchor_dir = excluded.anchor_dir,
       missing_at = NULL,
       last_seen_at = excluded.last_seen_at,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    { id: targetId, name: displayName, absPath, at: atMs },
  );

  try {
    upsert(id);
  } catch {
    // Windows 大小写差异撞 ux_attachments_folder_path → 回到已登记那一行
    const other = conn.get(
      "SELECT id FROM attachments WHERE kind = 'folder' AND deleted_at IS NULL AND abs_path = :absPath COLLATE NOCASE",
      { absPath },
    );
    if (!other) throw conflict(`文件夹已用另一条记录登记: ${absPath}`);
    upsert(String(other.id));
    return { id: String(other.id), name: displayName, absPath };
  }
  return { id, name: displayName, absPath };
}

/** 正文里出现 nxkv://folder/<id> 时：行必须已存在，否则不认这条引用。 */
export function ensureFolderAttachment(conn: any, { id, name = '', atMs = Date.now() }: {
  id?: string | null; name?: string; atMs?: number;
} = {}): string | null {
  const attId = String(id || '').trim();
  if (!attId) return null;
  const row = conn.get(
    "SELECT id, name FROM attachments WHERE id = :id AND kind = 'folder' AND deleted_at IS NULL",
    { id: attId },
  );
  if (!row) return null;
  if (name && !row.name) {
    conn.run('UPDATE attachments SET name = :name, updated_at = :at WHERE id = :id', {
      id: attId, name: String(name), at: atMs,
    });
  }
  return attId;
}
