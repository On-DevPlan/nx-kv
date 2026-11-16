// 编排 compose（唯一基准方案 §6）——四种语义各只有一处答案：
//   顺序 → orderIds（resolveOrderIds：数组唯一真相，缺失按 order 播种一次）
//   ctx 合并 → 按序 Object.assign，段级命名互斥由 assertPluginList 保证
//   是否出段 → 渲染结果 trim() 为空即不出（模板为空 → 启动期已报错）
//   失败 → data()/渲染抛错 = 整次交付失败，不吞、不回落（运行期不兜底）
//
// 与旧 composeSystemBlocks（tasktool/system-blocks.ts，已删）的差异：
//   - 双层 try/catch 回落（坏模板 → 内置 → 空串）**删除**：模板在保存期校验，
//     运行期抛错只可能是代码 bug，静默回落会让「提示词少了半段」无人知晓；
//   - 段落清单不再来自 BLOCK_DEFS——由插件数组 + 顺序数组提供（§5.1）。
import { renderInstruction } from '../../core/instruction-template.js';
import { wrapXmlBlocks, type XmlBlockPart } from '../../shared/prompt-blocks.js';
import { assertPluginList, resolveOrderIds, type AnyPromptPlugin } from '../../shared/prompt-plugin.js';

/** 预览用分段记录（与旧 system-blocks 同形，调用方无感）。 */
export interface RenderTraceEntry {
  id: string;
  label: string;
  text: string;
  templateName: string;
  warning?: string;
  fellBack?: boolean;
}

/** 渲染告警（ctx 级别的非致命问题，如 ext 读取失败；模板错误已改为抛出）。 */
export interface RenderWarning {
  block: string;
  label: string;
  message: string;
}

/** trace 里的段名映射（段落元数据，与旧 system-blocks 同形）。 */
export interface SegmentMeta {
  id: string;
  label?: string;
  traceId?: string;
  templateName?: string;
}

export interface ComposeOptions {
  plugins: readonly AnyPromptPlugin[];
  /** 顺序数组（唯一真相）；缺失 / 不合法时按插件 order 播种 */
  orderIds?: readonly string[];
  /** compose 的种子数据：task / cwd / goal / source / summary / name / params */
  seed?: Record<string, unknown>;
  mode?: 'xml' | 'plain';
  trace?: RenderTraceEntry[];
  /** trace 的段名映射（traceId / label / 生效模板名）——真实领取不传，预览传 */
  segments?: SegmentMeta[];
}

/**
 * 组装交付 instruction：按序取数合并 → 按序渲染 → 包标签。
 * 返回 ''（无可输出段落）时调用方省略 instruction。
 */
export async function compose(opts: ComposeOptions): Promise<string> {
  const { plugins, seed = {}, mode = 'xml', trace, segments } = opts;
  assertPluginList(plugins);
  const orderIds = resolveOrderIds(plugins, opts.orderIds);
  const byId = new Map(plugins.map((p) => [p.id, p] as const));
  const segOf = new Map<string, SegmentMeta>((segments || []).map((s) => [s.id, s]));

  const ctx: Record<string, unknown> = { ...seed };
  for (const id of orderIds) Object.assign(ctx, await byId.get(id)!.get('data'));

  const parts: XmlBlockPart[] = [];
  for (const id of orderIds) {
    const p = byId.get(id)!;
    const template = p.get();
    if (!String(template ?? '').trim()) continue;
    const text = renderInstruction(template, ctx).trim();
    if (!text) continue;
    parts.push({ id: p.id, tag: p.tag, text });
    if (trace) {
      const seg = segOf.get(p.id);
      trace.push({
        id: seg?.traceId || p.id,
        label: seg?.label || p.label,
        text,
        templateName: seg?.templateName || '系统内置',
      });
    }
  }
  if (mode === 'plain') return parts.map((p) => p.text).join('\n\n').trim();
  return wrapXmlBlocks(parts);
}
