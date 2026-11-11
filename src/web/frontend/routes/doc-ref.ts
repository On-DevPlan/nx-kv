// 文档 docId（`rel:…` / `path:…`）与地址段的互转。两条硬约束：
//   ① docId 带前缀冒号，整串编码会把 `:` 变成 %3A、与 panelSpecOfRoute 回填的
//      config 对不上 → 裂面板。**冒号后的路径段才编码**，前缀原样保留。
//   ② 返回值是"已编码"的查询串片段——交给 URLSearchParams 会**二次编码**
//      （`/` → `%2F` → `%252F`）。所以两个方向都在本函数内完成
//      encode/decodeURIComponent，调用方只做字符串拼接，绕开 URLSearchParams。
export function encodeDocRef(docId: unknown): string {
  const s = String(docId || '');
  const i = s.indexOf(':');
  if (i < 0) return encodeURIComponent(s);
  return s.slice(0, i) + ':' + encodeURIComponent(s.slice(i + 1));
}

export function decodeDocRef(v: unknown): string {
  const s = String(v || '');
  const i = s.indexOf(':');
  if (i < 0) {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  }
  try {
    return s.slice(0, i) + ':' + decodeURIComponent(s.slice(i + 1));
  } catch {
    return s;
  }
}

/** 面板默认标题：docId 去掉前缀、取路径末段、去掉 `.md` */
export function docLabelOf(docId: unknown): string {
  const s = String(docId || '').replace(/^(rel|path):/, '');
  const seg = s.split(/[\\/]/).filter(Boolean).pop() || '';
  return seg.replace(/\.md$/i, '') || '文档';
}
