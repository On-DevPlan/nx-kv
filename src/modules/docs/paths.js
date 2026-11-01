// docs 自有树的路径权威：根目录、段级 slug、约定路径。
// （DocRef / docId 校验在 docref.js——那里刻意不依赖 repos/service，见其文件头。）
//
// 目录树承载语义（键位约定，导出 zip 原样带走）：
//   repo/<key 按 / 分段>.md           项目介绍   repo/github.com/me/x.md
//   board/<组 slug>.md                组介绍     board/nx系列.md
//   group/<组 slug>/<key 分段>.md      组内描述   group/nx系列/github.com/me/x.md
//   其余任意 .md                      自由文档（同样可索引/双链/绑定）
//
// key 全局唯一（repos 模块保证）→ 约定路径不可能互相撞，不需要指纹后缀。
// 段级 slug 只兜 Windows 的两个坑：段尾点（资源管理器拒绝创建）与保留设备名。
import { join } from 'node:path';
import { APP_DIR } from '../../core/paths.js';
import { normalizeKey, localKeyOf } from '../../core/keys.js';

// 允许测试与多实例覆盖文档树根：与 NX_KV_REPOS_STORE 同一模式
export function docsRoot() {
  return process.env.NX_KV_DOCS_DIR || join(APP_DIR, 'docs');
}

// Windows 保留设备名（不分大小写）：命中即追加下划线
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// 单段的 Windows 兜底：压尾点（尾点段无法创建）、保留名加 _、空段给占位名
function fixWinSeg(seg) {
  const s = String(seg || '').replace(/\.+$/g, '');
  if (!s) return 'x';
  return RESERVED.has(s.toLowerCase()) ? s + '_' : s;
}

/** key/name 的一个分段 → 安全目录段（normalizeKey 已小写、已压非法字符） */
export function docSeg(s) {
  return fixWinSeg(normalizeKey(s));
}

/** 组名的 slug（与 boardKeyOf 的派生同一套：localKeyOf，`/` 已压成 -） */
export function boardSeg(boardName) {
  return fixWinSeg(localKeyOf(boardName).slice('local/'.length));
}

// ─── 约定路径（POSIX 相对路径，正斜杠）────────────────────────────────

export function repoDocRel(repoKey) {
  return 'repo/' + String(repoKey || '').split('/').map(docSeg).join('/') + '.md';
}

export function boardDocRel(boardName) {
  return 'board/' + boardSeg(boardName) + '.md';
}

export function groupNoteRel(boardName, repoKey) {
  return (
    'group/' + boardSeg(boardName) + '/' +
    String(repoKey || '').split('/').map(docSeg).join('/') + '.md'
  );
}

// DocRef / docId 校验（docref.js）：这里转发导出，调用方统一从 paths 拿
export { assertOwnedRel, assertDocRef, sanitizeDocRef, parseDocId, ownDocId, extDocId } from './docref.js';
