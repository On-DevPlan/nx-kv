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
// ctx 形状（Handlebars：`{{var}}` 取值，缺失一律空串——见 core/instruction-template.js）：
//   {{task.text}}              原始提示词（任务正文，逐字）
//   {{task.id}}                任务编号
//   {{repo.name}} {{repo.intro}} {{repo.introPath}}   项目介绍（正文 + 可读路径）
//   {{#each repo.docs}}…{{/each}}     项目补充文档（数组：path / tag / note）
//   {{group.name}} {{group.desc}} {{group.intro}} {{group.introPath}} {{group.note}}
//   {{#each group.peers}}…{{/each}}   组内成员（数组：name / note）
//   {{#each group.docs}}…{{/each}}    组绑定参考文件（数组：path / tag / note）
//   {{#each repo.refRepos}}…{{/each}} 本仓库直接绑定的参考仓库（name / path / note）
//   {{#each group.refRepos}}…{{/each}} 本组绑定的参考仓库（name / path / note）
//   {{#each refRepos.list}}…{{/each}} 两者去重并集（{{refRepos.count}} 总数）
//     ——「参考仓库」= repos 里 type=ref 的实体，不是文档库 refs
//   {{#each groups}}…{{/each}}        多组时其余组（数组：name / desc / path）
//   {{source}} {{summary}} {{cwd}} {{name}} {{goal.*}}
//   {{params.k}} 与顶层 {{k}}   外部参数（平面扩展；内建同名键不被覆盖）
//   {{ext.topic}} {{ext.count}} {{#each ext.list}}…{{/each}}   同主题待领取余量
//     （数组：id / title / topic；空队列或读取失败 → ctx.ext = null，整段不出现）
//
// 条件：`{{#if repo}}` / `{{#if group}}` —— 没数据整段不出现
// （项目级任务没有组；组在但毫无可交付内容——空壳组——ctx.group 直接为 null，
// #81：只挂着成员名单的组会喷出一排空标签，让「单独仓库」看着像被归了组）。
// 旧闸门 `{{#repo}}…{{/repo}}` 仍由引擎兼容（根上下文、不切换）。
import { renderInstruction } from '../../core/instruction-template.js';
import { DEFAULT_CONTEXT_TEMPLATE } from '../../shared/prompt-blocks.js';

/**
 * 默认交付上下文模板。与区块默认模板同源（`shared/prompt-blocks.js` 的
 * DEFAULT_CONTEXT_TEMPLATE），这里只做重导出，避免两份文案漂移。
 */
export const DEFAULT_DELIVERY_TEMPLATE = DEFAULT_CONTEXT_TEMPLATE;

/** 「补充文档 / 参考文件」→ 结构化数组（模板用 {{#each}} 组织行）。 */
function docItems(links) {
  return (links || []).map((d) => ({
    path: d.abs || d.rel || d.path || '',
    tag: d.tag || '',
    note: d.note || '',
  }));
}

/** 组内成员 → 结构化数组（{{name}} / {{note}}）。 */
function peerItems(peers) {
  return (peers || []).map((p) => ({
    name: p.name || '',
    note: p.note || '',
    hasNote: !!p.note,
  }));
}

/**
 * 参考仓库（repos 里 type=ref，不是文档库 refs）→ 结构化数组。
 * 每条给名称、本机路径、一句描述；模板自己组织行，服务端不拼成文本。
 */
function refRepoItems(list) {
  return (list || []).map((r) => ({
    key: r.key || '',
    name: r.name || '',
    path: r.path || '',
    note: r.note || '',
  }));
}

/**
 * 组有没有值得交付的内容：定位 / 介绍 / 位置 / 参考文件 / 有描述的成员，任一即可。
 * 纯「成员名单（全员无描述）」不算——那只会喷出一排空标签，还让单独仓库看起来
 * 被当成了组成员（#81：这种空壳组的 {{#group}} 段整个不渲染）。
 */
function groupHasContent(g) {
  if (!g) return false;
  if (g.desc || g.note) return true;
  if (g.intro && g.intro.body) return true;
  if (g.docLinks && g.docLinks.length) return true;
  if (g.refRepos && g.refRepos.length) return true;
  return (g.peers || []).some((p) => p.note);
}

