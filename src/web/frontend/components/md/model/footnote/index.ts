// 脚注语法：正文 `[^note]` + 定义行 `[^note]: 说明` → 上标引用 + 文末脚注列表。
//
// 这是本仓库第一个**文档级**语法（DocRule）：定义行不能就地渲染，必须先全文扫一遍
// 把它们抽走登记，引用点才能查到编号与正文。三个阶段：
//   1. collect  —— 抽走定义行（含缩进续行），登记 label → 正文行
//   2. preRule  —— 把 `[^label]` 换成占位符（转义前，避免被 `[..]` 链接正则误吃）
//   3. restore  —— 占位符换成 `<sup>` 并在文末追加 `<ol class="md-fn-list">`
//
// 为什么不复用「定义顺序 = 引用顺序」：占位符只带编号，编号按**定义顺序**给。
// 正常文档里两者一致；不一致时编号会跳跃，但换来无状态、渲染幂等（同一份正文
// 无论渲染几次结果都相同，不会因为调用顺序变编号）。
import type { DocCtx, DocRule, InlineEnv, InlinePreRule } from '../types.js';

const REF_OPEN = '\uE004';
const REF_CLOSE = '\uE005';

const DEF_RE = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

/** 定义行起始 + 其后缩进续行（≥2 空格）合成一条脚注。 */
export const footnoteDocRule: DocRule = {
  id: 'footnote-def',
  collect(lines: string[], ctx: DocCtx): string[] {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const m = DEF_RE.exec(line);
      if (!m) {
        out.push(line);
        continue;
      }
      const body: string[] = [m[2] ?? ''];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? '';
        if (!/^[ \t]{2,}\S/.test(next)) break;
        body.push(next.trim());
        j += 1;
      }
      ctx.footnotes.set(String(m[1] ?? ''), body);
      i = j - 1;
    }
    return out;
  },
};

/** `[^label]` → 占位符（只带编号；未定义的 label 原样留着，当普通文字）。 */
export const footnotePreRule: InlinePreRule = (text: string, env: InlineEnv): string => {
  if (!env.footnotes.size) return text;
  const labels = Array.from(env.footnotes.keys());
  return text.replace(/\[\^([^\]\s]+)\]/g, (m, label: string) => {
    const idx = labels.indexOf(label);
    if (idx < 0) return m;
    return `${REF_OPEN}${idx + 1}${REF_CLOSE}`;
  });
};

/** 占位符 → 上标引用，并在文末追加脚注列表（无脚注时原样返回）。 */
export function restoreFootnotes(
  html: string,
  ctx: DocCtx,
  inline: (text: string) => string,
): string {
  if (!ctx.footnotes.size) return html;
  const body = html.replace(
    /\uE004(\d+)\uE005/g,
    (_m, n: string) =>
      `<sup class="md-fn-ref"><a href="#md-fn-${n}" id="md-fnref-${n}">${n}</a></sup>`,
  );
  const items = Array.from(ctx.footnotes.values())
    .map((lines, k) => {
      const n = String(k + 1);
      const text = lines.map((l) => inline(l)).join('<br>');
      return `<li id="md-fn-${n}">${text}<a class="md-fn-back" href="#md-fnref-${n}" aria-label="返回正文">↩</a></li>`;
    })
    .join('');
  return `${body}<ol class="md-fn-list">${items}</ol>`;
}
