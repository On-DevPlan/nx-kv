// 文档附件（ref_attach：文档的资源关系，与任务侧同一套语义）。
import { getDoc, updateDoc } from './service.js';
import type { DocGetResult } from './service.js';
import { badInput } from '../../core/errors.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import {
  deleteAttachment,
  ensureDocRef,
  ensureRefAttachment,
  ensureTaskAttachment,
  ensureUrlAttachment,
  linkAttachment,
  listRefAttachments,
  refIdFor,
  resolveRefId,
  unlinkAttachment,
  updateAttachmentNote,
  upsertFileAttachment,
} from '../../core/attachmentdb.js';
import type { LinkedAttachmentView } from '../../core/attachmentdb/query.js';
import type { DeleteAttachmentResult } from '../../core/attachmentdb/query.js';
import { localUpload } from '../../core/localatt.js';
import { contentTypeOf, isImageName } from '../../core/fileapi.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';

const clean = (v: unknown): string => String(v || '').trim();

/** 取文档的 locator（refs 的稳定键）：自有 = rel，外部 = 绝对路径（POSIX）。 */
async function docLocatorOf(ref: unknown): Promise<{ d: DocGetResult; locator: string }> {
  const d = await getDoc({ ref });
  if (!d || d.missing) throw badInput('文档不存在: ' + String(ref || ''));
  if (d.dir) throw badInput('目录绑定不能挂附件（请指定单个文档）');
  const locator = String(d.rel || d.path || '').replace(/\\/g, '/');
  if (!locator) throw badInput('无法定位文档: ' + String(ref || ''));
  return { d, locator };
}

/** docs attachments 的出参。 */
export interface DocAttachmentsResult {
  refId: string;
  locator: string;
  attachments: Array<LinkedAttachmentView & { docTitle?: string; title?: string }>;
}

/** 这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用）。 */
export async function listDocAttachments({ ref }: { ref?: unknown } = {}): Promise<DocAttachmentsResult> {
  const d = await getDoc({ ref });
  const locator = String(d.rel || d.path || '').replace(/\\/g, '/');
  if (!locator) throw badInput('无法定位文档: ' + String(ref || ''));
  const refId = refIdFor(locator);
  const attachments: Array<LinkedAttachmentView & { docTitle?: string; title?: string }> = listRefAttachments(getDb(), refId);
  // #168：ref 条目补**文档标题**（正文首行的 # 标题）——面板与编辑器都显示它
  try {
    const { refTitlesOf } = await import('./brief.js');
    const titles = await refTitlesOf(
      attachments
        .filter((a) => a.kind === 'ref')
        .map((a) => ({
          id: String((a.meta && a.meta.refId) || a.targetKey || ''),
          locator: String((a.meta && a.meta.locator) || a.targetKey || ''),
        })),
    );
    for (const a of attachments) {
      if (a.kind !== 'ref') continue;
      const t = titles.get(String((a.meta && a.meta.refId) || a.targetKey || ''));
      if (!t) continue;
      a.docTitle = t;
      a.title = t;
      a.name = t;
    }
  } catch {
    /* 读不到标题 → 不补（前端回落文件名） */
  }
  return { refId, locator, attachments };
}

/** docs attach 的入参（CLI flag 透传，含 'no-embed' 连字符形态）。 */
export interface AttachToDocCtx {
  ref?: unknown;
  name?: unknown;
  path?: unknown;
  fileId?: unknown;
  url?: unknown;
  task?: unknown;
  doc?: unknown;
  noEmbed?: unknown;
  note?: unknown;
  [key: string]: unknown;
}

/** docs attach 的出参。 */
export interface AttachToDocResult {
  status: 'ok';
  ref: string;
  attachmentId: string;
  kind: string;
  area: 'area' | 'inline';
  role: 'attach' | 'inline';
  markdown: string;
}

