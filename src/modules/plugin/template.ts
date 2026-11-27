// 宿主侧的模板槽位渲染（与 packages/plugin-sdk/src/template.ts 同口径）。
//
// 为什么宿主不 import SDK：内置插件发布后不安装 @nx-kv/plugin-sdk（插件 server 已
// 打成单文件），宿主的运行时不依赖任何 @nx-kv/* 包；这两份实现由
// tests/unit/pretask-template-shared.test.mjs 钉住输入输出一致。
const SLOT_RE = /\{\{\s*([^}{\s][^{}]*?)\s*\}\}/g;

/** 渲染模板正文：{{槽位名}} → 槽位值（没值留空）。 */
export function renderTemplateBody(body: unknown, values?: Record<string, unknown> | null): string {
  const vals: Record<string, unknown> = values && typeof values === 'object' ? values : {};
  return String(body ?? '').replace(SLOT_RE, (_all, name) => {
    const key = String(name).trim();
    const v = vals[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
