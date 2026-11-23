// 编排 compose（#152 按时机链；#153 取消共享 ctx）——四种语义各只有一处答案：
//   顺序 → 链内按插件 order 升序（chainOf；顺序不再落库）
//   数据 → **每段一份自己的 ctx**：seed + 本段 buildData() 的产出，用完即弃
//   是否出段 → 渲染结果 trim() 为空即不出
//   失败 → buildData()/渲染抛错 = 整次交付失败，不吞、不回落（运行期不兜底）
//
// 为什么不再 Object.assign 出一个大 ctx：那样每段的模板就能偷偷引用别的段的变量
// （渲染顺序变成隐式依赖），白名单也被迫用「全局段集」放行跨段耦合。
// 现在「谁的数据给谁用」是硬边界，跨段引用在启动期就被 assertPluginList 拒。
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
  trace?: RenderTraceEntry[];
  /** trace 的段名映射（traceId / label / 生效模板名）——真实领取不传，预览传 */
  segments?: SegmentMeta[];
}

/**
 * 组装一条时机链的 instruction：按链内 order 取数合并 → 渲染 → 包标签。
 * 返回 ''（无可输出段落）时调用方省略 instruction。
 */
export async function compose(opts: ComposeOptions): Promise<string> {
  const { plugins, group, groups, seed = {}, trace, segments } = opts;
  const wanted = groups && groups.length ? groups : group ? [group] : [];
  if (!wanted.length) throw new Error('compose: 必须指定 group 或 groups');
  const chain =
    wanted.length === 1
      ? chainOf(plugins, wanted[0]!)
      : wanted.flatMap((g) => chainOf(plugins, g)).sort((a, b) => a.order - b.order);
  // 全量不变量（id / 链内 order / 模板非空 / 模板只引用自己的变量）只校验一次；
  // 链内只保留本次要渲染的段。
  assertRegistry();
  assertPluginList(chain);
  const segOf = new Map<string, SegmentMeta>((segments || []).map((s) => [s.id, s]));

  const parts: XmlBlockPart[] = [];
  for (const p of chain) {
    const template = p.get();
    if (!String(template ?? '').trim()) continue;
    // 每段的数据域 = seed + 本段产出；不向后传、也不接受别人传进来。
    // seed 放在后面：任务本体 / 时间目标这些「宿主权威数据」不许被某段的 buildData 覆盖
    // （段只能补充自己的段，不能改写 task.id 这类身份字段）。
    const data = (await p.get('data')) as Record<string, unknown> | null | undefined;
    const scope: Record<string, unknown> = { ...(data || {}), ...seed };
    const text = renderInstruction(template, scope).trim();
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
  return wrapXmlBlocks(parts);
}
