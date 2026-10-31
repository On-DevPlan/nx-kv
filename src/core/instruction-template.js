// 指令模板渲染 —— wait 返回「收尾指令」的纯字符串机制（core 层，零依赖）。
//
// localtask 的 settings.taskSuffix 从"固定追加语"升级为模板：含 {{ 标记的值在
// wait 返回时渲染成融合指令（goal 状态 + 收尾要求），放进返回载荷的 instruction
// 字段；不含 {{ 的纯文本沿用旧的"追加到 task.text"行为（见 localtask service 的
// buildTaskDelivery）。本文件只做字符串机制，不含任何业务语义——业务默认值
// （DEFAULT_TASK_SUFFIX）留在 localtask service。
//
// 语法（v1 无转义：模板正文无法表达字面 {{，纯文本后缀不该含 {{）：
//   段落     {{#goal}}…{{/goal}}、{{#task}}…{{/task}}
//            ctx.goal / ctx.task 缺失（null/undefined）时整段丢弃
//   占位符   {{goal.name}} {{goal.deadline}} {{goal.remainingHuman}} {{goal.prompt}}
//            {{task.id}} {{task.text}} {{source}} {{summary}} {{cwd}} {{name}}
//            按 `.` 分段走 ctx，任何一步缺失或未知路径一律 ''（宽容，绝不抛错）
//
// 两条硬保证：
//   1. **单遍渲染**：扫描器只走模板一遍，插入值直接进输出缓冲、不再扫描——
//      task.text / goal.prompt 里出现 {{...}}、{{#goal}}、{{/task}} 都逐字原样。
//      这是"prompt 原文回显不被改写"契约在字符串层的延伸。
//   2. **不折叠空白**：段落标记若独占一行（紧跟换行），标记连同那个换行一起消费——
//      段落丢弃后不留空行、保留时也不多出空行；对输出绝不做 \n{3,} 之类的折叠，
//      那会破坏插入的 prompt 原文。
//
// 时间格式化（formatDuration/formatGoalTiming）语义对齐 timegoal 模块的 fmtDur 与
// renderCheck 措辞（"剩余 X"/"已到点（已超时 X）"）——core 不能 import 模块，故本地实现。
//
// 单测：tests/unit/instruction-template.test.mjs（段落/占位符/单遍/空白全钉死）。

const TOKEN_RE = /\{\{(#|\/)(goal|task)\}\}|\{\{([^{}]*)\}\}/g;
const SECTION_TAGS = new Set(['{{#goal}}', '{{/goal}}', '{{#task}}', '{{/task}}']);

/** 含任意 {{ 即视为模板（决定走渲染路径还是旧的纯文本追加路径）。 */
export function hasTemplateMarkers(template) {
  return /\{\{/.test(String(template ?? ''));
}

/** 秒 → 人话："2 天" / "1.5 小时" / "90 分钟" / "45 秒"（与 timegoal fmtDur 同风格）。 */
export function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  if (s >= 86400) return `${(s / 86400).toFixed(s % 86400 ? 1 : 0)} 天`;
  if (s >= 3600) return `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} 小时`;
  if (s >= 60) return `${(s / 60).toFixed(s % 60 ? 1 : 0)} 分钟`;
  return `${s} 秒`;
}

/** 目标时间状态："剩余 X" | "已到点" | "已到点（已超时 X）"（措辞对齐 timegoal renderCheck）。 */
export function formatGoalTiming({ reached, remainingSec, overtimeSec } = {}) {
  if (!reached) return `剩余 ${formatDuration(remainingSec)}`;
  const over = Math.max(0, Math.floor(Number(overtimeSec) || 0));
  return over > 0 ? `已到点（已超时 ${formatDuration(over)}）` : '已到点';
}

// 按路径取值：'goal.name' → ctx.goal.name；任何一步缺失 → ''（null/undefined 都算缺失）。
// 只认**自有属性**（hasOwnProperty 守卫）——否则 {{constructor}} 之类会顺着原型链
// 解析出 Object 的内置成员。
function resolvePath(path, ctx) {
  let cur = ctx;
  for (const seg of String(path).split('.')) {
    if (cur === null || cur === undefined) return '';
    cur = Object.prototype.hasOwnProperty.call(cur, seg) ? cur[seg] : undefined;
  }
  return cur === null || cur === undefined ? '' : String(cur);
}

/**
 * 渲染模板为一条指令文本。
 * - 段落按 ctx 有无整段丢弃；close 按名匹配才弹栈（错配 close 是无操作——宽容但
 *   不泄漏被丢弃段的内容，行为由单测钉死）。
 * - 空白规则：段落标记独占一行时（紧跟换行），标记连同该换行一起消费——丢弃段
 *   不留空行，保留段也不多空行。
 * - 未知段落标记（如 {{#other}}）落进占位符分支按未知路径渲染为 ''。
 * - 结果整体 trim；全部内容被丢弃/为空时返回 ''——调用方应据此**省略** instruction
 *   字段而不是输出空串。
 * @param {string} template 模板（含 {{ 标记；调用前用 hasTemplateMarkers 分流）
 * @param {object} ctx { goal, task, source, summary, cwd, name }
 * @returns {string}
 */
export function renderInstruction(template, ctx = {}) {
  const src = String(template ?? '');
  const frames = []; // {name, keep}
  const emitting = () => frames.every((f) => f.keep);
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(src); m; m = TOKEN_RE.exec(src)) {
    // 字面段：插入值（此处是模板里的字面文本）只在发射态进入输出
    if (emitting()) out += src.slice(last, m.index);
    const token = m[0];
    let consumed = TOKEN_RE.lastIndex;
    if (m[1] === '#') {
      const name = m[2];
      frames.push({ name, keep: name === 'goal' ? !!(ctx && ctx.goal) : !!(ctx && ctx.task) });
    } else if (m[1] === '/') {
      // 按名匹配才弹栈：错配的 close（如 goal 段里写 {{/task}}）是无操作——
      // 宽容但不泄漏：被丢弃段的内容不会因为一个错配 close 就提前"出栈"见光。
      const top = frames[frames.length - 1];
      if (top && top.name === m[2]) frames.pop();
    } else if (emitting()) {
      out += resolvePath(m[3].trim(), ctx);
    }
    // 独占一行的段落标记：连同紧跟的换行一起消费（丢弃段不留空行；保留段不多空行）。
    // 只对四个已知标记生效，且只吞"标记之后"的换行——标记之前的换行天然属于上一行。
    if (SECTION_TAGS.has(token) && src[consumed] === '\n') consumed += 1;
    last = consumed;
    TOKEN_RE.lastIndex = consumed;
  }
  if (emitting()) out += src.slice(last);
  return out.trim();
}
