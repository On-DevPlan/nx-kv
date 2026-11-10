// 文档附件（ref_attach：文档的资源关系，与任务侧同一套语义）。
import { getDoc, updateDoc } from './service.js';
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
  upsertFileAttachment,
} from '../../core/attachmentdb.js';
import { localUpload } from '../../core/localatt.js';
import { contentTypeOf, isImageName } from '../../core/fileapi.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';

const clean = (v) => String(v || '').trim();

/** 取文档的 locator（refs 的稳定键）：自有 = rel，外部 = 绝对路径（POSIX）。 */
async function docLocatorOf(ref) {
  const d = await getDoc({ ref });
  if (!d || d.missing) throw badInput('文档不存在: ' + String(ref || ''));
  if (d.dir) throw badInput('目录绑定不能挂附件（请指定单个文档）');
  const locator = String(d.rel || d.path || '').replace(/\\/g, '/');
  if (!locator) throw badInput('无法定位文档: ' + String(ref || ''));
  return { d, locator };
}

/** 这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用）。 */
export async function listDocAttachments({ ref } = {}) {
  const d = await getDoc({ ref });
  const locator = String(d.rel || d.path || '').replace(/\\/g, '/');
  if (!locator) throw badInput('无法定位文档: ' + String(ref || ''));
  return { refId: refIdFor(locator), locator, attachments: listRefAttachments(getDb(), refIdFor(locator)) };
}

/**
 * 文档挂附件（`docs attach`）：与任务侧同一条写入路径——
 *   attachments（资源）+ ref_attach（关系，role=attach）；
 *   默认把 markdown 追加进正文，`--no-embed` 只挂附件区。
 */
export async function attachToDoc(ctx) {
  const { d, locator } = await docLocatorOf(ctx.ref);
  const db = getDb();
  const displayName0 = clean(ctx.name);
  let attachmentId = '';
  let kind = '';
  let displayName = displayName0;
  let markdown = '';

  const mod = await import('../../shared/attach.js');
  if (ctx.path) {
    const abs = resolvePath(String(ctx.path));
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e && e.code) || e.message}）`);
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
    markdown = mod.embedMarkdown({ name: displayName, id: rec.fileId, kind });
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
    markdown = mod.embedMarkdown({ name: displayName, id: fid, kind });
  } else if (ctx.url) {
    const u = String(ctx.url).trim();
    if (!/^https?:\/\//i.test(u)) throw badInput(`--url 需要 http(s) 绝对地址: ${u}`);
    attachmentId = tx((conn) => ensureUrlAttachment(conn, { url: u, name: displayName }), { db, mode: 'IMMEDIATE' });
    if (!attachmentId) throw badInput(`URL 登记失败: ${u}`);
    kind = 'url';
    markdown = `[${displayName || u}](${u})`;
  } else if (ctx.task) {
    const tid = Number(String(ctx.task).replace(/^#/, ''));
    if (!Number.isFinite(tid)) throw badInput(`--task 需要任务全局 id: ${ctx.task}`);
    attachmentId = tx((conn) => ensureTaskAttachment(conn, { taskId: tid, name: displayName }), { db, mode: 'IMMEDIATE' });
    if (!attachmentId) throw badInput(`任务不存在: ${ctx.task}`);
    kind = 'task';
    markdown = `[${displayName || `任务 #${tid}`}](nxkv://task/${tid})`;
  } else if (ctx.doc) {
    const target = await docLocatorOf(ctx.doc);
    const refId =
      resolveRefId(db, target.locator) ||
      tx((conn) => ensureDocRef(conn, { locator: target.locator }), { db, mode: 'IMMEDIATE' });
    if (!refId) throw badInput(`找不到文档: ${ctx.doc}`);
    attachmentId = tx((conn) => ensureRefAttachment(conn, { refId, name: displayName }), { db, mode: 'IMMEDIATE' });
    if (!attachmentId) throw badInput(`找不到文档: ${ctx.doc}`);
    kind = 'ref';
    markdown = `[${displayName || target.locator.split('/').pop()}](nxkv://ref/${refId})`;
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
        linkAttachment(conn, { host: 'ref', hostId: refId, attachmentId, role: 'attach', note: ctx.note });
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

/** 解除文档与资源的关系；--purge 在无人引用时连资源行与本机字节一起删。 */
export async function detachFromDoc({ ref, attachment, purge } = {}) {
  const { locator } = await docLocatorOf(ref);
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 docs attachments 输出）');
  const db = getDb();
  let unlinked = 0;
  let purgeResult = null;
  tx(
    (conn) => {
      const refId = ensureDocRef(conn, { locator });
      unlinked = unlinkAttachment(conn, { host: 'ref', hostId: refId, attachmentId: attId });
      if (purge && unlinked) {
        purgeResult = deleteAttachment(conn, attId, { attachmentsRoot: attachmentsRootFromEnv() });
      }
    },
    { db, mode: 'IMMEDIATE' }
  );
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
