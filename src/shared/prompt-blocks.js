// 提示词渲染共享定义（前后端共用，零依赖；这里只放数据与归一化函数，引擎在 core）。
//
// **模型（v5）：一份共享入参 + 每区块各自一份模板列表 + 薄编排。**
//   - 整个渲染领域只有一个 ctx（见 delivery-template.js 的 buildDeliveryCtx）：
//     `{ task, repo, group, attach, goal, getloop, source, summary, cwd, name, params }`。
//     所有区块模板都从这同一份数据取值——不存在「某模块自带一套变量域」。
//   - 每个区块（context / attachment / timecheck / ack / getloop）各自有一份
//     独立的模板列表：`blockTemplates[id] = { active, list: [{ id, name, template, builtin }] }`。
//     旧 rule 区块已合并进 ack（done 指令与收尾要求只留这一个出口）。
//     列表里可以新建、编辑、复制、删除，并由 `active` 指定该区块当前生效的模板。
//   - 每个区块**始终至少有一个系统内置模板**（id 固定 `builtin`）：不可删除，
//     内容固定为该区块的默认模板；用户模板删光后 active 自动回落到它。
//   - 模板由 core/instruction-template.js（Handlebars 4.x）渲染；列表变量是结构化数组，
//     用 `{{#each}}` 展开；有无用 `{{#if}}` 判断。
//   - 旧语法（`{{#repo}}…{{/repo}}` 闸门、`{{group.peers}}` 这类纯文本占位符、
//     `{{attach.sync}}` 旧别名）**不再兼容**；保存校验会直接拒绝并提示改用新语法。
//
// 区块标记是给 agent 读的「类 XML」分隔语法，不对正文做实体转义。

/** 追加模式：xml = 区块标记（默认）；plain = 老行为，按空行直接拼正文。 */
export const APPEND_MODES = Object.freeze([
  {
    id: 'xml',
    label: 'XML 区块（默认）',
    desc: '每段系统内容包进独立标签，agent 一眼分清任务原文与系统规则',
  },
  {
    id: 'plain',
    label: '正文直追加',
    desc: '不包标签，按空行拼接（与改造前的 instruction 逐字一致）',
  },
]);

export const DEFAULT_APPEND_MODE = 'xml';
export const XML_ROOT_TAG = 'nx-kv';

/** 单个区块模板长度上限（防把整本书塞进设置）。 */
export const MAX_BLOCK_TEMPLATE_LEN = 8000;
/** 每个区块的模板条数上限 / 模板名长度上限。 */
export const MAX_PROMPT_TEMPLATES = 20;
export const MAX_PROMPT_TEMPLATE_NAME = 60;
/** 系统内置条目的固定 id / 名称（前后端都靠这个判断「不可删除」）。 */
export const BUILTIN_TEMPLATE_ID = 'builtin';
export const BUILTIN_TEMPLATE_NAME = '系统内置';

/**
 * 默认交付上下文模板（Handlebars 语法）：
 * 项目介绍 / 补充文档 / 组上下文 / 成员 / 参考文件，全部由同一条 ctx 用 #if + #each 组织。
 */
export const DEFAULT_CONTEXT_TEMPLATE = [
  '{{#if repo}}',
  '〔项目介绍 · {{repo.name}}〕（{{repo.introPath}}）：',
  '{{repo.intro}}',
  '{{#if repo.docs}}',
  '项目补充文档（可直接读取）：',
  '{{#each repo.docs}}',
  '  - {{path}}{{#if tag}}  [{{tag}}]{{/if}}{{#if note}}  # {{note}}{{/if}}',
  '{{/each}}',
  '{{/if}}',
  '{{/if}}',
  '{{#if group}}',
  '〔项目组上下文 · {{group.name}}〕',
  '{{#if group.desc}}',
  '组定位：{{group.desc}}',
  '{{/if}}',
  '{{#if group.intro}}',
  '组介绍（{{group.introPath}}）：',
  '{{group.intro}}',
  '{{/if}}',
  '{{#if group.note}}',
  '本项目在组里的位置：{{group.note}}',
  '{{/if}}',
  '{{#if group.peers}}',
  '组内成员：',
  '{{#each group.peers}}',
  '  - {{name}}：{{#if note}}{{note}}{{else}}（无组内描述）{{/if}}',
  '{{/each}}',
  '{{/if}}',
  '{{#if group.docs}}',
  '组绑定参考文件（可直接读取）：',
  '{{#each group.docs}}',
  '  - {{path}}{{#if tag}}  [{{tag}}]{{/if}}{{#if note}}  # {{note}}{{/if}}',
  '{{/each}}',
  '{{/if}}',
  '{{/if}}',
].join('\n');

