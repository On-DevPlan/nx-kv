// 任务模板槽位/渲染的共享纯函数：宿主与插件包必须同一口径。
// 零依赖正则实现，不引入 Handlebars。

const SLOT_RE = /\{\{\s*([^}{\s][^{}]*?)\s*\}\}/g;

/** 模板正文里声明了哪些槽位（按首次出现顺序去重）。 */
export function templateSlots(body: unknown): string[] {
  const seen = new Set<string>();
  for (const m of String(body ?? '').matchAll(SLOT_RE)) {
    const key = String(m[1] ?? '').trim();
    if (key) seen.add(key);
  }
  return [...seen];
}

/** 渲染模板正文：{{槽位名}} → 槽位值（没值留空）。 */
export function renderTemplateBody(body: unknown, values?: Record<string, unknown> | null): string {
  const vals: Record<string, unknown> = values && typeof values === 'object' ? values : {};
  return String(body ?? '').replace(SLOT_RE, (_all, name) => {
    const key = String(name).trim();
    const v = vals[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
