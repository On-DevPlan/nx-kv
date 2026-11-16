// 任务模板的**预览**渲染（面板侧，纯函数）：与真正生成任务用的
// renderTemplateBody 只差「没值的槽位怎么显示」——
//   生成任务：没值 → 留空（任务正文里不能出现裸 {{槽位}}）
//   预览：    没值 → 可见占位 〔槽位名〕，用户才知道哪里要填
//
// 两套语义分开，是因为它们的消费者不同：前者进交付正文，后者进设置页的预览框。
// 预览**不写任何存储**、不改变真相——模板正文（templates.json / sqlite）仍是唯一真源。
import { parseFrontmatter, withFrontmatter } from '../../../../shared/frontmatter.js';
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
 * 从任务正文的 frontmatter 读「这条任务由哪个模板生成」（键 `template`）。
 *
 * 没有该键 = 不是模板生成的任务（用户直接写的），编辑器不加任何只读区。
 * 为什么要落进 frontmatter：编辑器的只读判定需要**模板身份**才能拿到骨架正文；
 * 模板 id 存在正文头里，刷新 / 换设备 / CLI 侧编辑后都还在，不依赖前端内存。
 */
export function templateIdOf(body: unknown): string {
  const fm = parseFrontmatter(body);
  return String(fm.template || '').trim();
}

/**
 * 由模板生成的**任务正文**：槽位按「没值留空」渲染，并把模板身份写进 frontmatter。
 *
 * 这是「模板 → 任务」的唯一入口（新建任务 / 新建草稿 / 组页新建都走它）：
 * 身份只在这一步写入，之后正文怎么改都还带着它——编辑器据此把骨架块标成只读。
 * 模板 id 为空（没有可用模板）→ 原样返回，不凭空造 frontmatter。
 */
export function templateDraftBody(
  tpl: {
    id?: string;
    body?: unknown;
    values?: Record<string, unknown> | null;
  },
  /** 同时要写的其它归属字段（board / project…）——一次成型，避免二次 withFrontmatter 把 template 冲掉 */
  extra: Record<string, unknown> = {},
): string {
  const body = renderTemplateBody(tpl.body, tpl.values);
  const id = String(tpl.id || '').trim();
  const fields: Record<string, unknown> = { ...extra };
  if (id) fields.template = id;
  return Object.keys(fields).length ? withFrontmatter(body, fields) : body;
}
