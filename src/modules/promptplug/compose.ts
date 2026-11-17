// 编排 compose（#152：按时机链渲染）——四种语义各只有一处答案：
//   顺序 → 链内按插件 order 升序（chainOf；顺序不再落库）
//   ctx 合并 → 按序 Object.assign，段级命名互斥由 assertPluginList 保证
//   是否出段 → 渲染结果 trim() 为空即不出
//   失败 → buildData()/渲染抛错 = 整次交付失败，不吞、不回落（运行期不兜底）
//
// group 是硬闸门：传 'get' 就只跑 get 链，'check'/'done' 同理——
// 一个时机 = 一条链，链内顺序 = 插件类声明的 order。
//
// 一次触发可以要**多条链**（`groups`）：交付就是这样——领取（get）时也要把
// 「每轮检查该做什么」（check）一并给出，否则 agent 永远看不到那段。多链合并后
// 仍按各类声明的 order 全局排序，所以「get+check」与旧的单链顺序逐段一致。
import { renderInstruction } from '../../core/instruction-template.js';
import { wrapXmlBlocks, type XmlBlockPart } from '../../shared/prompt-blocks.js';
import { assertPluginList, chainOf, type AnyPromptPlugin } from '../../shared/prompt-plugin.js';
import { assertRegistry } from './registry.js';

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
  /** 触发时机（链名）：只跑这一条链（与 groups 二选一） */
  group?: string;
  /** 一次触发多条链（按 order 全局排序后合并；交付 = ['get','check']） */
  groups?: readonly string[];
  /** compose 的种子数据：task / cwd / goal / source / summary / name / params */
  seed?: Record<string, unknown>;
  mode?: 'xml' | 'plain';
  trace?: RenderTraceEntry[];
  /** trace 的段名映射（traceId / label / 生效模板名）——真实领取不传，预览传 */
  segments?: SegmentMeta[];
}

/**
 * 组装一条时机链的 instruction：按链内 order 取数合并 → 渲染 → 包标签。
 * 返回 ''（无可输出段落）时调用方省略 instruction。
 */
export async function compose(opts: ComposeOptions): Promise<string> {
  const { plugins, group, groups, seed = {}, mode = 'xml', trace, segments } = opts;
  const wanted = groups && groups.length ? groups : group ? [group] : [];
  if (!wanted.length) throw new Error('compose: 必须指定 group 或 groups');
  const chain =
    wanted.length === 1
      ? chainOf(plugins, wanted[0]!)
      : wanted.flatMap((g) => chainOf(plugins, g)).sort((a, b) => a.order - b.order);
  // 全量不变量（id / 链内 order / 模板非空 / 写回段撞车）只校验一次；
  // 链内只保留本次要渲染的段。
  assertRegistry();
  assertPluginList(chain);
  const segOf = new Map<string, SegmentMeta>((segments || []).map((s) => [s.id, s]));

  const ctx: Record<string, unknown> = { ...seed };
  for (const p of chain) Object.assign(ctx, await p.get('data'));

  const parts: XmlBlockPart[] = [];
  for (const p of chain) {
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
