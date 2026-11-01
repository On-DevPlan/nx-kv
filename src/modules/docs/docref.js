// DocRef（绑定字段）与自有 rel / docId 的校验。
//
// 刻意**不依赖 repos/service.js**：service.js 的 loadStore 要用 sanitizeDocRef
// 做读时归一，而 docs/paths.js（需要 normalizeKey）又依赖 service——
// 校验逻辑单独成文件，依赖链保持单向（repos/service → docs/docref，是叶子）。
//
// DocRef 形状（二选一互斥）：
//   { rel }  自有树内相对路径 —— 树上真实文件，随 zip 导出
//   { path } 外部绝对路径（文件或目录，如 Obsidian vault）—— 只读引用，不进 zip
import { assertSafeRelPath } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';

// ─── 自有 rel 守卫 ─────────────────────────────────────────────────────

/**
 * 自有树内相对路径：assertSafeRelPath（拒绝对路径与 .. 段，返回归一化 POSIX）
 * + 必须以 .md 结尾。返回归一化 rel，调用方应使用返回值。
 */
export function assertOwnedRel(rel, label = '文档路径') {
  const norm = assertSafeRelPath(rel, { label });
  if (!/\.md$/i.test(norm)) throw badInput(label + '必须是 .md 文件: ' + rel);
  return norm;
}

// ─── DocRef ────────────────────────────────────────────────────────────

/** 严格版：形状非法抛 badInput（bind 入口用） */
export function assertDocRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badInput('绑定必须是 { rel } 或 { path }');
  }
  const rel = typeof raw.rel === 'string' ? raw.rel.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (rel && path) throw badInput('rel 与 path 二选一，不要同时给');
  if (rel) return { rel: assertOwnedRel(rel) };
  if (path) return { path };
  throw badInput('绑定不能为空（--rel 给自有树路径，--path 给外部文件/目录）');
}

/** 宽松版：非法返回 null（loadStore 归一化用——盘上脏数据丢弃，不炸读取） */
export function sanitizeDocRef(raw) {
  try {
    return assertDocRef(raw);
  } catch {
    return null;
  }
}

// ─── docId（前后端统一寻址）────────────────────────────────────────────
//
// 自有：rel:<相对路径>（裸相对路径视为自有——人类可以直接给路径）
// 外部：path:<绝对路径> ——服务端校验该路径在已登记绑定闭包内才放行，
//       否则 doc.get 就是任意文件读入口（HTTP 传输边界的关键）。

export function ownDocId(rel) {
  return 'rel:' + rel;
}

export function extDocId(abs) {
  return 'path:' + abs;
}

export function parseDocId(docId) {
  const s = String(docId || '').trim();
  if (!s) throw badInput('缺少文档标识（docId）');
  if (s.startsWith('path:')) {
    const p = s.slice(5).trim();
    if (!p) throw badInput('外部路径不能为空');
    return { kind: 'external', path: p };
  }
  const rel = s.startsWith('rel:') ? s.slice(4).trim() : s;
  return { kind: 'own', rel: assertOwnedRel(rel) };
}
