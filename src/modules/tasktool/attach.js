// tasktool/attach.js —— 本地任务链路的附件编排（标注 / 追加 / 清单）。
//
// 背景（任务 #15「localtask 附件功能未实现」）：web 编辑器已把附件以
// `![名](fileId)` 嵌进正文，但链路的 **agent 侧**对不上——get/wait 交付的
// 正文里躺着一串 fileId，没有附件清单、没有本地路径；CLI 也没法给本机任务挂附件。
//
// 口径（任务 #15 验收反馈 2026-11-04）：**本地任务的贴图走本地存储，与云端
// 零关联**——
//   - `localtask attach --path` 落**本机附件仓**（core/localatt.js，不发网）；
//   - 领取标注先查本机仓：命中直接给绝对路径，agent 零网络读文件；
//   - 未命中的 id（云端清单附件的引用、或 CLI --fileId 引的云端 id）才按本机
//     设置 autoSyncAttachments 走云端镜像（core/attachstore.js），fail-open。
//   - 解析：附件语法只有一份实现（modules/todo/attach.js——零依赖纯函数，
//     面板与 Node 共用），这里只消费不重写；
//   - 标注：交付载荷带 task.attachments（id/kind/name/localPath/synced/storage），
//     instruction 追加〔附件〕段告诉 agent 去哪读文件。
//
// fail-open 纪律与 todo 相同：附件能不能拿到跟任务能不能交付是两件事——
// 标注 / 同步的任何失败都不许拖垮 get/wait；正文没有引用时**载荷逐字节不变**。
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';
import { renderInstruction } from '../../core/instruction-template.js';
import { loadConfig, resolveGroupId } from '../../core/config.js';
import { contentTypeOf, isImageName } from '../../core/fileapi.js';
import { localIndex as cloudMirrorIndex, syncAttachments } from '../../core/attachstore.js';
import { localIndex as localStoreIndex, localUpload } from '../../core/localatt.js';
import * as service from '../localtask/service.js';

// 附件语法的唯一解析/生成实现（零依赖纯函数；todo 与面板共用同一份）。
// todo 在模块互依禁列里 → 动态 import（与 getloop/add 的 reposStore 同一惯例）。
let todoAttach = null;
async function todoAttachMod() {
  if (!todoAttach) todoAttach = await import('../../shared/attach.js');
  return todoAttach;
}

/**
 * 领取/查看时刻的附件标注：本机仓优先 → 云端镜像兜底 → 标注本地路径。
 *
 * @param {object|null} task 库存任务（normalizeTask 形状）
 * @param {object} [opts]
 * @param {boolean} [opts.sync=true] 是否允许为未命中的附件跑一次云端同步。
 *   预览（面板「预览 get 提示词」）传 false——**只读盘、不发网**：预览不该因为
 *   打开一次就悄悄下载一堆附件，也不该凭预览改变本机缓存状态。
 * @returns {Promise<null|{task:object, sync:object|null}>} null = 正文没有附件引用
 *   （调用方据此保持载荷原样）；sync 只在真的跑过云端同步时非 null。
 */
export async function annotateTaskDelivery(task, { sync: allowSync = true } = {}) {
  if (!task) return null;
  const { attachmentRefs } = await todoAttachMod();
  const refs = attachmentRefs(task.text);
  if (!refs.length) return null;

  // 本机附件仓：本地任务贴图的正文引用（零云端依赖，命中即绝对路径）
  const store = await localStoreIndex();
  const cfg = await loadConfig();
  const gid = await resolveGroupId();

  // 不在本机仓的 id 才考虑云端镜像；自动下载关（或全命中）就一次网都不碰
  const cloudIds = refs.filter((r) => !store.index.has(r.id)).map((r) => r.id);
  let sync = null;
  if (allowSync && cloudIds.length && cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」
    // （与 todo 读任务的同一套语义，见 todo/service.js annotateAttachments）。
    const names = {};
    for (const r of refs) if (cloudIds.includes(r.id) && r.alt) names[r.id] = r.alt;
    try {
      sync = await syncAttachments({ groupId: gid, ids: cloudIds, names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String(e && e.message ? e.message : e) }] };
    }
  }

  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const attachments = refs.map((r) => {
    const s = store.index.get(r.id);
    if (s) return { id: r.id, kind: r.kind, name: r.alt || s.name, localPath: s.path, synced: true, storage: 'local' };
    const m = mirror.index.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.alt || (m && m.name) || r.id,
      localPath: (m && m.path) || '',
      synced: !!m,
      storage: 'cloud',
    };
  });
  return { task: { ...task, attachments }, sync };
}

/**
 * 交付 instruction 里的〔附件〕段（纯函数）。没有附件 → ''（整段消失）。
 * 本机仓/镜像已有 → 直接给绝对路径；都没有 → 给图床 id 与拉取命令，agent 自己决定。
 */
export function attachmentInstruction(attachments, sync) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.length) return '';
  const lines = ['〔附件〕本任务正文引用了附件（嵌入即附件，正文随任务走）:', ...list.map(attachmentLine)];
  const syncText = attachmentSyncText(sync);
  if (syncText) lines.push(`  同步: ${syncText}`);
  return lines.join('\n');
}

// 单个附件的默认清单行（attachmentInstruction 与模板渲染共用同一份口径）。
function attachmentLine(a) {
  const kindLabel = a.kind === 'image' ? '图片' : '附件';
  return (
    `  - ${kindLabel} ${a.name}: ` +
    (a.localPath || `未同步到本地（图床 id ${a.id}；nx-kv file sync --ids ${a.id} 可拉到本地）`)
  );
}