/**
 * 文档挂附件（`docs attach`）：与任务侧同一条写入路径——
 *   attachments（资源）+ ref_attach（关系，role=attach）；
 *   默认把 markdown 追加进正文，`--no-embed` 只挂附件区。
 */
export async function attachToDoc(ctx: AttachToDocCtx): Promise<AttachToDocResult> {
  const { d, locator } = await docLocatorOf(ctx.ref);
  const db = getDb();
  const displayName0 = clean(ctx.name);
  let attachmentId = '';
  let kind: string = '';
  let displayName = displayName0;
  let markdown = '';

  const mod = await import('../../shared/attach.js');
  if (ctx.path) {
    const abs = resolvePath(String(ctx.path));
    let buffer: Buffer | undefined;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      const er = e as { code?: unknown; message?: unknown };
      throw badInput(`读不到文件: ${abs}（${(er && er.code) || er.message}）`);
    }
    const fileName = displayName || basename(abs);
    const rec = await localUpload({ name: fileName, buffer, contentType: contentTypeOf(fileName) });
    displayName = rec.name;
    kind = isImageName(rec.name, rec.contentType) ? 'image' : 'file';
    tx(
      (conn) => upsertFileAttachment(conn, {
        id: rec.fileId,
        name: rec.name,
        localPath: rec.path,
        mime: rec.contentType,
        size: rec.size,
        storage: 'local',
        meta: { isImage: kind === 'image', source: 'docs-cli' },
      }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = rec.fileId;
    markdown = mod.embedMarkdown({ name: displayName, id: rec.fileId, kind: kind as 'image' | 'file' });
  } else if (ctx.fileId) {
    const fid = String(ctx.fileId).trim();
    if (!mod.looksLikeFileId(fid)) throw badInput(`附件 id 不合法: ${fid}`);
    kind = isImageName(fid, '') ? 'image' : 'file';
    displayName = displayName || fid;
    tx(
      (conn) => upsertFileAttachment(conn, { id: fid, name: displayName, meta: { isImage: kind === 'image' } }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = fid;
    markdown = mod.embedMarkdown({ name: displayName, id: fid, kind: kind as 'image' | 'file' });
  } else if (ctx.url) {
    const u = String(ctx.url).trim();
    if (!/^https?:\/\//i.test(u)) throw badInput(`--url 需要 http(s) 绝对地址: ${u}`);
    attachmentId = tx((conn) => ensureUrlAttachment(conn, { url: u, name: displayName }), { db, mode: 'IMMEDIATE' }) || '';
    if (!attachmentId) throw badInput(`URL 登记失败: ${u}`);
    kind = 'url';
    markdown = `[${displayName || u}](${u})`;
  } else if (ctx.task) {
    const tid = Number(String(ctx.task).replace(/^#/, ''));
    if (!Number.isFinite(tid)) throw badInput(`--task 需要任务全局 id: ${ctx.task}`);
    attachmentId = tx((conn) => ensureTaskAttachment(conn, { taskId: tid, name: displayName }), { db, mode: 'IMMEDIATE' }) || '';
    if (!attachmentId) throw badInput(`任务不存在: ${ctx.task}`);
    kind = 'task';
    markdown = `[${displayName || `任务 #${tid}`}](nxkv://task/${tid})`;
  } else if (ctx.doc) {
    const target = await docLocatorOf(ctx.doc);
    const refId =
      resolveRefId(db, target.locator) ||
      tx((conn) => ensureDocRef(conn, { locator: target.locator }), { db, mode: 'IMMEDIATE' });
    if (!refId) throw badInput(`找不到文档: ${ctx.doc}`);
    attachmentId = tx((conn) => ensureRefAttachment(conn, { refId, name: displayName }), { db, mode: 'IMMEDIATE' }) || '';
    if (!attachmentId) throw badInput(`找不到文档: ${ctx.doc}`);
    kind = 'ref';
    markdown = `[${displayName || (target.locator.split('/').pop() ?? '')}](nxkv://ref/${refId})`;
  }

  if (!attachmentId) {
    throw badInput('需要 --path / --fileId / --url / --task / --doc 之一');
  }

  const noEmbed = !!(ctx.noEmbed ?? ctx['no-embed']);
  const role = noEmbed ? 'attach' : 'inline';
  if (noEmbed) {
    tx(
      (conn) => {
        const refId = ensureDocRef(conn, { locator });
        // locator 已由 docLocatorOf 校验非空，ensureDocRef 只在空 locator 时返回 null → 这里必为 string
        linkAttachment(conn, { host: 'ref', hostId: refId as string, attachmentId, role: 'attach', note: ctx.note as string | undefined });
      },
      { db, mode: 'IMMEDIATE' }
    );
  } else {
    const body = d.body || '';
    const next = body ? `${body}\n${markdown}` : markdown;
    await updateDoc({ ref: ctx.ref, body: next });
  }

  return {
    status: 'ok',
    ref: locator,
    attachmentId,
    kind,
    area: noEmbed ? 'area' : 'inline',
    role,
    markdown,
  };
}

/** docs attach --note 的入参。 */
export interface NoteOnDocInput {
  ref?: unknown;
  attachment?: unknown;
  note?: unknown;
}

/** docs attach --note 的出参。 */
export interface NoteOnDocResult {
  refId: string;
  locator: string;
  attachment: string;
  note: string;
}

/**
 * 改一条文档侧绑定上的说明（desc，#168）：与任务侧同一口径——只动 note。
 */
export async function noteOnDoc({ ref, attachment, note = '' }: NoteOnDocInput = {}): Promise<NoteOnDocResult> {
  const { locator } = await docLocatorOf(ref);
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 docs attachments 输出）');
  const db = getDb();
  let changed = 0;
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { locator });
      // 同上：locator 非空 → ensureDocRef 必返回 id（null 分支只在空 locator）
      changed = updateAttachmentNote(conn, { host: 'ref', hostId: refId as string, attachmentId: attId, note: note as string | undefined });
    },
    { db, mode: 'IMMEDIATE' }
  );
  if (!changed) throw badInput(`这篇文档上没有附件 ${attId}`);
  return { refId: refIdFor(locator), locator, attachment: attId, note: String(note || '') };
}

/** docs detach 的入参。 */
export interface DetachFromDocInput {
  ref?: unknown;
  attachment?: unknown;
  purge?: unknown;
}

/** docs detach 的出参。 */
export interface DetachFromDocResult {
  status: 'ok';
  ref: string;
  attachment: string;
  unlinked: number;
  purged: boolean;
  purgeReason: string;
  bytesRemoved: boolean;
}

/** 解除文档与资源的关系；--purge 在无人引用时连资源行与本机字节一起删。 */
export async function detachFromDoc({ ref, attachment, purge }: DetachFromDocInput = {}): Promise<DetachFromDocResult> {
  const { locator } = await docLocatorOf(ref);
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 docs attachments 输出）');
  const db = getDb();
  let unlinked = 0;
  const purgeHolder: { result: DeleteAttachmentResult | null } = { result: null };
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { locator });
      // 同上：locator 非空 → ensureDocRef 必返回 id（null 分支只在空 locator）
      unlinked = unlinkAttachment(conn, { host: 'ref', hostId: refId as string, attachmentId: attId });
      if (purge && unlinked) {
        purgeHolder.result = deleteAttachment(conn, attId, { attachmentsRoot: attachmentsRootFromEnv() });
      }
    },
    { db, mode: 'IMMEDIATE' }
  );
  const purgeResult = purgeHolder.result;
  return {
    status: 'ok',
    ref: locator,
    attachment: attId,
    unlinked,
    purged: !!(purgeResult && purgeResult.removed),
    purgeReason: purgeResult ? purgeResult.reason || '' : '',
    bytesRemoved: !!(purgeResult && purgeResult.bytesRemoved),
  };
}
