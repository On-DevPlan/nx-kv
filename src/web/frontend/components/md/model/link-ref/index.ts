// 引用式链接：`[文字][标签]` 引用 `[标签]: https://…` 定义（CommonMark reference link）。
//
// 与脚注同属**文档级**语法：定义行被抽走登记，引用点在转义前改写成内联形态
// `[文字](url)`，随后交给既有的链接渲染链处理——这样外链 / 附件 / 内部资源三类
// 目标不用各写一遍解析，引用式链接自动继承它们的全部行为。
//
// 只支持 `[文字][标签]` 与 `[文字][]` 两种形态；**不做** shortcut `[标签]`：它和
// 普通方括号、双链 `[[x]]` 的边界太容易互相误吃，收益不抵风险。
import type { DocCtx, DocRule, InlineEnv, InlinePreRule } from '../types.js';

/** `[标签]: url` 或 `[标签]: url "标题"`（标题部分丢弃，仅用于识别整行）。 */
const DEF_RE = /^\[([^\[\]]+)\]:[ \t]*(\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;

export const linkRefDocRule: DocRule = {
  id: 'link-ref-def',
  collect(lines: string[], ctx: DocCtx): string[] {
    const out: string[] = [];
    for (const line of lines) {
      const m = DEF_RE.exec(line);
      // 脚注定义 `[^x]: …` 也会被上面的正则命中（标签以 ^ 开头），跳过交给脚注规则
      if (!m || String(m[1] ?? '').startsWith('^')) {
        out.push(line);
        continue;
      }
      const label = String(m[1] ?? '').trim().toLowerCase();
      const url = String(m[2] ?? '').trim();
      if (label && url) ctx.refLinks.set(label, url);
    }
    return out;
  },
};

/** `[文字][标签]` / `[文字][]` → `[文字](url)`；标签未定义时原样保留。 */
export const linkRefPreRule: InlinePreRule = (text: string, env: InlineEnv): string => {
  if (!env.refLinks.size) return text;
  return text.replace(/\[([^\[\]]+)\]\[([^\[\]]*)\]/g, (m, label: string, key: string) => {
    const k = String(key || label).trim().toLowerCase();
    const url = env.refLinks.get(k);
    return url ? `[${label}](${url})` : m;
  });
};