// 同步详情串（内置默认附件段用；模板里请写 {{attach.sync.dir}} 等具体字段）。
// 没跑云端同步 → ''（模板里用 {{#if attach.sync}} 判断）。
function attachmentSyncText(sync) {
  if (!sync) return '';
  return (
    `目录 ${sync.dir || '—'} · 下载 ${sync.downloaded || 0} · 跳过 ${sync.skipped || 0}` +
    (sync.failures && sync.failures.length ? ` · 失败 ${sync.failures.length}` : '')
  );
}

/**
 * 附件模板 ctx（附件段与系统区块共用）。
 * 新语法：{{attach.count}}、`{{#each attach.list}}`（结构化元素）、
 * `{{#if attach.sync}}`（本次跑过云端同步才出现）。
 * 旧写法 `{{#attach}}` / `{{attach.sync}}` / `{{attach.syncText}}` 已废弃，不再提供别名。
 */
export function attachTemplateCtx(attachments, sync) {
  const list = Array.isArray(attachments) ? attachments : [];
  return {
    attach: {
      count: list.length,
      // 结构化数组：模板用循环组织清单，不再由服务端拼多行字符串。
      list: list.map((a) => ({
        id: a.id || '',
        kind: a.kind || '',
        kindLabel: a.kind === 'image' ? '图片' : '附件',
        isImage: a.kind === 'image',
        name: a.name || '',
        localPath: a.localPath || '',
        synced: !!a.synced,
        storage: a.storage || '',
      })),
      sync: sync
        ? {
            dir: sync.dir || '—',
            downloaded: sync.downloaded || 0,
            skipped: sync.skipped || 0,
            failureCount: (sync.failures || []).length,
            failures: sync.failures || [],
          }
        : null,
    },
  };
}

/**
 * 〔附件〕段渲染（任务 #82 模板化；v4 起走 Handlebars）：
 *   - 配置了模板（attachment 区块当前生效模板）→ 模板渲染。ctx：{{task.id}}/{{task.text}}、
 *     {{attach.count}}、`{{#each attach.list}}`（结构化清单）、
 *     `{{#if attach.sync}}`（同步详情）；
 *   - 旧占位符 / 旧闸门**不再兼容**（保存校验会拒绝旧语法，运行期回退内置默认）；
 *   - 空/未配置 → 内置默认（attachmentInstruction，历史输出逐字节不变）；
 *   - 渲染失败 → 回退内置默认（fail-open：附件路径必须到达 agent）。
 */
export function attachInstructionOf(tpl, attachments, sync, task) {
  const list = Array.isArray(attachments) ? attachments : [];
  const t = String(tpl || '').trim();
  if (!t || !list.length) return attachmentInstruction(list, sync);
  try {
    return renderInstruction(t, {
      task: task ? { id: task.id, text: String(task.text || '') } : null,
      ...attachTemplateCtx(list, sync),
    });
  } catch {
    return attachmentInstruction(list, sync);
  }
}

/**
 * 给任务追加附件（CLI `localtask attach`）：--path 落**本机附件仓**（本地任务
 * 的附件与云端零关联），或 --fileId 引用已有附件（本机仓 / 云端 id 都认）；
 * 以 markdown 嵌入**追加**到正文末尾（不替换正文）。
 * 面板编辑器贴的是同一条语法（components/md/attachments.js 的嵌入片段）。
 */
export async function attachToTask({ id, cwd, key, path, fileId, name, kind } = {}) {
  const cur = await service.getTask({ id, cwd, key }); // 存在性与参数校验都在队列本体

  let fid = fileId ? String(fileId).trim() : '';
  let displayName = String(name || '').trim();
  let resolvedKind = kind ? String(kind) : '';

  // --path：先落本机附件仓再嵌——「正文里的 id」与「本机文件」一次性对齐，全程不发网
  if (path) {
    const abs = resolvePath(String(path));
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e && e.code) || e.message}）`);
    }
    const fileName = displayName || basename(abs);
    const rec = await localUpload({ name: fileName, buffer, contentType: contentTypeOf(fileName) });
    fid = rec.fileId;
    displayName = rec.name;
    if (!resolvedKind) resolvedKind = isImageName(rec.name, rec.contentType) ? 'image' : 'file';
  }

  if (!fid) throw badInput('需要 --path <本机文件>（存本机附件仓）或 --fileId <已有附件 id>');
  const { looksLikeFileId, embedMarkdown } = await todoAttachMod();
  if (!looksLikeFileId(fid)) {
    throw badInput(`附件 id 不合法: ${fid}（应为 32 位 hex，可带扩展名）`);
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
 * 本机仓 → 云端镜像逐个标注（agent 据此决定直接读本地还是先 sync）。
 */
export async function listTaskAttachments({ id, cwd, key } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const cfg = await loadConfig();
  const gid = await resolveGroupId();
  const { attachmentRefs } = await todoAttachMod();
  const store = await localStoreIndex();
  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);

  const attachments = attachmentRefs(cur.text).map((r) => {
    const s = store.index.get(r.id);
    const m = s || mirror.index.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.alt || (m && m.name) || r.id,
      localPath: (m && m.path) || '',
      synced: !!m,
      size: (m && m.size) || 0,
      storage: s ? 'local' : 'cloud',
    };
  });
  return {
    task: { id: cur.id, key },
    localDir: store.dir,
    cloudDir: mirror.dir,
    autoSync: !!cfg.autoSyncAttachments,
    count: attachments.length,
    attachments,
  };
}
