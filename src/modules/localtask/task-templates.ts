// （#54 自 service.js 拆出）ack 总结提示词与交付模板的字段钳制：
// settings.ackPrompt 的存储形态、条数/长度上限与缺省值，以及交付模板的钳制都在这里。
// 完成后的汇报要求与收尾要求统一落在 ack 区块（DEFAULT_ACK_PROMPT，设置页可见可改）；
// 旧 rule 区块已删除，其内容迁移时并入 ack。

/**
 * 默认 ack：完成任务就调用 localtask done 回填结果（任务 51 的职责合并决定）。
 * #152 起模板正文的唯一真相是插件类——ack 段的正文在
 * modules/promptplug/plugins/ack.ts 的 BUILTIN；这里保留一份同文常量
 * 只为兼容旧引用（设置视图的「多条」形态回显）。改文案请改插件类。
 */
export const DEFAULT_ACK_PROMPT =
  '完成之后必须调用 nx-kv localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。';

import {
  DEFAULT_APPEND_MODE,
  APPEND_MODES,
} from '../../shared/prompt-blocks.js';

/** 交付上下文模板（任务 #62）的长度上限——防把整本书塞进设置。 */
export const MAX_DELIVERY_TEMPLATE_LEN = 8000;

/** 交付上下文模板：空串 = 用内置默认模板（不关掉这一段）。 */
export function clampDeliveryTemplate(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.slice(0, MAX_DELIVERY_TEMPLATE_LEN);
}

// ─── 附件段提示词（settings.attachTemplate，任务 #82）──────────────────
//
// 交付里的〔附件〕段（附件清单 + 本地路径 + 拉取 SOP）原先硬编码在
// tasktool/attach.js 的 attachmentInstruction。模板化后：
//   - 空串 = 用内置默认（**不是关掉**——附件段带本地路径，关掉 agent 就找不到文件）；
//   - 新语法：{{task.id}} {{task.text}} {{attach.count}}、
//     `{{#each attach.list}}`（按 kind 分支的结构化清单 + 各类型子对象）；
//   - 旧占位符 / 旧闸门（{{attach.list}} / {{attach.sync}} / {{attach.syncSummary}} / 旧 attachSync 区块）已废弃；
//     渲染失败回退内置默认。
export const MAX_ATTACH_TEMPLATE_LEN = 4000;

export function clampAttachTemplate(v: unknown): string {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.slice(0, MAX_ATTACH_TEMPLATE_LEN);
}

/** ack 单条长度 / 条数上限（与设置页 MAX_PROMPT_ITEMS 对齐）。 */
const MAX_ACK_LEN = 2000;
const MAX_ACK_ENTRIES = 10;

export function clampAckPromptList(v: unknown): string[] {
  if (v === undefined || v === null) return [DEFAULT_ACK_PROMPT];
  const raw: unknown[] = Array.isArray(v) ? v : [v];
  const list: string[] = [];
  for (const item of raw) {
    let s = String(item ?? '').trim();
    if (!s) continue;
    if (s.length > MAX_ACK_LEN) s = s.slice(0, MAX_ACK_LEN);
    list.push(s);
    if (list.length >= MAX_ACK_ENTRIES) break;
  }
  return list;
}

export function joinAckPrompt(v: unknown): string {
  return clampAckPromptList(v).join('\n\n');
}

// ─── 系统上下文追加模式 + XML 区块配置（settings 两键）───────────────
//
// appendMode：'xml'（默认，每段包独立标签）| 'plain'（改造前按空行直拼）。
// 每个区块的模板正文在插件类里（modules/promptplug/plugins/*.ts），不再有落库模型。
export const APPEND_MODE_IDS = Object.freeze(APPEND_MODES.map((m) => m.id));

/** 归一化追加模式：缺省/非法 → xml（默认足够清晰）。 */
export function clampAppendMode(v: unknown): string {
  const s = String(v ?? '').trim();
  return APPEND_MODE_IDS.includes(s) ? s : DEFAULT_APPEND_MODE;
}
