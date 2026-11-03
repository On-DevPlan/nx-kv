// tasktool/attach.js —— 本地任务链路的附件编排（标注 / 追加 / 清单）。
//
// 背景（任务 #15「localtask 附件功能未实现」）：web 编辑器（任务 #8）已把附件
// 以 `![名](fileId)` 嵌进正文，但链路的 **agent 侧**对不上——get/wait 交付的
// 正文里躺着一串 fileId，没有附件清单、没有本地路径、也不自动下载；CLI 也没法
// 给本机任务挂附件（云端 todo 有 todo attach / todo attachments，本机没有）。
//
// 这里把这条链补齐，**口径与云端 todo 完全同构**：
//   - 解析：附件语法只有一份实现（modules/todo/attach.js——零依赖纯函数，
//     面板与 Node 共用），这里只消费不重写；
//   - 下载：跟随本机设置 autoSyncAttachments（「读任务时自动下载附件」），
//     落点与 file sync 同一台账（core/attachstore.js）——同一 id 只落一次盘；
//   - 标注：交付载荷带 task.attachments（id/kind/name/localPath/synced），
//     instruction 追加〔附件〕段告诉 agent 去哪读文件。
//
// fail-open 纪律与 todo 相同：附件能不能下载跟任务能不能交付是两件事——
// 标注 / 同步的任何失败都不许拖垮 get/wait；正文没有引用时**载荷逐字节不变**。
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';
import { loadConfig, resolveGroupId } from '../../core/config.js';
import { contentTypeOf, fileUpload, isImageName } from '../../core/fileapi.js';
import { localIndex, syncAttachments } from '../../core/attachstore.js';
import * as service from '../localtask/service.js';

// 附件语法的唯一解析/生成实现（零依赖纯函数；todo 与面板共用同一份）。
// todo 在模块互依禁列里 → 动态 import（与 getloop/add 的 reposStore 同一惯例）。
let todoAttach = null;
async function todoAttachMod() {
  if (!todoAttach) todoAttach = await import('../todo/attach.js');
  return todoAttach;
}

/**
 * 领取/查看时刻的附件标注：解析正文引用 → 按设置自动下载 → 标注本地路径。
 *
 * @param {object|null} task 库存任务（normalizeTask 形状）
 * @returns {Promise<null|{task:object, sync:object|null}>} null = 正文没有附件引用
 *   （调用方据此保持载荷原样）；sync 只在真的跑过同步时非 null。
 */
export async function annotateTaskDelivery(task) {
  if (!task) return null;
  const { attachmentRefs } = await todoAttachMod();
  const refs = attachmentRefs(task.text);
  if (!refs.length) return null;

  const cfg = await loadConfig();
  const gid = await resolveGroupId();

  let sync = null;
  if (cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」
    // （与 todo 读任务的同一套语义，见 todo/service.js annotateAttachments）。
    const names = {};
    for (const r of refs) if (r.alt) names[r.id] = r.alt;
    try {
      sync = await syncAttachments({ groupId: gid, ids: refs.map((r) => r.id), names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String(e && e.message ? e.message : e) }] };
    }
  }

  const { index } = await localIndex(gid, cfg.attachmentsDir);
  const attachments = refs.map((r) => {
    const local = index.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.alt || (local && local.name) || r.id,
      localPath: (local && local.path) || '',
      synced: !!local,
    };
  });
  return { task: { ...task, attachments }, sync };
}

/**
 * 交付 instruction 里的〔附件〕段（纯函数）。没有附件 → ''（整段消失）。
 * 本地已同步 → 直接给绝对路径；没同步 → 给图床 id 与拉取命令，agent 自己决定。
 */
export function attachmentInstruction(attachments, sync) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  const lines = ['〔附件〕本任务正文引用了附件（嵌入即附件，正文随任务走）:'];
  for (const a of list) {
    const kindLabel = a.kind === 'image' ? '图片' : '附件';
    lines.push(
      `  - ${kindLabel} ${a.name}: ` +
        (a.localPath || `未同步到本地（图床 id ${a.id}；nx-kv file sync --ids ${a.id} 可拉到本地）`)
    );
  }
  if (sync) {
    lines.push(
      `  同步: 目录 ${sync.dir || '—'} · 下载 ${sync.downloaded || 0} · 跳过 ${sync.skipped || 0}` +
        (sync.failures && sync.failures.length ? ` · 失败 ${sync.failures.length}` : '')
    );
  }
  return lines.join('\n');
}

/**
 * 给任务追加附件（CLI `localtask attach`）：--path 先上传拿 fileId，或直接
 * --fileId 复用已上传附件；以 markdown 嵌入**追加**到正文末尾（不替换正文）。
 * 面板编辑器贴的是同一条语法（components/md/attachments.js 的嵌入片段）。
 */
export async function attachToTask({ id, cwd, key, path, fileId, name, kind, accessLevel } = {}) {
  const cur = await service.getTask({ id, cwd, key }); // 存在性与参数校验都在队列本体

  let fid = fileId ? String(fileId).trim() : '';
  let displayName = String(name || '').trim();
  let resolvedKind = kind ? String(kind) : '';

  // --path：先上传再嵌——「正文里的 id」与「图床里的文件」一次性对齐
  if (path) {
    const abs = resolvePath(String(path));
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e && e.code) || e.message}）`);
    }
    const fileName = displayName || basename(abs);
    const meta = await fileUpload({
      name: fileName,
      buffer,
      contentType: contentTypeOf(fileName),
      groupId: await resolveGroupId(),
      accessLevel: accessLevel || 'public',
    });
    fid = meta.fileId;
    displayName = fileName;
    if (!resolvedKind) resolvedKind = isImageName(fileName, meta.contentType) ? 'image' : 'file';
  }

  if (!fid) throw badInput('需要 --path <本机文件>（先上传）或 --fileId <已上传的附件 id>');
  const { looksLikeFileId, embedMarkdown } = await todoAttachMod();
  if (!looksLikeFileId(fid)) {
    throw badInput(`附件 id 不合法: ${fid}（应为后端返回的 32 位 hex，可带扩展名）`);
  }
  if (resolvedKind && resolvedKind !== 'image' && resolvedKind !== 'file') {
    throw badInput(`--kind 只能是 image 或 file，收到: ${resolvedKind}`);
  }
  if (!resolvedKind) resolvedKind = isImageName(fid, '') ? 'image' : 'file';

  const markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind });
  // 独立成行追加（与编辑器的插入行为一致：整行图片嵌入渲染为 <img>）
  const text = cur.text ? `${cur.text}\n${markdown}` : markdown;
  const r = await service.updateTask({ id: cur.id, cwd, key, text });

  return { status: 'ok', key: r.key, name: r.name, fileId: fid, kind: resolvedKind, markdown, task: r.task };
}

/**
 * 列出某条任务引用的附件（CLI `localtask attachments`）：不依赖自动下载开关，
 * 但标注本地是否已有（agent 据此决定直接读本地还是先 sync）。
 */
export async function listTaskAttachments({ id, cwd, key } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const cfg = await loadConfig();
  const gid = await resolveGroupId();
  const { attachmentRefs } = await todoAttachMod();
  const { dir, index } = await localIndex(gid, cfg.attachmentsDir);

  const attachments = attachmentRefs(cur.text).map((r) => {
    const local = index.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.alt || (local && local.name) || r.id,
      localPath: (local && local.path) || '',
      synced: !!local,
      size: (local && local.size) || 0,
    };
  });
  return {
    task: { id: cur.id, key },
    localDir: dir,
    autoSync: !!cfg.autoSyncAttachments,
    count: attachments.length,
    attachments,
  };
}
