// tasktool/delivery-template.js —— **交付提示词的模板化**（任务 #62）。
//
// 交付给 agent 的提示词 = **原始提示词（task.text 原文）** + **项目组的关键路径**
// （组 / 项目的介绍 md 与可读路径）。组与项目的描述本身就是本地 markdown，
// 所以「关键路径」是磁盘上的真实文件路径——agent 拿到就能读盘。
//
// 改造前那段「上下文封装」是硬编码的字符串拼装（tasktool/groupctx.js）。
// 现在它是一份**模板 + 占位符**：
//   - 默认模板（DEFAULT_DELIVERY_TEMPLATE）复现改造前的输出口径；
//   - 模板存在设置里（settings.deliveryTemplate），设置面板「提示词 / 模板」可见可改；
//   - 引擎支持**平面扩展**：外部参数（--param k=v）平铺进 ctx，模板里 {{k}} 直接取。
//
// ctx 形状（占位符按 `.` 分段走 ctx，缺失一律空串——见 core/instruction-template.js）：
//   {{task.text}}              原始提示词（任务正文，逐字）
//   {{task.id}}                任务编号
//   {{repo.name}} {{repo.intro}} {{repo.introPath}}   项目介绍（正文 + 可读路径）
//   {{repo.docs}}              项目登记的补充文档（可读路径列表，多行）
//   {{group.name}} {{group.desc}} {{group.intro}} {{group.introPath}} {{group.note}}
//   {{group.peers}} {{group.docs}}                    组内成员 / 组绑定参考文件
//   {{groups}}                 多组时其余组的概览（多行）
//   {{source}} {{summary}} {{cwd}} {{name}} {{goal.*}}
//   {{params.k}} 与顶层 {{k}}   外部参数（平面扩展；内建同名键不被覆盖）
//
// 段落：{{#repo}}…{{/repo}} / {{#group}}…{{/group}} —— ctx 里没这个键就整段丢弃
// （项目级任务没有组，那一段就不出现）。
import { renderInstruction } from '../../core/instruction-template.js';

/**
 * 默认交付上下文模板。复现改造前 renderGroupContext 的输出口径：
 *   〔项目介绍 · X〕（路径）：正文
 *   〔项目组上下文 · Y〕组定位 / 组介绍 / 本项目位置 / 组内成员 / 组绑定参考文件
 */
export const DEFAULT_DELIVERY_TEMPLATE = [
  '{{#repo}}〔项目介绍 · {{repo.name}}〕（{{repo.introPath}}）：',
  '{{repo.intro}}',
  '{{#repoDocs}}',
  '项目补充文档（可直接读取）：',
  '{{repo.docs}}',
  '{{/repoDocs}}',
  '{{/repo}}',
  '{{#group}}〔项目组上下文 · {{group.name}}〕',
  '组定位：{{group.desc}}',
  '组介绍（{{group.introPath}}）：',
  '{{group.intro}}',
  '本项目在组里的位置：{{group.note}}',
  '{{#groupPeers}}',
  '组内成员：',
  '{{group.peers}}',
  '{{/groupPeers}}',
  '{{#groupDocs}}',
  '组绑定参考文件（可直接读取）：',
  '{{group.docs}}',
  '{{/groupDocs}}',
  '{{/group}}',
].join('\n');

/** 「补充文档 / 参考文件」列表的可读路径行（每行一条，带标签与说明）。 */
function linkLines(links) {
  return (links || [])
    .map((d) => {
      const p = d.abs || d.rel || d.path || '';
      return `  - ${p}${d.tag ? `  [${d.tag}]` : ''}${d.note ? `  # ${d.note}` : ''}`;
    })
    .join('\n');
}

/** 组内成员行：名字 + 组内描述。 */
function peerLines(peers) {
  return (peers || []).map((p) => `  - ${p.name}：${p.note || '（无组内描述）'}`).join('\n');
}

/**
 * 组上下文 → 模板 ctx（数据，不含成文措辞——措辞归模板）。
 * @param {object} groupCtx readGroupContext 的返回值
 * @returns {object} ctx 片段
 */
export function deliveryCtxOf(groupCtx) {
  const repo = groupCtx && groupCtx.repo ? groupCtx.repo : null;
  const groups = (groupCtx && groupCtx.groups) || [];
  const g = groups[0] || null;
  const repoDocs = linkLines(repo && repo.docLinks);
  const peers = g ? peerLines(g.peers) : '';
  const gdocs = g ? linkLines(g.docLinks) : '';
  const others = groups
    .slice(1)
    .map((x) => `  - ${x.name}${x.desc ? `（${x.desc}）` : ''}${x.intro && x.intro.path ? `  ${x.intro.path}` : ''}`)
    .join('\n');
  return {
    repo: repo && repo.intro && repo.intro.body
      ? {
          name: repo.name || repo.key || '',
          key: repo.key || '',
          intro: repo.intro.body || '',
          introPath: repo.intro.path || '',
          docs: repoDocs,
        }
      : null,
    repoDocs: repoDocs ? {} : null,
    group: g
      ? {
          name: g.name || '',
          key: g.key || '',
          desc: g.desc || '',
          intro: (g.intro && g.intro.body) || '',
          introPath: (g.intro && g.intro.path) || '',
          note: g.note || '',
          // 段内容放在 group 里（占位符 {{group.peers}} 从根 ctx 取），
          // groupPeers / groupDocs 只是**闸门**（有没有就整段在不在）。
          peers,
          docs: gdocs,
        }
      : null,
    groupPeers: peers ? {} : null,
    groupDocs: gdocs ? {} : null,
    groups: others ? { text: others } : null,
  };
}

/**
 * 组装交付 ctx：内建字段 + 组上下文片段 + 外部参数（平面扩展）。
 * @param {object} p
 * @param {object|null} p.task 任务行
 * @param {object|null} p.goal timegoal 上下文
 * @param {string} [p.source] local / global
 * @param {string} [p.summary] 等待方现状
 * @param {string} [p.cwd] 等待方目录
 * @param {string} [p.name] 等待方名字
 * @param {object|null} [p.groupCtx] readGroupContext 的返回值
 * @param {object} [p.params] 外部参数（平面扩展：顶层可直接 {{k}}，也可 {{params.k}}）
 * @returns {object} ctx
 */
export function buildDeliveryCtx({ task, goal, source, summary, cwd, name, groupCtx, params } = {}) {
  const base = {
    task: task ? { id: task.id, text: String(task.text || '') } : null,
    goal: goal || null,
    source: source || '',
    summary: summary || '',
    cwd: cwd || '',
    name: name || '',
  };
  const extra = deliveryCtxOf(groupCtx);
  const flat = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k in base || k in extra) continue; // 内建键不被外部参数覆盖
    flat[k] = v;
  }
  return {
    ...base,
    ...extra,
    params: { ...(params || {}) },
    ...flat,
  };
}

/**
 * 渲染交付上下文模板。空模板 / 渲染异常 → 返回空串（fail-open：上下文是增强，
 * 不是领取的前提）。
 * @param {string} tpl 模板（缺省用默认模板）
 * @param {object} ctx buildDeliveryCtx 的返回值
 * @returns {string}
 */
export function renderDelivery(tpl, ctx) {
  const template = String(tpl == null || tpl === '' ? DEFAULT_DELIVERY_TEMPLATE : tpl);
  try {
    return renderInstruction(template, ctx || {});
  } catch {
    return '';
  }
}
