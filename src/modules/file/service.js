// 附件模块：用户空间里的图片 / 文档等二进制原件，**双后端**：
//   - 云端图床（dev_ctr_hello /api/v1/files*，上传 multipart，出图 /files/:fileId）
//     —— 云端清单（todo）的附件走这边，本地镜像细节在 core/attachstore.js；
//   - 本地附件仓（core/localatt.js）—— 本地任务（localtask）的贴图走这边，
//     不碰网：上传落本机盘、预览读本机文件、agent 直接拿本地路径。
// 本模块只做「业务编排 + 人读渲染」，网络细节全在 core/fileapi.js。
//
// 与 todo 的分工：附件**内容**归这里；附件**怎么被任务引用**归 todo
// （任务正文里的 ![说明](fileId)，见 modules/todo/attach.js）。
// 两边都不 import 对方 —— 需要共享的东西都在 core/。
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { badInput } from '../../core/errors.js';
import { loadConfig, resolveGroupId } from '../../core/config.js';
import {
  accessUrlOf, contentTypeOf, deleteFile, fileInfo, fileUpload, isImageName, listFiles, openFileStream,
} from '../../core/fileapi.js';
import { localDirFor, localIndex, resolveLocal, syncAttachments } from '../../core/attachstore.js';
import { localDir, localReadStream, localResolve, localUpload } from '../../core/localatt.js';
import { getDb } from '../../core/db/index.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { listOrphans, pruneOrphans, upsertFileAttachment } from '../../core/attachmentdb.js';

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
};

function decodeBase64(content) {
  let b64 = String(content || '');
  const comma = b64.indexOf(',');
  if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { throw badInput('上传内容不是合法的 base64'); }
  if (!buf.length) throw badInput('上传内容为空');
  return buf;
}

// 贴进任务正文的嵌入语法。解析端在 modules/todo/attach.js——
// 那里是**唯一**的解析实现；这里只是把同一套语法生成出来给人/agent 复制。
const snippetOf = (name, fileId) => ({ image: `![${name}](${fileId})`, file: `[${name}](${fileId})` });

export async function listFilesAction({ group, limit = 100, offset = 0 } = {}) {
  const cfg = await loadConfig();
  // 一律先解析工作空间：显式 --group 优先，否则回落本机配置的当前值。
  // 直接拿裸 group 会让「配置里是 24、这次没传 --group」变成去查后端默认组 ——
  // 那正是「读任务在 A 组、同步附件在 B 组」这种不报错的错位。
  const gid = await resolveGroupId(group);
  const r = await listFiles({ groupId: gid, limit, offset });
  const { dir, index } = await localIndex(gid, cfg.attachmentsDir);
  return {
    groupId: gid || 0,
    total: r.total,
    hasMore: r.hasMore,
    localDir: dir,
    files: r.items.map((f) => ({
      fileId: f.fileId,
      url: accessUrlOf(cfg.baseUrl, f.fileId),
      size: f.size,
      contentType: f.contentType,
      isImage: isImageName(f.fileId, f.contentType),
      accessLevel: f.accessLevel,
      createdAt: f.createdAt,
      localPath: index.get(f.fileId)?.path || '',
    })),
  };
}

