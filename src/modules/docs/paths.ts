// docs 域的地址权威：docId 前缀与 DocRef 校验。
//
// v8 起不再有「自有树相对路径」：ref 的地址就是 refs.id（`ref_<16hex>`），
// 外部文件/目录用 `path:<绝对路径>`（须在绑定闭包内）。
// 历史文档树路径只存在于 refs.locator（迁移/核对用），运行时不按路径找文档。
export {
  assertRefId,
  assertDocRef,
  sanitizeDocRef,
  ownDocId,
  extDocId,
} from './docref.js';
export type { DocRef, DocRefWithMeta } from './docref.js';

/** 外部目录里被视为「参考说明」的子目录名（读取时打 isReference 标记）。 */
export const DOC_REFERENCE_DIR = 'reference';
