// mdfile（本地 md 文件指针）的登记、读取与校验。
//
// 语义（docs/decisions/2026-11-12-refs-body-in-db.md §5 / O7 + 2026-11 收口）：
//   · 字节留在用户磁盘原地：storage='external'，库里只存 abs_path + hash；
//   · 登记时算 sha256 指纹；读取时现读并核对指纹，不一致只报 stale，**不自动改库**；
//   · 文件不存在只标 missing_at，不软删、不删行、不碰外部文件；
//   · 相对链接锚点 = 登记时文件所在目录（anchor_dir），不是任何「文档根」；
//   · `NX_KV_DOCS_DIR` 只是 mdfile 的默认附件目录，不承载文档正文——
//     mdfile 是**唯一**允许直接读该目录（以及任意外部 md）的入口。
//
// 本模块只碰 attachments 一张表与文件系统，不做业务编排（宿主编排在各模块里）。
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { mdfileAttachmentId, normalizeMdfilePath } from './ids.js';
import { badInput, conflict } from '../errors.js';

const MD_EXT_RE = /\.(md|markdown)$/i;

/** 外部 md 必须走文本对面，MIME 固定（不靠扩展名猜，也不影响渲染分支）。 */
export const MDFILE_MIME = 'text/markdown; charset=utf-8';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export interface MdfileRecord {
  id: string;
  name: string;
  absPath: string;
  anchorDir: string;
  size: number;
  hash: string;
  missingAt: number | null;
  lastSeenAt: number | null;
}

export interface RegisterMdfileInput {
  /** 文件路径（相对路径按当前工作目录解析） */
  path?: unknown;
  /** 显示名（默认取文件名） */
  name?: unknown;
  atMs?: number;
}

/**
 * 登记一个本地 md 文件（幂等：同一路径重登记只刷新指纹与时间）。
 * 默认目录（NX_KV_DOCS_DIR）只约束「放哪」，不限制登记：
 * 该目录下的文件同样只能经 attach 访问，所以登记一律放行。
 * @throws 路径非法 / 非 .md / 文件不存在
 */
