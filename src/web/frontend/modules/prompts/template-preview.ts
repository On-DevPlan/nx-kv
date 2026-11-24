// 任务模板的**预览**渲染（面板侧，纯函数）：与真正生成任务用的
// renderTemplateBody 只差「没值的槽位怎么显示」——
//   生成任务：没值 → 留空（任务正文里不能出现裸 {{槽位}}）
//   预览：    没值 → 可见占位 〔槽位名〕，用户才知道哪里要填
//
// 两套语义分开，是因为它们的消费者不同：前者进交付正文，后者进设置页的预览框。
// 预览**不写任何存储**、不改变真相——模板正文（templates.json / sqlite）仍是唯一真源。

import { renderTemplateBody } from './render-template-body.js';

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

/** 预览渲染：{{槽位}} → 槽位值；没有值的槽位显示加粗占位〔槽位名〕。 */
export function renderTemplatePreview(
  body: unknown,
  values?: Record<string, unknown> | null,
): string {
  const vals: Record<string, unknown> = values && typeof values === 'object' ? values : {};
  return String(body ?? '').replace(SLOT_RE, (_all, name) => {
    const key = String(name ?? '').trim();
    const v = vals[key];
    const filled = v !== undefined && v !== null && String(v).trim() !== '';
    return filled ? String(v) : `**〔${key}〕**`;
  });
}

/**
 * 由模板生成的**任务正文**（#151）：槽位按「没值留空」渲染成**纯文本**，
 * 不再把模板身份写进 frontmatter —— 槽位概念的生命周期只到「任务内容生成前」，
 * 下落到文本层（编辑器里的「模板/插槽」只读块）已被移除。
 *
 * 这是「模板 → 任务」的唯一入口（新建任务 / 参数页填写后 / 组页新建都走它）：
 * extra 是归属字段（board / project…），不传就是纯正文。
 *
 * 参数页填好的值可经 valuesOverride 传入（覆盖模板自带默认值）。
 */
export function templateDraftBody(
  tpl: {
    id?: string;
    body?: unknown;
    values?: Record<string, unknown> | null;
  },
  /** @deprecated #197：归属已改成草稿的结构化字段，不再写进正文头；保留参数只为调用点不漂 */
  _extra: Record<string, unknown> = {},
  /** 参数页填写后的槽位值（覆盖 tpl.values）；不传用模板默认值 */
  valuesOverride?: Record<string, unknown> | null,
): string {
  const values = valuesOverride !== undefined ? valuesOverride : tpl.values;
  // #197：只渲染正文——归属由 DocRecord 的 boardKey / projectKey 承载
  return renderTemplateBody(tpl.body, values);
}
