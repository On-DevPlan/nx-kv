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
//   - 解析：附件语法只有一份实现（shared/attach.js——零依赖纯函数，
//     面板与 Node 共用），这里只消费不重写；
//   - 标注：交付载荷带 task.attachments（id/kind/name/localPath/synced/storage），
//     instruction 追加〔附件〕段告诉 agent 去哪读文件。
//
// fail-open 纪律与 todo 相同：附件能不能拿到跟任务能不能交付是两件事——
// 标注 / 同步的任何失败都不许拖垮 get/wait；正文没有引用时**载荷逐字节不变**。
//
// 拆分：资源视图模型（行 → 展示/取用信息）在 attach-resource.js；
// 〔附件〕段模板 ctx 与渲染在 attach-template.js（这里 re-export，import 路径不变）；
// 本文件只做编排——标注、挂载、清单、解除。
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { badInput } from '../../core/errors.js';
import { loadConfig, resolveGroupId } from '../../core/config.js';
import { contentTypeOf, isImageName } from '../../core/fileapi.js';
import { localIndex as cloudMirrorIndex, syncAttachments } from '../../core/attachstore.js';
import { localIndex as localStoreIndex, localUpload } from '../../core/localatt.js';
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { attachmentsRootFromEnv } from '../../core/paths.js';
import {
  deleteAttachment,
  ensureRefAttachment,
  ensureTaskAttachment,
  ensureUrlAttachment,
  linkAttachment,
  listTaskAttachmentsBySeq,
  resolveRefId,
  unlinkAttachment,
  upsertFileAttachment,
} from '../../core/attachmentdb.js';
import * as service from '../localtask/service.js';
import { fileStateOf, resourceOf, targetLookupsOf } from './attach-resource.js';

export { attachmentInstruction, attachInstructionOf, attachTemplateCtx } from './attach-template.js';

// 附件语法的唯一解析/生成实现（零依赖纯函数；todo 与面板共用同一份）。
// todo 在模块互依禁列里 → 动态 import（与 getloop/add 的 reposStore 同一惯例）。
let todoAttach = null;
async function todoAttachMod() {
  if (!todoAttach) todoAttach = await import('../../shared/attach.js');
  return todoAttach;
}

/** file 行逐个标注可达性：本机仓命中 → 本地绝对路径；否则看云端镜像。 */
function annotateFileRows(rows, lookups, store, mirror) {
  return rows.map((row) => {
    const a = resourceOf(row, lookups);
    if (a.kind !== 'file') return a;
    const s = store.index.get(row.id);
    if (s) return fileStateOf(a, { localPath: s.path, storage: 'local', name: a.name || s.name, size: s.size });
    const m = mirror.index.get(row.id);
    return fileStateOf(a, {
      localPath: (m && m.path) || '',
      storage: 'cloud',
      name: a.name || (m && m.name) || row.id,
      size: m && m.size,
    });
  });
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
export async function annotateTaskDelivery(task, { sync: allowSync = true, topicKey = '' } = {}) {
  if (!task) return null;
  // schema v2：资源关系在任务入库时就写好了，交付侧只读 task_attach，不再解析正文。
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: topicKey || task.key, seq: task.id });
  if (!rows.length) return null;

  // 本机附件仓：本地任务贴图的资源行（零云端依赖，命中即绝对路径）
  const store = await localStoreIndex();
  const cfg = await loadConfig();
  const gid = await resolveGroupId();

  // 不在本机仓的 file 行才考虑云端镜像；自动下载关（或全命中）就一次网都不碰
  const cloudIds = rows
    .filter((r) => r.kind === 'file' && !store.index.has(r.id))
    .map((r) => r.id);
  let sync = null;
  if (allowSync && cloudIds.length && cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」
    const names = {};
    for (const r of rows) if (cloudIds.includes(r.id) && r.name) names[r.id] = r.name;
    try {
      sync = await syncAttachments({ groupId: gid, ids: cloudIds, names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String(e && e.message ? e.message : e) }] };
    }
  }

  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const attachments = annotateFileRows(rows, targetLookupsOf(getDb(), rows), store, mirror);
  return { task: { ...task, attachments }, sync };
}

/**
 * 给任务挂附件（CLI `localtask attach`）。两种落法：
 *
 *   默认（嵌入正文）：资源写库 + 以 markdown 追加到正文末尾，关系 role=inline；
 *   `--no-embed`   ：只写 attachments + task_attach（role=attach），**不动正文**——
 *                    附件区（面板）与 `localtask attachments` 都能列出。
 *
 * 来源四选一：
 *   --path <本机文件>  落本机附件仓（零云端）
 *   --fileId <id>      引用已有资源（本机仓 / 云端 id 都认）
 *   --url <链接>       外部 URL（kind=url）
 *   --task <seq>       同主题下的另一条任务（kind=task，nxkv://task/<id>）
 *   --ref <路径|id>    文档库里的 ref（kind=ref，nxkv://ref/<refId>）
 */
