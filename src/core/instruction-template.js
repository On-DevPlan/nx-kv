// 指令模板渲染 —— Handlebars 4.x 的薄封装（core 层）。
//
// 选型（为什么是 Handlebars）：
//   - 同步渲染：`compile()` 返回的模板函数是纯同步的，wait/get 的交付链路不需要
//     async 渲染（Nunjucks 的 API 偏异步、要包一层 Promise，EJS 干脆是「模板即
//     JS」，安全与可读性都差）；
//   - 原生 `{{#if}}` / `{{#each}}`（含 `{{else}}`、`{{@first}}`），成员 / 文档 /
//     附件清单这类列表不需要任何自定义 helper；
//   - `noEscape` 可关掉 HTML 转义（提示词是给 agent 读的纯文本，绝不能把 `&`、
//     `<`、`"` 变成实体）；
//   - 零运行时依赖、体积可控（4.7.x 只带 4 个内部包），ESM 下 `import Handlebars
//     from 'handlebars'` 直接可用；
//   - 维护活跃（CVE 有持续跟进），且 4.7 默认禁止原型链取值。
//
// 语法（只允许这一套，不维护新旧两套）：
//   取值    {{task.id}} / {{repo.intro}} / {{group.peers.0.name}} …
//   条件    {{#if repo}}…{{else}}…{{/if}}
//   循环    {{#each group.peers}}…{{/each}}（循环内直接用 {{name}} 等字段）
//
// 旧语法**已废弃**（不兼容、不自动改写）：
//   - `{{#repo}}…{{/repo}}` / `{{#group}}…{{/group}}` 等旧闸门——不再覆盖
//     `blockHelperMissing`，也不再把它映射成「真值条件」；
//   - `{{group.peers}}` / `{{repo.docs}}` / `{{attach.list}}` 这类旧纯文本占位符；
//   - `{{attach.sync}}` / `{{attach.syncText}}` 旧别名、`{{block.content}}` 旧包装。
//   这些写法在保存校验时直接拒绝，运行期遇到也按坏模板回落内置模板（见下），
//   不会悄悄按旧语义生效。
//
// 失败行为（明确约定，不静默）：
//   - 保存模板时先 `validateTemplate()` 编译校验，语法错误**拒绝保存**（见
//     localtask/repo/settings.js），让用户当场看到错在哪；
//   - 渲染时若仍遇到坏模板（老版本存进去的 / 直接改库的），由调用方回落该区块
//     的**内置模板**并把告警写进 `renderWarnings`（见 tasktool/system-blocks.js）。
//     选择回落而不是阻断领取：一条坏模板不该让整个队列停摆，但问题必须在
//     CLI 返回载荷 / 面板预览里可见。
//
// 单遍渲染不变：插入值（task.text / goal.prompt 等）是**数据**，Handlebars 只把
// 它们写进输出缓冲，不会回头再解析，所以正文里的 `{{...}}` 逐字保留。
//
// 时间格式化（formatDuration / formatGoalTiming）与 timegoal 的 fmtDur /
// renderCheck 措辞对齐——core 不能 import 模块，故本地实现。
import Handlebars from 'handlebars';

// 独立环境：不改全局 Handlebars 实例，避免与其它潜在用法互相污染。
const HB = Handlebars.create();
// 关掉库内日志：原型链取值被拒时会按 error 级打印一条提示，那会污染 CLI 的
// JSON 输出；我们自己的渲染告警走 renderWarnings（结构化、可控）。
HB.logger.level = 'silent';

const COMPILE_OPTS = { noEscape: true, strict: false };
const CACHE_MAX = 256;
const cache = new Map();

// 旧语法识别（不兼容、不迁移）：
//   - 旧闸门 `{{#repo}}` / `{{#group}}` / `{{#attachSync}}` / `{{#goalCheck}}` 等：
//     只允许 `{{#if}}` / `{{#each}}` 两种块。
//   - 旧纯文本占位符（服务端曾拼好的多行字符串 / 旧同步摘要 / 旧包装内容）。
const ALLOWED_BLOCKS = new Set(['if', 'each']);
const LEGACY_PLACEHOLDERS = new Set([
  'group.peers',
  'repo.docs',
  'group.docs',
  'attach.list',
  'groups',
  'attach.sync',
  'attach.syncText',
  'block.content',
]);

function legacySyntaxError(template) {
  const src = String(template ?? '');
  const blockRe = /\{\{\s*([#/^])\s*([A-Za-z_$][\w$-]*)/g;
  let m;
  while ((m = blockRe.exec(src))) {
    const [, sigil, name] = m;
    if (ALLOWED_BLOCKS.has(name) && sigil !== '^') continue;
    if (sigil === '^') {
      return `不支持反向区块 {{^${name}}}；请改用 {{#if 变量}}…{{else}}…{{/if}}`;
    }
    return `旧区块语法 {{${sigil}${name}}} 已废弃；请改用 {{#if 变量}}…{{/if}} 或 {{#each 列表}}…{{/each}}`;
  }
  const mustacheRe = /\{\{\s*([^{}#/^!>&][^{}]*?)\s*\}\}/g;
  while ((m = mustacheRe.exec(src))) {
    const name = m[1].trim();
    if (/^else\b/.test(name)) continue;
    if (LEGACY_PLACEHOLDERS.has(name)) {
      const hint = name === 'attach.sync' || name === 'attach.syncText'
        ? '请改用 {{attach.sync.dir}} 等具体字段（并用 {{#if attach.sync}} 判断是否跑过同步）'
        : '列表请改用 {{#each 列表}}…{{/each}}，对象请直接取子字段';
      return `旧占位符 {{${name}}} 已废弃；${hint}`;
    }
  }
  return null;
}

function compiledOf(src) {
  let fn = cache.get(src);
  if (fn) return fn;
  fn = HB.compile(src, COMPILE_OPTS);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(src, fn);
  return fn;
}

/**
 * 编译校验（保存模板前调用）。
 * 先拒绝旧语法（明确提示改用 #if / #each），再用 precompile 查 Handlebar 语法错误。
 * @param {string} template
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateTemplate(template) {
  const legacy = legacySyntaxError(template);
  if (legacy) return { ok: false, error: legacy };
  try {
    // 必须用 precompile：compile() 返回的是惰性模板函数，语法错误要等首次调用才抛。
    HB.precompile(String(template ?? ''), COMPILE_OPTS);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).replace(/\s+/g, ' ').trim() };
  }
}

/**
 * 渲染模板为一条文本。
 * 旧语法 / 语法错误 / 运行期异常都会抛出——调用方按「回落该区块内置模板 + 告警」
 * 处理，绝不静默，也绝不让旧语法按旧语义生效。
 * @param {string} template
 * @param {object} ctx 共享入参列表
 * @returns {string}
 */
export function renderInstruction(template, ctx = {}) {
  const src = String(template ?? '');
  if (!src) return '';
  const legacy = legacySyntaxError(src);
  if (legacy) throw new Error(legacy);
  const out = compiledOf(src)(ctx || {});
  return out.trim();
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
