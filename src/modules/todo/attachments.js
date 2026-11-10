// ─── 附件：标注（读取时）与追加（写入时）────────────────────────────
//
// 任务正文可以直接嵌附件（图片 / docx 等），语法与解析在 src/shared/attach.js。
// 读任务时要多做两件事：
//   1. 把每个任务引用的附件解析出来（id / 类型 / 说明文字）；
//   2. 若本机设置开了「读取时自动下载」，就把这些附件同步到本地，
//      并把**本地绝对路径**一并回传 —— agent 因此可以只读本地文件，
//      不再受网络/出图地址影响。
//
// 同步失败**不阻断读取**：清单本身在 KV 里，跟附件能不能下载是两件事；
// 失败如实记进 sync.failures，读的人自己判断。
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import { loadConfig } from '../../core/config.js';
import { badInput } from '../../core/errors.js';
import { contentTypeOf, fileUpload, isImageName } from '../../core/fileapi.js';
import { localIndex, syncAttachments } from '../../core/attachstore.js';
import { attachmentRefs, embedMarkdown, looksLikeFileId } from '../../shared/attach.js';
import { KEY, loadAll, resolveGroup, writeTasks } from './store.js';
import { locateUnique } from './locate.js';

export async function annotateAttachments(tasks, groupId) {
  const refs = new Map();
  for (const t of tasks) {
    for (const r of attachmentRefs(t.text)) if (!refs.has(r.id)) refs.set(r.id, r);
  }
  const cfg = await loadConfig();

  let sync = null;
  if (refs.size && cfg.autoSyncAttachments) {
    // 说明文字 → 本地文件名：`![季度报表.docx](id)` 落盘就叫「季度报表.docx」，
    // 比一串 hex 有意义得多。
    const names = {};
    for (const [id, r] of refs) if (r.alt) names[id] = r.alt;
    try {
      sync = await syncAttachments({ groupId, ids: [...refs.keys()], names, dir: cfg.attachmentsDir });
    } catch (e) {
      sync = { dir: '', downloaded: 0, skipped: 0, failures: [{ id: '(整体)', error: String(e.message || e) }] };
    }
  }

  const { index } = await localIndex(groupId, cfg.attachmentsDir);
  const byTask = new Map();
  for (const t of tasks) {
    const list = attachmentRefs(t.text).map((r) => {
      const local = index.get(r.id);
      return {
        id: r.id,
        kind: r.kind,
        name: r.alt || local?.name || r.id,
        localPath: local?.path || '',
        synced: !!local,
      };
    });
    if (list.length) byTask.set(t, list);
  }
  return { byTask, sync };
}

export const attachOf = (byTask, arr) =>
  arr ? arr.map((t) => (byTask.has(t) ? { ...t, attachments: byTask.get(t) } : t)) : arr;

/** 单独查某个任务的附件清单（不依赖设置里的自动下载开关，但会标注本地是否已有）。 */
export async function listTaskAttachments(ref, { topic, pick, groupId } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });
  const gid = await resolveGroup(groupId);
  const cfg = await loadConfig();
  const { dir, index } = await localIndex(gid, cfg.attachmentsDir);

  const attachments = attachmentRefs(hit.task.text).map((r) => {
    const local = index.get(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.alt || local?.name || r.id,
      localPath: local?.path || '',
      synced: !!local,
      size: local?.size || 0,
    };
  });
  return {
    task: { topic: hit.task.topic, text: hit.task.text, bucket: hit.bucket },
    localDir: dir,
    autoSync: cfg.autoSyncAttachments,
    count: attachments.length,
    attachments,
  };
}

// ─── 追加附件 ──────────────────────────────────────────────────────
//
// 把附件**追加**到任务正文（不是替换）：正文里原有内容与已有的嵌入都保留，
// 新嵌入接在末尾。语义上等价于「在编辑器里点上传、然后手动把 markdown 贴到行尾」。
//
// ⚠️ 追加会改变该任务的**内容**，而定位是按内容（--ref）——所以调用方如果
// 还要继续操作同一条任务，必须用**新**的 text 去 --ref。这是本设计已知的取舍：
// 用「正文即真相」换掉了「附件单独一张表」，代价是正文会被附件语法污染。

/** 上传本机文件 / 复用已有 fileId，然后以 markdown 形式追加到任务正文。 */
export async function attachToTask(ref, { path, fileId, name, kind, topic, pick, groupId, accessLevel } = {}) {
  const all = await loadAll(groupId);
  const hit = locateUnique(all, ref, { topic, pick });

  let id = fileId ? String(fileId).trim() : '';
  let displayName = String(name || '').trim();
  let resolvedKind = kind ? String(kind) : '';

  // --path：先上传，拿到 id 再嵌 —— 这样「正文里的 id」与「图床里的文件」一次性对齐
  if (path) {
    const abs = resolvePath(String(path));
    let buffer;
    try {
      buffer = await readFile(abs);
    } catch (e) {
      throw badInput(`读不到文件: ${abs}（${e.code || e.message}）`);
    }
    const fileName = displayName || basename(abs);
    const meta = await fileUpload({
      name: fileName,
      buffer,
      contentType: contentTypeOf(fileName),
      groupId: await resolveGroup(groupId),
      accessLevel: accessLevel || 'public',
    });
    id = meta.fileId;
    displayName = fileName;
    if (!resolvedKind) resolvedKind = isImageName(fileName, meta.contentType) ? 'image' : 'file';
  }

  if (!id) throw badInput('需要 --path <本机文件>（先上传）或 --fileId <已上传的附件 id>');
  if (!looksLikeFileId(id)) {
    throw badInput(`附件 id 不合法: ${id}（应为后端返回的 32 位 hex，可能带扩展名）`);
  }
  if (resolvedKind && resolvedKind !== 'image' && resolvedKind !== 'file') {
    throw badInput(`--kind 只能是 image 或 file，收到: ${resolvedKind}`);
  }
  if (!resolvedKind) resolvedKind = isImageName(id, '') ? 'image' : 'file';

  const markdown = embedMarkdown({ name: displayName || id, id, kind: resolvedKind });
  const text = hit.task.text ? `${hit.task.text} ${markdown}` : markdown;

  const next = { ...hit.task, text };
  const bucket = [...all[hit.bucket]];
  bucket[hit.index] = next;
  await writeTasks(KEY[hit.bucket], bucket, groupId);

  return { task: next, bucket: hit.bucket, fileId: id, kind: resolvedKind, markdown };
}
