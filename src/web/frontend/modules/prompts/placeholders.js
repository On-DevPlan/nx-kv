// 占位符目录（面板侧）——语法与 core/instruction-template.js 同源：
//   {{goal.name}} {{task.id}} …  单个占位符
//   {{#goal}}…{{/goal}}          段落（上下文缺失整段消失）
//
// 面板只负责「列出来 + 插进文本框」，**渲染在服务端**（core 层）——
// 两端共用一套标记，避免「面板能填、服务端不认」。
//
// 哪些占位符可用，取决于提示词用在哪：
//   收尾指令 / ack 提示词  → 任务、时间目标、本次上下文
//   持续 get 模板          → 任务、本次上下文（没有 goal）
export const PLACEHOLDER_GROUPS = [
  {
    label: '任务',
    items: [
      { token: 'task.id', desc: '任务号' },
      { token: 'task.text', desc: '任务正文' },
      { token: 'task.title', desc: '任务标题' },
    ],
  },
  {
    label: '时间目标',
    items: [
      { token: 'goal.name', desc: '目标名' },
      { token: 'goal.deadline', desc: '截止时间' },
      { token: 'goal.remainingHuman', desc: '剩余时长（人话）' },
      { token: 'goal.prompt', desc: '目标的附加要求' },
    ],
  },
  {
    label: '本次上下文',
    items: [
      { token: 'source', desc: '来源（local/global）' },
      { token: 'summary', desc: '本轮现状' },
      { token: 'cwd', desc: '工作目录' },
      { token: 'name', desc: '主题名' },
    ],
  },
];

// 段落标记：整块插入（正文自带 … 占位）
export const SECTION_TOKENS = [
  { label: '任务段（无任务时整段消失）', token: '{{#task}}…{{/task}}' },
  { label: '目标段（无目标时整段消失）', token: '{{#goal}}…{{/goal}}' },
];

/** 占位符名 → 说明（渲染「这枚占位符能填什么」的提示用） */
export const PLACEHOLDER_DESC = PLACEHOLDER_GROUPS.flatMap((g) =>
  g.items.map((it) => [it.token, it.desc])
).reduce((acc, [k, v]) => Object.assign(acc, { [k]: v }), {});

/**
 * 把标记插到文本框的当前光标处（没有光标信息就追加到末尾）。
 * @param {string} text 当前文本
 * @param {string} token 要插入的标记
 * @param {number} [caret] 光标位置（字符下标）
 * @returns {{ text: string, caret: number }} 新文本与新的光标位置
 */
export function insertToken(text, token, caret) {
  const src = String(text ?? '');
  const at = Number.isInteger(caret) && caret >= 0 && caret <= src.length ? caret : src.length;
  const next = src.slice(0, at) + token + src.slice(at);
  return { text: next, caret: at + token.length };
}

/** 文本里用到的占位符名（去重，给「本条用了哪些占位符」的提示用） */
export function usedPlaceholders(text) {
  const out = [];
  const re = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g;
  let m = re.exec(String(text ?? ''));
  while (m) {
    if (!out.includes(m[1])) out.push(m[1]);
    m = re.exec(String(text ?? ''));
  }
  return out;
}

/** 渲染模板正文：{{槽位名}} → 槽位值（没值就留空） */
export function renderTemplateBody(body, values) {
  const vals = values && typeof values === 'object' ? values : {};
  return String(body ?? '').replace(/\{\{\s*([^}{\s][^{}]*?)\s*\}\}/g, (all, name) => {
    const key = String(name).trim();
    const v = vals[key];
    return v === undefined || v === null ? '' : String(v);
  });
}