/**
 * 默认附件段模板：固定三段——总数 / 逐条清单 / 取用方式。
 *
 * 类型由 ctx 里的 type 子对象驱动（file / url / task / ref），命令与说明通过
 * {{usage}} / {{cmd}} 由服务端给出，模板里不写死任何命令格式：
 *   - file：{{file.localPath}} 或未同步时的 fileId（取用命令见 usage）
 *   - url：{{url.href}}
 *   - task：{{task.seq}} / {{task.title}} / {{task.address}}
 *   - ref：{{ref.title}} / {{ref.relPath}}
 * 同步汇总单列在 syncSummary，不再用全局同步结果驱动单条附件。
 */
export const DEFAULT_ATTACH_TEMPLATE = [
  '{{#if attach}}',
  '〔附件〕本任务包含 {{attach.count}} 个附件（正文内嵌 {{attach.inlineCount}} · 附件区 {{attach.areaCount}}）。请先识别附件内容（图片先看图、文档先读内容）再开始处理，不要跳过附件。',
  '',
  '附件清单：',
  '{{#each attach.list}}',
  '  - [{{originLabel}}] {{kindLabel}} {{name}}{{#if sizeText}}（{{sizeText}}）{{/if}}：{{#if file}}{{#if file.exists}}{{file.localPath}}{{else}}未同步到本地（fileId {{file.fileId}}）{{/if}}{{/if}}{{#if url}}{{url.href}}{{/if}}{{#if task}}{{#if task.resolved}}#{{task.seq}} {{task.title}} · 地址 {{task.address}}（{{task.statusLabel}}）{{else}}地址 {{task.address}}（{{task.statusLabel}}）{{/if}}{{/if}}{{#if ref}}{{ref.title}}{{#if ref.relPath}}（{{ref.relPath}}）{{/if}}{{/if}}',
  '{{/each}}',
  '',
  '取用方式：',
  '{{#each attach.list}}',
  '  - {{kindLabel}} 《{{name}}》：{{usage}}',
  '{{/each}}',
  '{{#if attach.syncSummary}}',
  '同步情况：{{attach.syncSummary.text}}',
  '{{/if}}',
  '{{/if}}',
].join('\n');

/** 默认时间目标段：任务级给 check 指令，目录级给一行状态；都没有就不出现。 */
export const DEFAULT_TIMECHECK_TEMPLATE = [
  '{{#if goal.check}}',
  '{{goal.check}}',
  '{{/if}}',
  '{{#if goal.statusLine}}',
  '{{goal.statusLine}}',
  '{{/if}}',
].join('\n');

/**
 * 默认 ext（扩展 / 队列余量）：同主题还有多少待领取任务、分别是什么标题，
 * 并明确优先级。队列为空 → `ext` 为 null，整段不出现（{{#if ext.count}} 闸门）。
 */
export const DEFAULT_EXT_TEMPLATE = [
  '{{#if ext.count}}',
  '本队列（{{ext.topic}}）还有 {{ext.count}} 条待领取任务：',
  '{{#each ext.list}}',
  '  - #{{id}} {{title}}',
  '{{/each}}',
  '先完成当前任务，再领取下一条；不要因为后面还有活就提前收尾或分心。',
  '{{/if}}',
].join('\n');


/** 默认 ack：完成之后用 localtask done 回填结果（可见、可改）。 */
export const DEFAULT_ACK_PROMPT =
  '完成之后必须调用 nx-kv localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。';

/** 默认「持续 get」段：项目开启时把 getloop 文本透出来。 */
export const DEFAULT_GETLOOP_TEMPLATE = [
  '{{#if getloop}}',
  '{{getloop.text}}',
  '{{/if}}',
].join('\n');

/**
 * 区块清单（顺序 = 输出顺序）。只保留编排语义：
 * `tag` 是类 XML 标签名，`defaultTemplate` 是系统内置模板。
 */
export const BLOCK_DEFS = Object.freeze([
  {
    id: 'context',
    tag: 'nx-kv.context',
    label: '组 / 项目上下文',
    desc: '任务所在组、项目关键路径与参考文件；直接用 repo / group 变量拼装',
    defaultTemplate: DEFAULT_CONTEXT_TEMPLATE,
  },
  {
    id: 'attachment',
    tag: 'nx-kv.attachment',
    label: '附件识别',
    desc: '任务带附件时出现：数量 / 清单 / 本地路径',
    defaultTemplate: DEFAULT_ATTACH_TEMPLATE,
  },
  {
    id: 'timecheck',
    tag: 'nx-kv.timecheck',
    label: '时间目标检查',
    desc: '任务带时间目标时出现：check 指令或目录级状态',
    defaultTemplate: DEFAULT_TIMECHECK_TEMPLATE,
  },
  {
    id: 'ext',
    tag: 'nx-kv.ext',
    label: '待领取队列（ext）',
    desc: '同主题还有多少待领取任务与标题；队列空时不出现',
    defaultTemplate: DEFAULT_EXT_TEMPLATE,
  },
  {
    id: 'ack',
    tag: 'nx-kv.ack',
    label: 'ack 完成总结',
    desc: '完成任务时调用 localtask done 回填的指令；默认已内置，可见可改',
    defaultTemplate: DEFAULT_ACK_PROMPT,
  },
  {
    id: 'getloop',
    tag: 'nx-kv.getloop',
    label: '持续 get',
    desc: '项目开启「持续 get」时出现：完成本任务并回填后继续领取下一条',
    defaultTemplate: DEFAULT_GETLOOP_TEMPLATE,
  },
]);

