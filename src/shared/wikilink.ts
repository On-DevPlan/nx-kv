// 双链 [[目标|显示文本]] 的纯函数：解析与目标归一。
//
// 前后端共用同一份实现——md-parse（前端）负责把 [[..]] 渲染成 <a>，
// docs/links（后端）负责把目标解析成具体文档。放在 shared/（同构纯函数层），
// 两端就不可能各写一版慢慢漂移：前端够不着 modules/，后端够不着 web/，
// 唯一能同时被两边 import 的只有这里。
//
// 目标写法（与 Obsidian 习惯对齐）：
//   [[nx-kv]]                    按文件名（去 .md、不分大小写）
//   [[group/nx系列/github.com/me/x]]   按自有树内相对路径
//   [[显示文本|真目标]]           反着写不认——目标在前，| 后面只是显示文本

export const WIKI_LINK_RE = /\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g;

/** 双链索引进项：docs/index 产出的条目形状（name 已归一）。 */
export interface WikiIndexEntry {
  docId: string;
  name: string;
  rel?: string;
  path?: string;
}

/** 双链解析结果：唯一命中 / 多命中候选 / 未命中。 */
export type WikiResolveResult = { docId: string } | { candidates: string[] } | null;

/** 解析出全部双链引用：[{ target, label }]（label = 渲染文本，缺省同 target） */
export function parseWikiLinks(src: unknown): { target: string; label: string }[] {
  const out: { target: string; label: string }[] = [];
  const s = String(src || '');
  WIKI_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(s))) {
    const target = (m[1] ?? '').trim();
    if (target) out.push({ target, label: (m[2] || m[1] || '').trim() });
  }
  return out;
}

// 目标归一：剥 .md 尾、压空白、小写——文件名与路径的比较统一走这里。
// 小写是有意的：Windows 文件系统不分大小写，key 也一律小写，比较口径必须一致。
export function normalizeWikiTarget(t: unknown): string {
  return String(t || '')
    .trim()
    .replace(/\.md$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * 解析一个双链目标。
 *   index: [{ docId, name, rel?, path? }]（name = normalizeWikiTarget 后的文件名）
 *
 * 解析顺序（与产品语义对齐：先认地址，再认名字，猜是最后手段且不猜）：
 *   ① rel/path 精确命中（[[repo/github.com/me/x]] 这种完整写法）
 *   ② 文件名唯一命中
 *   ③ 多命中 → 返回候选列表，调用方列出来让用户选（不猜）
 * 返回 { docId } | { candidates: [docId, ...] } | null（未命中 = 未解析）
 */
export function resolveWikiLink(target: unknown, index: readonly WikiIndexEntry[] | unknown): WikiResolveResult {
  const list: WikiIndexEntry[] = Array.isArray(index) ? (index as WikiIndexEntry[]) : [];
  if (!list.length) return null;
  const norm = normalizeWikiTarget(target);
  if (!norm) return null;
  const normSlash = norm.replace(/\\/g, '/');
  const byAddr = list.find(
    (d) =>
      (d.rel && normalizeWikiTarget(d.rel) === normSlash) ||
      (d.path && String(d.path).replace(/\\/g, '/').toLowerCase() === normSlash)
  );
  if (byAddr) return { docId: byAddr.docId };
  const lastName = normSlash.split('/').pop() ?? '';
  const byName = list.filter((d) => d.name === lastName);
  const first = byName[0];
  if (byName.length === 1 && first) return { docId: first.docId };
  if (byName.length > 1) return { candidates: byName.map((d) => d.docId) };
  return null;
}
