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
import { BLOCK_DEFS, wrapXmlBlocks } from '../../shared/prompt-blocks.js';

/** 渲染单条模板；旧语法 / 语法错误 → 抛出（由 composeSystemBlocks 回落内置模板并记告警）。 */
function renderOne(template, ctx) {
  const src = String(template ?? '');
  if (!src.trim()) return '';
  const check = validateTemplate(src);
  if (!check.ok) throw new Error(check.error);
  return renderInstruction(src, ctx);
}

/**
 * 组装系统上下文。
 * @param {Array<{id,label,traceId}>} [segments] 段落元数据（只用于 trace 的段名映射）
 * @param {object} [opts]
 * @param {'xml'|'plain'} [opts.mode] 追加模式
 * @param {object} [opts.templates] 每区块当前生效模板
 *   `{ [id]: { id, name, template, builtin } }`（见 shared/prompt-blocks.js 的 resolveBlockTemplates）
 * @param {object} [opts.ctx] 共享渲染上下文（所有模板共用这一份）
 * @param {Array} [opts.trace] 预览用分段记录
 * @param {Array} [opts.warnings] 渲染告警收集器（`{ block, label, message }`）
 * @returns {string} instruction 片段（无内容 → ''）
 */
export function composeSystemBlocks(segments, { mode = 'xml', templates, ctx = {}, trace, warnings } = {}) {
  const segOf = new Map((segments || []).map((s) => [s.id, s]));
  const parts = [];
  for (const def of BLOCK_DEFS) {
    const active = templates && templates[def.id];
    const template = active && typeof active.template === 'string' ? active.template : def.defaultTemplate;
    if (!String(template).trim()) continue; // 该块当前模板为空 = 不输出（如 rule 内置）

    const seg = segOf.get(def.id);
    let text = '';
    let warning = null;
    try {
      text = renderOne(template, ctx).trim();
    } catch (e) {
      // 回落内置模板：系统内容不能因一条坏模板整块消失；同时把原因暴露出来。
      warning = {
        block: def.id,
        label: def.label,
        message: String((e && e.message) || e).replace(/\s+/g, ' ').trim(),
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
