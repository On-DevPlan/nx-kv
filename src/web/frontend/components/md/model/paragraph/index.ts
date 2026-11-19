// 段落语法：连续未被其它规则接管的行，合成**一个**段落，行间 `<br>`。
//
// 修复的缺陷：旧编排层是「每行一个 <p>」，于是块模型里同一块的多行（用户在一个块
// 里回车换行得到的）被渲染成多个独立段落——段间距突然变大，和编辑器里看到的
// 一个块对不上。markdown 语义里，连续非空行属于同一段落，换行是**软换行**；
// 本仓库的编辑器视图按块编辑，块内换行应当可见，所以软换行统一渲染成 `<br>`。
//
// 这个函数不是 BlockRule：段落是「没有任何规则命中」的兜底形态，由编排层在确认
// 其它规则都不匹配后调用，因此不需要参与 priority 竞争。
import type { BlockCtx } from '../types.js';

/**
 * 多行合一段。
 *
 * @param lines 该段落占用的行（已确认没有任何块级规则命中、且非空行）
 */
export function paragraphHtml(lines: string[], ctx: BlockCtx): string {
  return `<p>${lines.map((l) => ctx.inline(l)).join('<br>')}</p>`;
}