export async function uploadFileAction(patch = {}) {
  const { path: localPath, content, name, contentType, group, accessLevel = 'public', local: toLocal } = patch;
  let buffer;
  let fileName;

  if (localPath) {
    const abs = resolve(String(localPath));
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${e.code || e.message}）`);
    }
    fileName = name || basename(abs);
  } else if (content !== undefined && content !== null) {
    if (!name) throw badInput('Web 上传需要文件名：--name <文件名>');
    buffer = decodeBase64(content);
    fileName = name;
  } else {
    throw badInput('上传需要 --path <本机文件>，或 --content <base64> --name <文件名>');
  }

  // 本地任务贴图 → 本地附件仓：不碰网、不解析工作空间（group 是云端图床的归属维度），
  // 上传即已在本地，agent 直接读 localPath——这条链路与云端零关联。
  if (toLocal) {
    const rec = await localUpload({ name: fileName, buffer, contentType: contentType || contentTypeOf(fileName) });
    return {
      fileId: rec.fileId,
      name: rec.name,
      size: rec.size,
      contentType: rec.contentType,
      url: `/api/file/content/${rec.fileId}`,
      isImage: isImageName(rec.name, rec.contentType),
      localPath: rec.path,
      localDir: localDir(),
      storage: 'local',
      markdown: snippetOf(rec.name, rec.fileId),
    };
  }

  const cfg = await loadConfig();
  const gid = await resolveGroupId(group);
  const meta = await fileUpload({
    name: fileName,
    buffer,
    contentType: contentType || contentTypeOf(fileName),
    groupId: gid,
    accessLevel,
  });
  // 云端上传也立刻登记资源行：关系表才能按 fileId JOIN 到 name/size/mime。
  upsertFileAttachment(getDb(), {
    id: meta.fileId,
    name: fileName,
    mime: meta.contentType || contentType || contentTypeOf(fileName),
    size: Number(meta.size) || buffer.length,
    storage: 'cloud',
    groupId: gid || 0,
    meta: { accessLevel, uploadedAt: meta.createdAt || '' },
  });
  return {
    ...meta,
    url: accessUrlOf(cfg.baseUrl, meta.fileId),
    isImage: isImageName(fileName, meta.contentType),
    localDir: localDirFor(gid, cfg.attachmentsDir),
    storage: 'cloud',
    markdown: snippetOf(fileName, meta.fileId),
  };
}

export async function getFileAction(fileId, { group } = {}) {
  if (!fileId) throw badInput('缺少 fileId');
  // 本地仓命中就不问云端：本地任务贴图的查询零网络、离线可用。
  // 两套 id 同构（32 位 hex），先本地后云端的顺序天然消歧。
  const hit = await localResolve(fileId);
  if (hit) {
    return {
      fileId: hit.fileId,
      name: hit.name,
      size: hit.size,
      contentType: hit.contentType,
      url: `/api/file/content/${hit.fileId}`,
      isImage: isImageName(hit.name, hit.contentType),
      localPath: hit.path,
      storage: 'local',
    };
  }
  const cfg = await loadConfig();
  const gid = await resolveGroupId(group);
  const meta = await fileInfo(fileId, gid);
  const local = await resolveLocal(gid, fileId, cfg.attachmentsDir);
  return {
    ...meta,
    url: accessUrlOf(cfg.baseUrl, meta.fileId),
    isImage: isImageName(meta.fileId, meta.contentType),
    localPath: local?.path || '',
    localName: local?.name || '',
    storage: 'cloud',
  };
}

export async function removeFileAction(fileId, { group } = {}) {
  if (!fileId) throw badInput('缺少 fileId');
  const r = await deleteFile(fileId, await resolveGroupId(group));
  return { status: 'ok', ...r, note: '本地已同步的副本不会自动删除；要一并清理用 nx-kv file sync --prune' };
}

/** 无主资源清单：没有任何任务/文档关系边。 */
export async function listOrphanAttachmentsAction() {
  const rows = listOrphans(getDb());
  return {
    total: rows.length,
    attachments: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      localPath: r.localPath,
      url: r.url,
      size: r.size,
      storage: r.storage,
      targetKind: r.targetKind,
      targetKey: r.targetKey,
      targetSeq: r.targetSeq,
    })),
    localRoot: attachmentsRootFromEnv(),
  };
}

/**
 * 回收无主资源：删 DB 行；本机/云端镜像文件在附件根目录内的一并删字节。
 * 被任何任务/文档引用的行不会被删（共享资源不能因为另一处删行而消失）。
 */
export async function pruneOrphanAttachmentsAction({ dryRun = false } = {}) {
  const db = getDb();
  const result = pruneOrphans(db, { attachmentsRoot: attachmentsRootFromEnv(), dryRun });
  return {
    dryRun: !!dryRun,
    removed: result.removed.length,
    skipped: result.skipped.length,
    attachments: result.removed.map((r) => ({ id: r.id, kind: r.kind, name: r.name, localPath: r.localPath })),
  };
}

/** 同步到本地 —— 这个子命令存在的唯一理由：**让 agent 读本地文件而不是读网**。 */
export async function syncFilesAction({ group, ids, dir, prune, dryRun } = {}) {
  const cfg = await loadConfig();
  const gid = await resolveGroupId(group);
  const result = await syncAttachments({
    groupId: gid,
    ids: Array.isArray(ids) && ids.length ? ids : null,
    dir: dir || cfg.attachmentsDir,
    prune: prune === true,
    dryRun: dryRun === true,
  });
  return { ...result, usedDir: localDirFor(gid, dir || cfg.attachmentsDir) };
}

/** HTTP 原始流：附件本体直接透给浏览器（面板里 <img src> 直接用）。
 *  本地仓命中 → 读本机文件（离线可预览，本地任务贴图不依赖云端）；
 *  未命中 → 云端出图原样透传（云端清单附件的老路径，行为不变）。 */
export async function serveContent(ctx) {
  const { res } = ctx.__raw || {};
  if (!res) throw badInput('内部错误：缺少响应对象');
  const hit = await localResolve(ctx.fileId);
  if (hit) {
    res.writeHead(200, { 'content-type': hit.contentType || 'application/octet-stream', 'cache-control': 'no-store' });
    await new Promise((done, fail) => {
      const rs = localReadStream(hit.path);
      rs.once('error', fail);
      res.once('close', done);
      res.once('finish', done);
      rs.pipe(res);
    });
    return;
  }
  const up = await openFileStream(ctx.fileId);
  const ct = up.headers.get('content-type') || 'application/octet-stream';
  res.writeHead(200, { 'content-type': ct, 'cache-control': 'no-store' });
  const rs = Readable.fromWeb(up.body);
  await new Promise((done, fail) => {
    rs.once('error', fail);
    res.once('close', done);
    res.once('finish', done);
    rs.pipe(res);
  });
}

// ---- CLI 人读渲染 ----

export function renderFileList(d) {
  const lines = [`附件 ${d.files.length} 个（共 ${d.total}）· 本地目录 ${d.localDir}`];
  for (const f of d.files) {
    lines.push(`  ${f.fileId}  ${f.isImage ? '[图片]' : '[文件]'}  ${fmtBytes(f.size)}  ${f.contentType}`);
    if (f.localPath) lines.push(`      本地: ${f.localPath}`);
  }
  lines.push('', '上传: nx-kv file upload --path <本机文件>　同步到本地: nx-kv file sync');
  return lines.join('\n');
}

export function renderUpload(d) {
  if (d.storage === 'local') {
    return [
      `已上传 ${d.fileId}（${fmtBytes(d.size)} · ${d.contentType}）→ 本机附件仓`,
      `本地:   ${d.localPath}`,
      `贴进任务正文（编辑时也可直接选图上传）:`,
      `  ${d.isImage ? d.markdown.image : d.markdown.file}`,
    ].join('\n');
  }
  return [
    `已上传 ${d.fileId}（${fmtBytes(d.size)} · ${d.contentType}）`,
    `地址:   ${d.url}`,
    `本地目录: ${d.localDir}（跑 nx-kv file sync 可落到本地）`,
    `贴进任务正文（编辑时也可直接选图上传）:`,
    `  ${d.isImage ? d.markdown.image : d.markdown.file}`,
  ].join('\n');
}

export function renderFileInfo(d) {
  if (d.storage === 'local') {
    return [
      `${d.fileId} · ${d.isImage ? '图片' : '文件'} · ${fmtBytes(d.size)} · ${d.contentType}`,
      `地址:   ${d.url}`,
      `本地:   ${d.localPath}（本机附件仓，不依赖云端）`,
    ].join('\n');
  }
  return [
    `${d.fileId} · ${d.isImage ? '图片' : '文件'} · ${fmtBytes(d.size)} · ${d.contentType}`,
    `地址:   ${d.url}`,
    d.localPath ? `本地:   ${d.localPath}` : '本地:   （未同步；nx-kv file sync 拉到本地）',
    `权限:   ${d.accessLevel}${d.createdAt ? ` · 上传于 ${d.createdAt}` : ''}`,
  ].join('\n');
}

export function renderRemove(d) {
  return `已删除附件 ${d.fileId}\n${d.note}`;
}

export function renderSync(d) {
  const head = d.dryRun ? '试运行（未下载）：' : '同步完成：';
  const lines = [
    `${head}下载 ${d.downloaded} · 跳过 ${d.skipped} · 删除 ${d.removed.length} · 目标 ${d.target}`,
    `本地目录: ${d.usedDir}`,
  ];
  for (const f of d.files) lines.push(`  ${f.path}`);
  if (d.missing.length) lines.push(`后端不存在（可能已删）: ${d.missing.join(', ')}`);
  if (d.failures.length) {
    lines.push('下载失败:');
    for (const f of d.failures) lines.push(`  ${f.id}: ${f.error}`);
  }
  if (!d.files.length) lines.push('（没有可同步的附件）');
  return lines.join('\n');
}

export function renderContent(d) {
  return [
    `${d.fileId}`,
    `地址: ${d.url}`,
    d.localPath ? `本地: ${d.localPath}` : '本地: （未同步）',
  ].join('\n');
}

export function renderOrphans(d) {
  if (!d.total) return `没有无主资源（附件根: ${d.localRoot}）`;
  const lines = [`无主资源 ${d.total} 个（附件根: ${d.localRoot}）`];
  for (const a of d.attachments) {
    const where = a.localPath || a.url || (a.kind === 'task' ? `task ${a.targetKey}#${a.targetSeq}` : a.targetKey);
    lines.push(`  ${a.id}  [${a.kind}]  ${a.name || '-'}  ${where || ''}`);
  }
  lines.push('', '回收: nx-kv file prune（先看清单可加 --dry-run）');
  return lines.join('\n');
}

export function renderPrune(d) {
  if (d.dryRun) return `试运行：将回收 ${d.removed} 个无主资源（跳过 ${d.skipped} 个仍被引用的）`;
  const lines = [`已回收 ${d.removed} 个无主资源（跳过 ${d.skipped} 个仍被引用的）`];
  for (const a of d.attachments) lines.push(`  ${a.id}  [${a.kind}]  ${a.name || '-'}  ${a.localPath || ''}`);
  if (!d.removed) lines.push('（没有可回收的资源）');
  return lines.join('\n');
}
