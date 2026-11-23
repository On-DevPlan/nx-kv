// 参考仓库附件的登记（#184）：附件是**指针**，字节留在原 checkout 里（不 clone / 不复制）。
//
// 与 folder 的区别是语义：repo 必须已在本机登记（repo get 能取到 key / type / 文档），
// 因此这里只认 key，并要求调用方先把仓库元数据查好一起写进 meta —— 交付时模板直接
// 从 meta 读，不必每次回查仓库表（但 localPath 的 exists 仍按盘上现况判定）。
import { existsSync } from 'node:fs';
import { badInput, conflict } from '../errors.js';
import { repoAttachmentId } from './ids.js';

export interface RegisterRepoAttachInput {
  /** 仓库 key（github.com/org/name 或本机登记用的 key） */
  key?: unknown;
  name?: unknown;
  desc?: unknown;
  /** ref / dev */
  repoType?: unknown;
  /** checkout 的本地绝对路径 */
  localPath?: unknown;
  branch?: unknown;
  /** 仓库已绑定的文档 refId 列表 */
  docs?: unknown;
  atMs?: number;
}

/**
 * 登记（或复用）一条仓库附件。按 key 幂等：同一仓库重挂复用同一行，只刷新元数据。
 */
export function registerRepoAttachment(conn: any, {
  key, name = '', desc = '', repoType = '', localPath = '', branch = '', docs = [], atMs = Date.now(),
}: RegisterRepoAttachInput = {}): { id: string; name: string; localPath: string } {
  const repoKey = String(key || '').trim();
  if (!repoKey) throw badInput('repo 附件需要仓库 key（先用 nx-kv repo add 登记）');
  const absPath = String(localPath || '');
  const displayName = String(name || '').trim() || repoKey;
  const id = repoAttachmentId(repoKey);
  const cur = conn.get('SELECT id, kind FROM attachments WHERE id = :id', { id });
  if (cur && cur.kind !== 'repo') {
    throw conflict(`附件 id 冲突：${id} 已被 kind=${cur.kind} 占用，无法登记为 repo`);
  }
  const meta = JSON.stringify({
    repoKey,
    name: displayName,
    desc: String(desc || ''),
    repoType: String(repoType || ''),
    localPath: absPath,
    branch: String(branch || ''),
    docs: Array.isArray(docs) ? docs.map((x) => String(x || '')).filter(Boolean) : [],
  });
  const upsert = (targetId: string): void => conn.run(
    `INSERT INTO attachments
       (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
        target_kind, target_key, target_seq, dedupe_key, meta,
        abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at)
     VALUES (:id, 'repo', :name, :absPath, '', '', 0, '', 'external', 0,
             'repo', :key, NULL, :dedupe, :meta,
             :absPath, :absPath, NULL, :at, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       local_path = excluded.local_path,
       abs_path = excluded.abs_path,
       anchor_dir = excluded.anchor_dir,
       target_key = excluded.target_key,
       dedupe_key = excluded.dedupe_key,
       meta = excluded.meta,
       missing_at = NULL,
       last_seen_at = excluded.last_seen_at,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    { id: targetId, name: displayName, key: repoKey, dedupe: `repo:${repoKey}`, meta, absPath, at: atMs },
  );
  upsert(id);
  return { id, name: displayName, localPath: absPath };
}

/** 正文里出现 nxkv://repo/<id> 时：行必须已存在，否则不认这条引用。 */
export function ensureRepoAttachment(conn: any, { id, name = '', atMs = Date.now() }: {
  id?: string | null; name?: string; atMs?: number;
} = {}): string | null {
  const attId = String(id || '').trim();
  if (!attId) return null;
  const row = conn.get(
    "SELECT id, name FROM attachments WHERE id = :id AND kind = 'repo' AND deleted_at IS NULL",
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

/** 盘上是否还有这个 checkout（交付时现判，不用登记时的快照）。 */
export function repoLocalExists(localPath: unknown): boolean {
  const p = String(localPath || '');
  return !!p && existsSync(p);
}
