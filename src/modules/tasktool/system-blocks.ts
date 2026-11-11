// tasktool/system-blocks.js —— 系统段落的渲染与薄编排。
//
// 模型（v5）：所有区块共用**同一个 ctx**（repo / group / task / attach / goal / getloop…），
// 每个区块只渲染它当前生效的那一条模板（来自各自独立的模板列表，见 shared/prompt-blocks.js）。
// 这里只负责「按固定顺序渲染 → 包标签（xml）或空行拼接（plain）」，
// 不生产任何「预渲染正文」，也没有 block 内容包装的中间层。
//
// 失败行为（明确、可见、不静默）：
//   某块模板语法出错或使用了已废弃的旧语法 → **该块回落到系统内置模板**，同时把告警
//   记进 `warnings`（由 wait 带进返回载荷的 renderWarnings，并在预览 trace 里标注）。
//   选择回落而不是阻断领取：一条坏模板不该让整个队列停摆；但问题必须能被看见
//   ——保存时还会先编译校验（见 localtask/repo/settings.js），正常路径进不来坏模板。
import { renderInstruction, validateTemplate } from '../../core/instruction-template.js';
import {
  BLOCK_DEFS,
  wrapXmlBlocks,
  type BlockDef,
  type ResolvedBlockTemplate,
  type XmlBlockPart,
} from '../../shared/prompt-blocks.js';

/** 渲染单条模板；旧语法 / 语法错误 → 抛出（由 composeSystemBlocks 回落内置模板并记告警）。 */
function renderOne(template: unknown, ctx: unknown): string {
  const src = String(template ?? '');
  if (!src.trim()) return '';
  const check = validateTemplate(src);
  if (!check.ok) throw new Error(check.error);
  return renderInstruction(src, ctx);
}

/** trace 里的段名映射（段落元数据） */
export interface SegmentMeta {
  id: string;
  label?: string;
  traceId?: string;
}

/** 预览用分段记录 */
export interface RenderTraceEntry {
  id: string;
  label: string;
  text: string;
  templateName: string;
  warning?: string;
  fellBack?: boolean;
}

/** 渲染告警（坏模板回落内置时收集） */
export interface RenderWarning {
  block: string;
  label: string;
  message: string;
}

export interface ComposeSystemBlocksOptions {
  mode?: 'xml' | 'plain';
  templates?: Record<string, ResolvedBlockTemplate>;
  ctx?: unknown;
  trace?: RenderTraceEntry[];
  warnings?: RenderWarning[];
}

/**
 * 组装系统上下文。
 * @param segments 段落元数据（只用于 trace 的段名映射）
 * @returns instruction 片段（无内容 → ''）
 */
export function composeSystemBlocks(
  segments: SegmentMeta[] | undefined,
  { mode = 'xml', templates, ctx = {}, trace, warnings }: ComposeSystemBlocksOptions = {},
): string {
  const segOf = new Map<string, SegmentMeta>((segments || []).map((s) => [s.id, s]));
  const parts: XmlBlockPart[] = [];
  for (const def of BLOCK_DEFS as readonly BlockDef[]) {
    const active: ResolvedBlockTemplate | undefined = templates && templates[def.id];
    const template = active && typeof active.template === 'string' ? active.template : def.defaultTemplate;
    if (!String(template).trim()) continue; // 该块当前模板为空 = 不输出（如 rule 内置）

    const seg: SegmentMeta | undefined = segOf.get(def.id);
    let text = '';
    let warning: RenderWarning | null = null;
    try {
      text = renderOne(template, ctx).trim();
    } catch (e) {
      // 回落内置模板：系统内容不能因一条坏模板整块消失；同时把原因暴露出来。
      warning = {
        block: def.id,
        label: def.label,
        message: String((e as Error).message || e).replace(/\s+/g, ' ').trim(),
      };
      if (warnings) warnings.push(warning);
      try {
        text = renderOne(def.defaultTemplate, ctx).trim();
      } catch {
        text = '';
      }
    }
    if (!text) continue;
    parts.push({ id: def.id, tag: def.tag, text });
    if (trace) {
      trace.push({
        id: seg?.traceId || def.id,
        label: seg?.label || def.label,
        text,
        templateName: active?.name || '系统内置',
        ...(warning ? { warning: warning.message, fellBack: true } : {}),
      });
    }
  }
  if (mode === 'plain') return parts.map((p) => p.text).join('\n\n').trim();
  return wrapXmlBlocks(parts);
}