export async function attachToTask({
  id, cwd, key, path, fileId, name, kind, url, task, ref, note, noEmbed,
} = {}) {
  const cur = await service.getTask({ id, cwd, key }); // 存在性与参数校验都在队列本体
  const topicKey = cur.key || key || '';
  const db = getDb();

  let fid = fileId ? String(fileId).trim() : '';
  let displayName = String(name || '').trim();
  let resolvedKind = kind ? String(kind) : '';
  let attachmentId = '';
  let markdown = '';

  const { looksLikeFileId, embedMarkdown } = await todoAttachMod();

  if (path) {
    // --path：先落本机附件仓再登记——「正文里的 id」与「本机文件」一次性对齐，全程不发网
    const abs = resolvePath(String(path));
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${(e && e.code) || e.message}）`);
    }
    const fileName = displayName || basename(abs);
    const rec = await localUpload({
      name: fileName,
      buffer,
      contentType: contentTypeOf(fileName),
    });
    fid = rec.fileId;
    displayName = rec.name;
    if (!resolvedKind) resolvedKind = isImageName(rec.name, rec.contentType) ? 'image' : 'file';
    tx(
      (conn) =>
        upsertFileAttachment(conn, {
          id: fid,
          name: rec.name,
          localPath: rec.path,
          mime: rec.contentType,
          size: rec.size,
          storage: 'local',
          meta: { isImage: resolvedKind === 'image', source: 'cli' },
        }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = fid;
    if (!noEmbed) {
      markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind });
    }
  } else if (fid) {
    if (!looksLikeFileId(fid)) {
      throw badInput(`附件 id 不合法: ${fid}（应为 32 位 hex，可带扩展名）`);
    }
    if (resolvedKind && resolvedKind !== 'image' && resolvedKind !== 'file') {
      throw badInput(`--kind 只能是 image 或 file，收到: ${resolvedKind}`);
    }
    if (!resolvedKind) resolvedKind = isImageName(fid, '') ? 'image' : 'file';
    tx(
      (conn) =>
        upsertFileAttachment(conn, {
          id: fid,
          name: displayName || fid,
          meta: { isImage: resolvedKind === 'image' },
        }),
      { db, mode: 'IMMEDIATE' }
    );
    attachmentId = fid;
    markdown = embedMarkdown({ name: displayName || fid, id: fid, kind: resolvedKind });
  } else if (url) {
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) throw badInput(`--url 需要 http(s) 绝对地址: ${u}`);
    attachmentId = tx(
      (conn) => ensureUrlAttachment(conn, { url: u, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
    if (!attachmentId) throw badInput(`URL 登记失败: ${u}`);
    resolvedKind = 'url';
    markdown = `[${displayName || u}](${u})`;
  } else if (task !== undefined && task !== null && String(task).trim() !== '') {
    const seq = Number(String(task).replace(/^#/, ''));
    if (!Number.isFinite(seq)) throw badInput(`--task 需要任务编号（同主题 seq）: ${task}`);
    const row = db.get(
      `SELECT t.id, t.seq FROM tasks t JOIN topics k ON k.id = t.topic_id
        WHERE k.key = :key AND t.seq = :seq AND t.deleted_at IS NULL`,
      { key: topicKey, seq }
    );
    if (!row) throw badInput(`主题「${topicKey}」里没有任务 #${seq}`);
    attachmentId = tx(
      (conn) => ensureTaskAttachment(conn, { taskId: Number(row.id), name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
    resolvedKind = 'task';
    markdown = `[${displayName || `任务 #${seq}`}](nxkv://task/${Number(row.id)})`;
  } else if (ref) {
    const refId = resolveRefId(db, ref);
    if (!refId) throw badInput(`找不到文档: ${ref}（可先用 docs list 看已有路径）`);
    attachmentId = tx(
      (conn) => ensureRefAttachment(conn, { refId, name: displayName }),
      { db, mode: 'IMMEDIATE' }
    );
    resolvedKind = 'ref';
    markdown = `[${displayName || String(ref).split('/').pop()}](nxkv://ref/${refId})`;
  }

  if (!attachmentId) {
    throw badInput(
      '需要 --path <本机文件>、--fileId <已有附件>、--url <链接>、--task <编号> 或 --ref <文档> 之一'
    );
  }

  // 关系表是权威：先落边（正文同步不会把 attach 降级），正文只是 inline 的呈现。
  // --no-embed 不写正文，也就不该把嵌入片段还给调用方（否则 CLI 会打出误导性的「嵌入:」）。
  if (noEmbed) markdown = '';
  const role = noEmbed ? 'attach' : 'inline';
  if (noEmbed) {
    tx(
      (conn) => {
        const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
        if (!gid) throw badInput(`任务 #${cur.id} 已不存在，无法挂附件`);
        linkAttachment(conn, { host: 'task', hostId: gid, attachmentId, role: 'attach', note });
      },
      { db, mode: 'IMMEDIATE' }
    );
  }

  let r = { key: cur.key, name: topicNameOf(cur), task: cur };
  if (!noEmbed && markdown) {
    // 独立成行追加（与编辑器的插入行为一致：整行图片嵌入渲染为 <img>）
    const text = cur.text ? `${cur.text}\n${markdown}` : markdown;
    r = await service.updateTask({ id: cur.id, cwd, key, text });
  }

  return {
    status: 'ok',
    key: r.key,
    name: r.name,
    fileId: attachmentId,
    kind: resolvedKind,
    markdown,
    area: noEmbed ? 'area' : 'inline',
    role,
    task: r.task,
  };
}

// 任务对象在 service 层有 name/key 等；拿不到时给空串，渲染层会退化成 id。
function topicNameOf(t) {
  return String((t && (t.name || t.topicName)) || '');
}

/** 关系表挂的是全局 tasks.id，而 CLI 只有 (topicKey, seq)——统一在这里换算。 */
function taskGlobalIdOf(conn, { topicKey, seq }) {
  const row = conn.get(
    `SELECT t.id FROM tasks t JOIN topics k ON k.id = t.topic_id
      WHERE k.key = :key AND t.seq = :seq AND t.deleted_at IS NULL`,
    { key: String(topicKey || ''), seq: Number(seq) }
  );
  return row ? Number(row.id) : 0;
}

/**
 * 列出某条任务引用的附件（CLI `localtask attachments`）：不依赖自动下载开关，
 * 本机仓 → 云端镜像逐个标注（agent 据此决定直接读本地还是先 sync）。
 */
export async function listTaskAttachments({ id, cwd, key } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const cfg = await loadConfig();
  const gid = await resolveGroupId();
  const store = await localStoreIndex();
  const mirror = await cloudMirrorIndex(gid, cfg.attachmentsDir);
  const rows = listTaskAttachmentsBySeq(getDb(), { topicKey: cur.key || key, seq: cur.id });
  const attachments = annotateFileRows(rows, targetLookupsOf(getDb(), rows), store, mirror);

  return {
    task: { id: cur.id, key: cur.key || key },
    localDir: store.dir,
    cloudDir: mirror.dir,
    autoSync: !!cfg.autoSyncAttachments,
    count: attachments.length,
    inlineCount: attachments.filter((a) => a.origin !== 'area').length,
    areaCount: attachments.filter((a) => a.origin === 'area').length,
    attachments,
  };
}

/**
 * 解除任务与一条资源的关系（CLI `localtask detach`）。
 *
 *   --only-unlink（默认）：只删 task_attach 边，资源与字节保留（可能进孤儿池）；
 *   --purge            ：先解除关系，再在「没有任何任务/文档还在用」时删资源行与字节。
 *
 * 关系表是权威：解除后这条资源不再出现在任务附件清单里，但正文里若仍有内嵌，
 * 下次正文同步会把 inline 边重新写回来（这是正文明示的引用，不算丢）。
 */
export async function detachTaskAttachment({ id, cwd, key, attachment, purge } = {}) {
  const cur = await service.getTask({ id, cwd, key });
  const topicKey = cur.key || key || '';
  const attId = String(attachment || '').trim();
  if (!attId) throw badInput('需要 --attachment <资源 id>（见 localtask attachments 输出）');
  const db = getDb();
  const cfg = await loadConfig();
  const store = await localStoreIndex();
  let deleted = 0;
  let purgeResult = null;
  tx(
    (conn) => {
      const gid = taskGlobalIdOf(conn, { topicKey, seq: cur.id });
      if (!gid) throw badInput(`任务 #${cur.id} 已不存在`);
      deleted = unlinkAttachment(conn, { host: 'task', hostId: gid, attachmentId: attId });
      if (purge && deleted) {
        purgeResult = deleteAttachment(conn, attId, {
          attachmentsRoot: attachmentsRootFromEnv() || cfg.attachmentsDir || store.dir,
        });
      }
    },
    { db, mode: 'IMMEDIATE' }
  );
  return {
    status: 'ok',
    key: cur.key || key,
    name: topicNameOf(cur),
    task: { id: cur.id },
    attachment: attId,
    unlinked: deleted,
    purged: !!(purgeResult && purgeResult.removed),
    purgeReason: purgeResult ? purgeResult.reason || '' : '',
    bytesRemoved: !!(purgeResult && purgeResult.bytesRemoved),
  };
}