export function registerMdfile(conn: any, {
  path, name = '', atMs = Date.now(),
}: RegisterMdfileInput = {}): MdfileRecord {
  const absPath = normalizeMdfilePath(path);
  if (!absPath) throw badInput('mdfile 需要文件路径');
  if (!MD_EXT_RE.test(absPath)) {
    throw badInput(`mdfile 只接受 .md / .markdown 文件: ${absPath}`);
  }
  if (!existsSync(absPath)) throw badInput(`文件不存在: ${absPath}`);
  const st = statSync(absPath);
  if (!st.isFile()) throw badInput(`不是普通文件: ${absPath}`);

  const buf = readFileSync(absPath);
  const hash = sha256(buf);
  const size = buf.length;
  const anchorDir = dirname(absPath);
  let id = mdfileAttachmentId(absPath);
  const displayName = String(name || '').trim() || basename(absPath);

  const cur = conn.get('SELECT id, kind FROM attachments WHERE id = :id', { id });
  if (cur && cur.kind !== 'mdfile') {
    throw conflict(`附件 id 冲突：${id} 已被 kind=${cur.kind} 占用，无法登记为 mdfile`);
  }

  const upsert = (targetId: string): void => conn.run(
    `INSERT INTO attachments
       (id, kind, name, local_path, url, mime, size, hash, storage, group_id,
        target_kind, target_key, target_seq, dedupe_key, meta,
        abs_path, anchor_dir, missing_at, last_seen_at, deleted_at, created_at, updated_at)
     VALUES (:id, 'mdfile', :name, '', '', :mime, :size, :hash, 'external', 0,
             '', '', NULL, '', '{}',
             :absPath, :anchorDir, NULL, :at, NULL, :at, :at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       mime = excluded.mime,
       size = excluded.size,
       hash = excluded.hash,
       storage = 'external',
       abs_path = excluded.abs_path,
       anchor_dir = excluded.anchor_dir,
       missing_at = NULL,
       last_seen_at = excluded.last_seen_at,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    {
      id: targetId,
      name: displayName,
      mime: MDFILE_MIME,
      size,
      hash,
      absPath,
      anchorDir,
      at: atMs,
    }
  );

  try {
    upsert(id);
  } catch (e) {
    // Windows：同一文件用不同大小写登记 → 不同 id 撞 ux_attachments_mdfile_path；
    // 回落到已登记行，避免出现两条同文件记录。
    const other = conn.get(
      "SELECT id FROM attachments WHERE kind = 'mdfile' AND deleted_at IS NULL AND abs_path = :absPath COLLATE NOCASE",
      { absPath }
    );
    if (!other) throw e;
    id = String(other.id);
    upsert(id);
  }

  const saved = conn.get('SELECT id, name, abs_path, anchor_dir FROM attachments WHERE id = :id', { id });
  return {
    id,
    name: String(saved?.name || displayName),
    absPath: String(saved?.abs_path || absPath),
    anchorDir: String(saved?.anchor_dir || anchorDir),
    size,
    hash,
    missingAt: null,
    lastSeenAt: atMs,
  };
}

export interface ReadMdfileResult {
  id: string;
  name: string;
  absPath: string;
  anchorDir: string;
  body: string;
  size: number;
  /** 现读指纹（文件缺失时为空） */
  hash: string;
  /** 文件内容与登记时的指纹不一致（不自动改库） */
  stale: boolean;
  /** 文件当前不存在（已标 missing_at） */
  missing: boolean;
  missingAt: number | null;
}

/**
 * 读一个 mdfile 的正文并做读时校验。
 * - 文件不存在：标 `missing_at`，返回空正文 + `missing: true`（不软删行）；
 * - 指纹不一致：返回正文 + `stale: true`（不自动改库）；
 * - 正常：刷新 `last_seen_at` 并清掉 `missing_at`。
 * @returns null = 没有这条 mdfile（或已软删）
 */
export function readMdfile(conn: any, id: unknown, { atMs = Date.now() }: { atMs?: number } = {}): ReadMdfileResult | null {
  const row = conn.get(
    "SELECT * FROM attachments WHERE id = :id AND kind = 'mdfile' AND deleted_at IS NULL",
    { id: String(id || '') }
  );
  if (!row) return null;

  const absPath = String(row.abs_path || '');
  const name = String(row.name || '') || (absPath ? basename(absPath) : String(row.id));
  const anchorDir = String(row.anchor_dir || '') || (absPath ? dirname(absPath) : '');
  const recorded = String(row.hash || '');

  if (!absPath || !existsSync(absPath)) {
    conn.run('UPDATE attachments SET missing_at = :at WHERE id = :id', { at: atMs, id: row.id });
    return {
      id: String(row.id), name, absPath, anchorDir, body: '',
      size: Number(row.size) || 0, hash: '', stale: false, missing: true, missingAt: atMs,
    };
  }

  const buf = readFileSync(absPath);
  const hash = sha256(buf);
  const stale = !!recorded && recorded !== hash;
  // 文件存在就清 missing_at：stale 只表达指纹漂移，两种状态互不排斥。
  conn.run('UPDATE attachments SET last_seen_at = :at, missing_at = NULL WHERE id = :id', {
    at: atMs,
    id: row.id,
  });
  return {
    id: String(row.id),
    name,
    absPath,
    anchorDir,
    body: buf.toString('utf8'),
    size: buf.length,
    hash,
    stale,
    missing: false,
    missingAt: null,
  };
}

export interface MdfileRow extends MdfileRecord {
  /** 台账上的失效时间（不代表此刻一定不存在；以 readMdfile 为准） */
  missing: boolean;
}

/** 按绝对路径找已登记的 mdfile（Windows 大小写不敏感）；没有则 null。 */
export function findMdfileByPath(conn: any, absPath: unknown): MdfileRecord | null {
  const abs = normalizeMdfilePath(absPath);
  if (!abs) return null;
  const row = conn.get(
    `SELECT id, name, abs_path, anchor_dir, size, hash, missing_at, last_seen_at
       FROM attachments
      WHERE kind = 'mdfile' AND deleted_at IS NULL AND abs_path = :abs COLLATE NOCASE`,
    { abs }
  );
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name || ''),
    absPath: String(row.abs_path || ''),
    anchorDir: String(row.anchor_dir || ''),
    size: Number(row.size) || 0,
    hash: String(row.hash || ''),
    missingAt: row.missing_at === null || row.missing_at === undefined ? null : Number(row.missing_at),
    lastSeenAt: row.last_seen_at === null || row.last_seen_at === undefined ? null : Number(row.last_seen_at),
  };
}

/** 列出全部已登记的 mdfile（含已失标的，供巡检）。 */
export function listMdfiles(conn: any, { missingOnly = false }: { missingOnly?: boolean } = {}): MdfileRow[] {
  const rows: any[] = conn.all(
    `SELECT id, name, abs_path, anchor_dir, size, hash, missing_at, last_seen_at
       FROM attachments
      WHERE kind = 'mdfile' AND deleted_at IS NULL
      ORDER BY updated_at DESC, id`
  );
  return rows
    .map((r: any): MdfileRow => ({
      id: String(r.id),
      name: String(r.name || ''),
      absPath: String(r.abs_path || ''),
      anchorDir: String(r.anchor_dir || ''),
      size: Number(r.size) || 0,
      hash: String(r.hash || ''),
      missingAt: r.missing_at === null || r.missing_at === undefined ? null : Number(r.missing_at),
      lastSeenAt: r.last_seen_at === null || r.last_seen_at === undefined ? null : Number(r.last_seen_at),
      missing: r.missing_at !== null && r.missing_at !== undefined,
    }))
    .filter((r) => !missingOnly || r.missing);
}
