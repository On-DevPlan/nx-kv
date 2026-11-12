// DocRef（绑定字段）与自有 rel / docId 的校验。
//
// 刻意**不依赖 repos/service.js**：service.js 的 loadStore 要用 sanitizeDocRef
// 做读时归一，而 docs/paths.js（需要 normalizeKey）又依赖 service——
// 校验逻辑单独成文件，依赖链保持单向（repos/service → docs/docref，是叶子）。
//
// DocRef 形状（二选一互斥）：
//   { rel }  自有树内相对路径 —— 树上真实文件，随 zip 导出
//   { path } 外部绝对路径（文件或**目录**，如 Obsidian vault）—— 只读引用，不进 zip
//
// 目录绑定（{ path } 指目录，或自有树里的一个目录）就是「介绍目录」：
// 目录里的文档构成该项目的**介绍文档集**（主篇 + 多篇补充说明 + reference/ 子目录），
// 彼此之间可以用 [[双链]] 互指。
import { assertSafeRelPath } from '../../core/paths.js';
import { badInput } from '../../core/errors.js';

/** DocRef：{ rel } 自有树相对路径 或 { path } 外部绝对路径（二选一，运行时保证互斥）。 */
export interface DocRef {
  rel?: string;
  path?: string;
  /** 链接级注解（note/tag，docLinks 条目用） */
  note?: string;
  tag?: string;
}

/** DocRef + 链接级注解（withLinkMeta 的产出形状）。 */
export type DocRefWithMeta = DocRef;

// ─── 自有 rel 守卫 ─────────────────────────────────────────────────────

/**
 * 自有 rel：assertSafeRelPath（拒绝对路径与 .. 段，返回归一化 POSIX）
 * + 必须是 .md 结尾，或 v7 的直接 ref id（`ref_<16hex>`，ref 是 DB 实体，
 *   没有文件路径——rel 只作内部唯一键，不做文件名）。
 * 返回归一化 rel，调用方应使用返回值。
 */
export function assertOwnedRel(rel: unknown, label = '文档路径'): string {
  const norm = assertSafeRelPath(rel, { label });
  if (/^ref_[0-9a-f]{16}$/i.test(norm)) return norm;
  if (!/\.md$/i.test(norm)) throw badInput(label + '必须是 .md 文件: ' + String(rel));
  return norm;
}

/**
 * 读路径用的 rel 校验：在自有 rel 的基础上，额外放行 v6 的壳行命名空间
 * `legacy/<id>` / `external/<hash>`——它们不是磁盘路径，也不以 .md 结尾，
 * 但必须能被 `docs get` 命中并返回 missing 语义（而不是抛「必须是 .md」）。
 * 写入口仍然用 assertOwnedRel，避免把壳行写成正常文档。
 */
export function assertDocRel(rel: unknown, label = '文档路径'): string {
  const norm = assertSafeRelPath(rel, { label });
  if (/^(legacy|external)\//.test(norm)) return norm;
  return assertOwnedRel(norm, label);
}

// ─── DocRef ────────────────────────────────────────────────────────────

/** 严格版：形状非法抛 badInput（bind 入口用） */
export function assertDocRef(raw: unknown): DocRef {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badInput('绑定必须是 { rel } 或 { path }');
  }
  const o = raw as { rel?: unknown; path?: unknown };
  const rel = typeof o.rel === 'string' ? o.rel.trim() : '';
  const path = typeof o.path === 'string' ? o.path.trim() : '';
  if (rel && path) throw badInput('rel 与 path 二选一，不要同时给');
  if (rel) return { rel: assertOwnedRel(rel) };
  if (path) return { path };
  throw badInput('绑定不能为空（--rel 给自有树路径，--path 给外部文件/目录）');
}

/** 宽松版：非法返回 null（loadStore 归一化用——盘上脏数据丢弃，不炸读取） */
export function sanitizeDocRef(raw: unknown): DocRef | null {
  try {
    return assertDocRef(raw);
  } catch {
    return null;
  }
}

/**
 * DocRef + 链接级注解（note/tag）合成列表条目。
 *
 * 为什么收在 DocRef 模块：docLinks 条目 = DocRef + 注解，而注解要过三道关
 * （写入口合并 / 读归一化回贴 / 导出保留），三处口径必须一致——
 * 实现只此一份，docs/refs 与 repos/service、transfer 都从这里拿。
 * 空串/缺省 = 不落字段（对已有条目即「清掉」）。
 */
export function withLinkMeta(ref: DocRef, raw: { note?: unknown; tag?: unknown } = {}): DocRefWithMeta {
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  const tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
  const entry: DocRefWithMeta = { ...ref };
  if (note) entry.note = note;
  if (tag) entry.tag = tag;
  return entry;
}

// ─── docId（前后端统一寻址）────────────────────────────────────────────
//
// 自有：rel:<相对路径>（裸相对路径视为自有——人类可以直接给路径）
// 外部：path:<绝对路径> ——服务端校验该路径在已登记绑定闭包内才放行，
//       否则 doc.get 就是任意文件读入口（HTTP 传输边界的关键）。

export type ParsedDocId = { kind: 'own'; rel: string } | { kind: 'external'; path: string };

export function ownDocId(rel: string): string {
  return 'rel:' + rel;
}

export function extDocId(abs: string): string {
  return 'path:' + abs;
}

export function parseDocId(docId: unknown): ParsedDocId {
  const s = String(docId || '').trim();
  if (!s) throw badInput('缺少文档标识（docId）');
  if (s.startsWith('path:')) {
    const p = s.slice(5).trim();
    if (!p) throw badInput('外部路径不能为空');
    return { kind: 'external', path: p };
  }
  const rel = s.startsWith('rel:') ? s.slice(4).trim() : s;
  return { kind: 'own', rel: assertDocRel(rel) };
}
