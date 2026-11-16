// 模板正文渲染（面板侧通用工具）：{{槽位名}} → 槽位值（没值就留空）。
//
// 从旧 placeholders.ts 收缩而来（v6，方案 §7）：占位符目录 / 段落标记 / 参数速查表
// 这些**手工副本**已删除——变量目录由 prompt.registry 的 fields 派生（声明是 UI
// 的唯一数据源），本文件只保留与字段目录无关的纯渲染函数。
/** 渲染模板正文：{{槽位名}} → 槽位值（没值就留空） */
export function renderTemplateBody(body: unknown, values?: Record<string, unknown> | null): string {
  const vals: Record<string, unknown> = values && typeof values === 'object' ? values : {};
  return String(body ?? '').replace(/\{\{\s*([^}{\s][^{}]*?)\s*\}\}/g, (all, name) => {
    const key = String(name).trim();
    const v = vals[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
