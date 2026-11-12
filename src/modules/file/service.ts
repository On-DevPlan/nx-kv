// 本机附件模块：图片 / 文档等二进制原件，字节落本机盘、元数据进 SQLite。
//
// 云端图床已随「云端任务」整体移除；这里只保留本地任务与文档使用的本机附件仓：
//   · 上传 → core/localatt（不碰网）
//   · 预览 / 取本体 → 读本机文件
//   · 无主资源清单与回收 → attachments 表
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { badInput, notFound } from '../../core/errors.js';
import { isImageName, contentTypeOf } from '../../core/filekind.js';
import { localDir, localReadStream, localResolve, localUpload } from '../../core/localatt.js';
import { getDb } from '../../core/db/index.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import { listOrphans, pruneOrphans } from '../../core/attachmentdb.js';

/** 上传结果。 */
export interface UploadView {
  fileId: string;
  size: number;
  contentType: string;
  storage: string;
  isImage: boolean;
  markdown: { image: string; file: string };
  localPath?: string;
  localDir?: string;
  url?: string;
  name?: string;
}

/** 单附件详情。 */
export interface FileInfoView {
  fileId: string;
  isImage: boolean;
  size: number;
  contentType: string;
  url: string;
  storage: string;
  localPath?: string;
  localName?: string;
  name?: string;
}

/** 一条无主资源。 */
export interface OrphanAttachment {
  id: string;
  kind: string;
  name: string;
  localPath: string;
  url: string;
  size: number;
  storage: string;
  targetKind: string;
  targetKey: string;
  targetSeq: string | number;
}

/** HTTP 原始流上下文（action 传进来的 ctx 里只有这两样被读）。 */
export interface ServeCtx {
  fileId: string;
  __raw?: { res?: any };
}

const fmtBytes = (n: unknown): string => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
};

function decodeBase64(content: unknown): Buffer {
  let b64 = String(content || '');
  const comma = b64.indexOf(',');
  if (b64.startsWith('data:') && comma >= 0) b64 = b64.slice(comma + 1);
  let buf: any;
  try { buf = Buffer.from(b64, 'base64'); } catch { throw badInput('上传内容不是合法的 base64'); }
  if (!buf.length) throw badInput('上传内容为空');
  return buf;
}

// 贴进任务正文的嵌入语法（解析端在 shared/attach）。
const snippetOf = (name: string, fileId: string): { image: string; file: string } => ({
  image: `![${name}](${fileId})`,
  file: `[${name}](${fileId})`,
});

/** 上传到本机附件仓（不碰网）。 */
export async function uploadFileAction(patch: {
  path?: string;
  content?: unknown;
  name?: string;
  contentType?: string;
} = {}): Promise<UploadView> {
  const { path: localPath, content, name, contentType } = patch;
  let buffer: Buffer;
  let fileName: string;

  if (localPath) {
    const abs = resolve(String(localPath));
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e as NodeJS.ErrnoException).code || (e as Error).message}）`);
    }
    fileName = name || basename(abs);
  } else if (content !== undefined && content !== null) {
    if (!name) throw badInput('Web 上传需要文件名：--name <文件名>');
    buffer = decodeBase64(content);
    fileName = name;
  } else {
    throw badInput('上传需要 --path <本机文件>，或 --content <base64> --name <文件名>');
  }

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

/** 查单个附件（只查本机仓）。 */
export async function getFileAction(fileId: string): Promise<FileInfoView> {
  if (!fileId) throw badInput('缺少 fileId');
  const hit = await localResolve(fileId);
  if (!hit) throw notFound('附件不存在: ' + fileId);
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

/** 无主资源清单：没有任何任务/文档关系边。 */
export async function listOrphanAttachmentsAction(): Promise<{
  total: number;
  attachments: OrphanAttachment[];
  localRoot: string;
}> {
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

/** 回收无主资源：删 DB 行；本机文件在附件根目录内的一并删字节。 */
export async function pruneOrphanAttachmentsAction({ dryRun = false }: { dryRun?: boolean } = {}): Promise<{
  dryRun: boolean;
  removed: number;
  skipped: number;
  attachments: Array<{ id: string; kind: string; name: string; localPath: string }>;
}> {
  const db = getDb();
  const result = pruneOrphans(db, { attachmentsRoot: attachmentsRootFromEnv(), dryRun });
  return {
    dryRun: !!dryRun,
    removed: result.removed.length,
    skipped: result.skipped.length,
    attachments: result.removed.map((r) => ({ id: r.id, kind: r.kind, name: r.name, localPath: r.localPath })),
  };
}

/** HTTP 原始流：附件本体直接透给浏览器（面板里 <img src> 直接用）。 */
export async function serveContent(ctx: ServeCtx): Promise<void> {
  const res = ctx.__raw?.res;
  if (!res) throw badInput('内部错误：缺少响应对象');
  const hit = await localResolve(ctx.fileId);
  if (!hit) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('附件不存在');
    return;
  }
  res.writeHead(200, { 'content-type': hit.contentType || 'application/octet-stream', 'cache-control': 'no-store' });
  await new Promise<void>((done, fail) => {
    const rs = localReadStream(hit.path);
    rs.once('error', fail);
    res.once('close', done);
    res.once('finish', done);
    rs.pipe(res);
  });
}

// ---- CLI 人读渲染 ----

export function renderUpload(d: UploadView): string {
  return [
    `已上传 ${d.fileId}（${fmtBytes(d.size)} · ${d.contentType}）→ 本机附件仓`,
    `本地:   ${d.localPath}`,
    '贴进任务正文（编辑时也可直接选图上传）:',
    `  ${d.isImage ? d.markdown.image : d.markdown.file}`,
  ].join('\n');
}

export function renderFileInfo(d: FileInfoView): string {
  return [
    `${d.fileId} · ${d.isImage ? '图片' : '文件'} · ${fmtBytes(d.size)} · ${d.contentType}`,
    `地址:   ${d.url}`,
    `本地:   ${d.localPath}（本机附件仓，不依赖云端）`,
  ].join('\n');
}

export function renderOrphans(d: { total: number; localRoot: string; attachments: OrphanAttachment[] }): string {
  if (!d.total) return `没有无主资源（附件根: ${d.localRoot}）`;
  const lines = [`无主资源 ${d.total} 个（附件根: ${d.localRoot}）`];
  for (const a of d.attachments) {
    const where = a.localPath || a.url || (a.kind === 'task' ? `task ${a.targetKey}#${a.targetSeq}` : a.targetKey);
    lines.push(`  ${a.id}  [${a.kind}]  ${a.name || '-'}  ${where || ''}`);
  }
  lines.push('', '回收: nx-kv file prune（先看清单可加 --dry-run）');
  return lines.join('\n');
}

export function renderPrune(d: {
  dryRun: boolean;
  removed: number;
  skipped: number;
  attachments: Array<{ id: string; kind: string; name: string; localPath: string }>;
}): string {
  if (d.dryRun) return `试运行：将回收 ${d.removed} 个无主资源（跳过 ${d.skipped} 个仍被引用的）`;
  const lines = [`已回收 ${d.removed} 个无主资源（跳过 ${d.skipped} 个仍被引用的）`];
  for (const a of d.attachments) lines.push(`  ${a.id}  [${a.kind}]  ${a.name || '-'}  ${a.localPath || ''}`);
  if (!d.removed) lines.push('（没有可回收的资源）');
  return lines.join('\n');
}