export function blockDefOf(id) {
  return BLOCK_DEFS.find((d) => d.id === id) || null;
}

function clampTemplate(v) {
  const s = String(v ?? '').trim();
  return s.length > MAX_BLOCK_TEMPLATE_LEN ? s.slice(0, MAX_BLOCK_TEMPLATE_LEN) : s;
}

function builtinItemOf(def) {
  return {
    id: BUILTIN_TEMPLATE_ID,
    name: BUILTIN_TEMPLATE_NAME,
    template: def.defaultTemplate,
    builtin: true,
  };
}

/** 缺省：每个区块一份只含系统内置模板的列表（对象每次新建，避免共享引用）。 */
export function defaultBlockTemplateLists() {
  const out = {};
  for (const d of BLOCK_DEFS) {
    out[d.id] = { active: BUILTIN_TEMPLATE_ID, list: [builtinItemOf(d)] };
  }
  return out;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = String(raw.id ?? '').trim().slice(0, 64);
  if (!id) return null;
  const name = String(raw.name ?? '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
  return { id, name, template: clampTemplate(raw.template), builtin: false };
}

/**
 * 归一化「每区块模板列表」。
 *
 * 规则（服务端与前端共用，保证任何输入都收敛成可渲染结构）：
 *   - 每个区块的列表**始终包含**固定的系统内置条目（id `builtin`，内容 = 该区块默认模板）；
 *     输入里给内置条目自定义内容会被忽略——内置模板不可改、不可删。
 *   - 用户条目按 id 去重、丢弃非法项、超长截断、每块最多 `MAX_PROMPT_TEMPLATES` 条。
 *   - `active` 找不到对应条目（或指向已删除模板）→ 回落到 `builtin`。
 *
 * @param {object} raw `{ [blockId]: { active, list } }`（也接受 `{ [blockId]: [...] }`）
 * @returns {object} `{ [blockId]: { active, list } }`
 */
export function normalizeBlockTemplateLists(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const def of BLOCK_DEFS) {
    const br = src[def.id];
    const rawList = Array.isArray(br) ? br : Array.isArray(br?.list) ? br.list : [];
    const list = [builtinItemOf(def)];
    const seen = new Set([BUILTIN_TEMPLATE_ID]);
    for (const rawItem of rawList) {
      // 内置条目固定只有一条、内容固定为默认模板；输入里的自定义内置项直接忽略。
      if (rawItem && typeof rawItem === 'object' && (rawItem.id === BUILTIN_TEMPLATE_ID || rawItem.builtin)) continue;
      const t = normalizeItem(rawItem);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      list.push(t);
      if (list.length >= MAX_PROMPT_TEMPLATES) break;
    }
    const wanted = String(br?.active ?? '').trim();
    out[def.id] = {
      active: list.some((t) => t.id === wanted) ? wanted : BUILTIN_TEMPLATE_ID,
      list,
    };
  }
  return out;
}

/**
 * 解析出「每个区块当前生效的那条模板」（渲染链唯一入口）。
 * @param {object} raw `{ [blockId]: { active, list } }`
 * @returns {object} `{ [blockId]: { id, name, template, builtin } }`
 */
export function resolveBlockTemplates(raw) {
  const lists = normalizeBlockTemplateLists(raw);
  const out = {};
  for (const def of BLOCK_DEFS) {
    const b = lists[def.id];
    const item = b.list.find((t) => t.id === b.active) || b.list[0];
    out[def.id] = {
      id: item.id,
      name: item.name,
      template: item.template,
      builtin: !!item.builtin,
    };
  }
  return out;
}

/**
 * 把已渲染的段落包进根标签。parts: [{ id, tag, text }]（空 text 已由调用方滤掉）。
 * 没有可输出段落 → ''（调用方据此省略 instruction）。
 */
export function wrapXmlBlocks(parts) {
  const inner = (parts || [])
    .filter((p) => p && typeof p.text === 'string' && p.text.trim())
    .map((p) => `<${p.tag}>\n${p.text}\n</${p.tag}>`)
    .join('\n');
  return inner ? `<${XML_ROOT_TAG}>\n${inner}\n</${XML_ROOT_TAG}>` : '';
}