/**
 * 组上下文 → 模板 ctx（数据，不含成文措辞——措辞归模板）。
 * @param {object} groupCtx readGroupContext 的返回值
 * @returns {object} ctx 片段
 */
export function deliveryCtxOf(groupCtx) {
  const repo = groupCtx && groupCtx.repo ? groupCtx.repo : null;
  const allGroups = (groupCtx && groupCtx.groups) || [];
  // {{#group}} 的闸门是「键在不在」，不是「内容空不空」——空壳组进了 ctx 就会
  // 印出「组定位：」「组介绍（）：」这样的空标签（#81）。过滤掉空壳；多组时
  // 跳过空壳选第一个有料的当主组，其余有料的进 {{groups}} 概览。
  const groups = allGroups.filter(groupHasContent);
  const g = groups[0] || null;
  // 列表一律结构化：模板里 `{{#each repo.docs}}` / `{{#each group.peers}}` 自己组织行，
  // 服务端不再拼多行文本。
  const repoDocs = docItems(repo && repo.docLinks);
  const peers = g ? peerItems(g.peers) : [];
  const gdocs = g ? docItems(g.docLinks) : [];
  const repoRefRepos = refRepoItems(repo && repo.refRepos);
  const groupRefRepos = g ? refRepoItems(g.refRepos) : [];
  // 交付口径：本仓库直接绑定 ∪ 本次任务所属组的组级绑定，去重后按本仓库在前排序。
  // 不是「全部参考仓库」——没绑到本仓库 / 本组的参考仓库一律不给。
  const seenRefRepoKeys = new Set();
  const refRepoList = [];
  for (const r of [...repoRefRepos, ...groupRefRepos]) {
    const k = r.key || r.name;
    if (seenRefRepoKeys.has(k)) continue;
    seenRefRepoKeys.add(k);
    refRepoList.push(r);
  }
  const others = groups.slice(1).map((x) => ({
    name: x.name || '',
    desc: x.desc || '',
    path: (x.intro && x.intro.path) || '',
  }));
  return {
    repo: repo && ((repo.intro && repo.intro.body) || repoRefRepos.length)
      ? {
          name: repo.name || repo.key || '',
          key: repo.key || '',
          intro: (repo.intro && repo.intro.body) || '',
          introPath: (repo.intro && repo.intro.path) || '',
          docs: repoDocs,
          docCount: repoDocs.length,
          refRepos: repoRefRepos,
          refRepoCount: repoRefRepos.length,
        }
      : null,
    group: g
      ? {
          name: g.name || '',
          key: g.key || '',
          desc: g.desc || '',
          intro: (g.intro && g.intro.body) || '',
          introPath: (g.intro && g.intro.path) || '',
          note: g.note || '',
          // position 是 note 的别名：模板里两个名字都认（「本项目在组里的位置」）。
          position: g.note || '',
          peers,
          peerCount: peers.length,
          docs: gdocs,
          docCount: gdocs.length,
          refRepos: groupRefRepos,
          refRepoCount: groupRefRepos.length,
        }
      : null,
    // 参考仓库（repos 里 type=ref，不是文档库 refs）：直接绑定 ∪ 组级绑定，去重并集。
    refRepos: {
      list: refRepoList,
      count: refRepoList.length,
    },
    // 其余组：数组，模板用 `{{#each groups}}`。
    groups: others,
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
 * 渲染交付上下文模板（纯函数，供测试 / 独立调用）。
 * 异常**向上抛**：真正的交付链路在 system-blocks 里统一处理「回落内置模板 + 告警」，
 * 这里不再自带一层静默吞错。
 * @param {string} tpl 模板（缺省用默认模板）
 * @param {object} ctx buildDeliveryCtx 的返回值
 * @returns {string}
 */
export function renderDelivery(tpl, ctx) {
  const template = String(tpl == null || tpl === '' ? DEFAULT_DELIVERY_TEMPLATE : tpl);
  return renderInstruction(template, ctx || {});
}
