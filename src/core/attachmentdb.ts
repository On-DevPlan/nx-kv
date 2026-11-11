// 统一资源表 attachments 的唯一读写实现（schema v2）。
//
// 这里只做「资源是什么 / 归谁所有」两件事，不做业务编排：
//   · resources：file（本机或云端字节）、url（外部链接）、task（topic 内任务）、ref（文档）；
//   · relations：task_attach / ref_attach 的整组重写与孤儿查询；
//   · 正文解析：`![名](fileId)` / `[名](fileId)`、`nxkv://task/<id>`、`nxkv://ref/<id>`、
//     `[名](http(s)://…)` 都落库。用户可见的 markdown 写法不变。
//
// 为什么放在 core：localatt/attachstore（字节存储）与 docs/localtask 仓储（关系）
// 都要用它，放模块层会造成「核心存储依赖业务模块」的倒挂。
//
// 实现按职责拆在 attachmentdb/ 子目录：ids（id 公式与正文解析纯函数）→
// resources（资源行 upsert）→ relations（关系边写入与正文整组重写）→
// docs（refs 行与整库重扫）→ query（查询与生命周期）。
// 本文件只是对外入口：公共 API 全部 re-export，import 路径不变。
export {
  isFileId,
  parseAttachmentRefs,
  refAttachmentId,
  refIdFor,
  taskAttachmentId,
  urlAttachmentId,
} from './attachmentdb/ids.js';
export {
  ensureAttachment,
  ensureRefAttachment,
  ensureTaskAttachment,
  ensureUrlAttachment,
  upsertFileAttachment,
} from './attachmentdb/resources.js';
export {
  linkAttachment,
  syncRefAttachments,
  syncTaskAttachments,
  unlinkAttachment,
  updateAttachmentNote,
} from './attachmentdb/relations.js';
export {
  ensureDocRef,
  forgetDocRef,
  resolveRefId,
  syncDocAttachmentIndex,
  syncTaskAttachmentIndex,
} from './attachmentdb/docs.js';
export {
  archiveAttachmentManifests,
  deleteAttachment,
  getAttachment,
  listOrphans,
  listRefAttachments,
  listTaskAttachments,
  listTaskAttachmentsBySeq,
  pruneOrphans,
} from './attachmentdb/query.js';
