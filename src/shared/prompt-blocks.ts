// 提示词渲染共享定义（前后端共用，零依赖；这里只放数据与归一化函数，引擎在 core）。
//
// **模型（v5）：一份共享入参 + 每区块各自一份模板列表 + 薄编排。**
//   - 整个渲染领域只有一个 ctx（见 delivery-template 的 buildDeliveryCtx）：
//     `{ task, repo, group, attach, goal, getloop, source, summary, cwd, name, params }`。
//     所有区块模板都从这同一份数据取值——不存在「某模块自带一套变量域」。
//   - 每个区块（context / attachment / timecheck / goalhint / doneguard / ext / ack /
//     getloop）各自有一份独立的模板列表：
//     `blockTemplates[id] = { active, list: [{ id, name, template, builtin }] }`。
//     旧 rule 区块已合并进 ack（done 指令与收尾要求只留这一个出口）。
//     列表里可以新建、编辑、复制、删除，并由 `active` 指定该区块当前生效的模板。
//   - 每个区块**始终至少有一个系统内置模板**（id 固定 `builtin`）：不可删除，
//     内容固定为该区块的默认模板；用户模板删光后 active 自动回落到它。
//   - 模板由 core/instruction-template.ts（Handlebars 4.x）渲染；列表变量是结构化数组，
//     用 `{{#each}}` 展开；有无用 `{{#if}}` 判断。另有一组内置 helper（比较 / 逻辑 /
//     数值 / 字符串 / 时间，见该文件的 HELPER_DEFS），失败输出可见的 NaN / false，不抛错。
//   - 旧语法（`{{#repo}}…{{/repo}}` 闸门、`{{group.peers}}` 这类纯文本占位符、
//     `{{attach.sync}}` 旧别名）**不再兼容**；保存校验会直接拒绝并提示改用新语法。
//
// 区块标记是给 agent 读的「类 XML」分隔语法，不对正文做实体转义。

/** 追加模式条目。 */
export interface AppendMode {
  id: string;
  label: string;
  desc: string;
}

/** 追加模式：xml = 区块标记（默认）；plain = 老行为，按空行直接拼正文。 */
export const APPEND_MODES: readonly AppendMode[] = Object.freeze([
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
  '{{#if repo.intro}}',
  '〔项目介绍 · {{repo.name}}〕（{{repo.introPath}}）：',
  '{{repo.intro}}',
  '{{/if}}',
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
  '  - {{name}}：{{#if note}}{{note}}{{else}}（无组内描述）{{/if}}{{#if path}}（{{path}}）{{/if}}',
  '{{/each}}',
  '{{/if}}',
  '{{#if group.docs}}',
  '组绑定参考文件（可直接读取）：',
  '{{#each group.docs}}',
  '  - {{path}}{{#if tag}}  [{{tag}}]{{/if}}{{#if note}}  # {{note}}{{/if}}',
  '{{/each}}',
  '{{/if}}',
  '{{/if}}',
  '{{#if refRepos.count}}',
  '参考仓库（可直接读取，共 {{refRepos.count}} 个）：',
  '{{#each refRepos.list}}',
  '  - {{name}}{{#if path}}（{{path}}）{{/if}}{{#if note}}  # {{note}}{{/if}}',
  '{{/each}}',
  '{{/if}}',
].join('\n');

/**
 * 默认附件段模板：固定四段——总数 / 逐条清单 / 取用方式 / 文档原文。
 *
 * 类型由 ctx 里的 type 子对象驱动（file / url / task / ref），命令与说明通过
 * {{usage}} / {{cmd}} 由服务端给出，模板里不写死任何命令格式：
 *   - file：{{file.localPath}} 或未同步时的 fileId（取用命令见 usage）
 *   - url：{{url.href}}
 *   - task：{{task.seq}} / {{task.title}} / {{task.address}}
 *   - ref：{{ref.title}} / {{ref.relPath}}；{{ref.content}} 只有「文档资料」绑定
 *     （role=doc，#162：交付带全文，减少反复访问 nx-kv）且真的读到时非空，
 *     此时文末追加〔文档原文〕段——没有内容的条目该段自动消失。
 * 清单行的 {{note}} 是绑定上的 desc（attach --note）：agent 看一行就知道里面
 * 大概是什么，再决定是否真的去读。
 * 同步汇总单列在 syncSummary，不再用全局同步结果驱动单条附件。
 */
export const DEFAULT_ATTACH_TEMPLATE = [
  '{{#if attach}}',
  '〔附件〕本任务包含 {{attach.count}} 个附件（正文内嵌 {{attach.inlineCount}} · 附件区 {{attach.areaCount}}）。请先识别附件内容（图片先看图、文档先读内容）再开始处理，不要跳过附件。',
  '',
  '附件清单：',
  '{{#each attach.list}}',
  '  - [{{originLabel}}] {{kindLabel}} {{name}}{{#if sizeText}}（{{sizeText}}）{{/if}}：{{#if file}}{{#if file.exists}}{{file.localPath}}{{else}}未同步到本地（fileId {{file.fileId}}）{{/if}}{{/if}}{{#if url}}{{url.href}}{{/if}}{{#if task}}{{#if task.resolved}}#{{task.seq}} {{task.title}} · 地址 {{task.address}}（{{task.statusLabel}}）{{else}}地址 {{task.address}}（{{task.statusLabel}}）{{/if}}{{/if}}{{#if ref}}{{ref.title}}{{#if ref.relPath}}（{{ref.relPath}}）{{/if}}{{/if}}{{#if mdfile}}{{mdfile.absPath}}{{#if mdfile.missing}}（源文件已不在）{{/if}}{{/if}}{{#if note}}  # {{note}}{{/if}}',
  '{{/each}}',
  '',
  '取用方式：',
  '{{#each attach.list}}',
  '  - {{kindLabel}} 《{{name}}》：{{usage}}',
  '{{/each}}',
  '{{#if attach.syncSummary}}',
  '同步情况：{{attach.syncSummary.text}}',
  '{{/if}}',
  '{{#each attach.list}}{{#if mdfile}}{{#if mdfile.content}}〔外部 md · {{name}}〕（{{mdfile.absPath}}{{#if mdfile.truncated}}，已截断{{/if}}{{#if mdfile.stale}}，内容有变化{{/if}}）：',
  '',
  '{{mdfile.content}}',
  '',
  '{{/if}}{{/if}}{{/each}}',
  '{{#each attach.list}}{{#if ref}}{{#if ref.content}}〔文档原文 · {{ref.title}}〕（{{ref.relPath}}）：',
  '',
  '{{ref.content}}',
  '',
  '{{/if}}{{/if}}{{/each}}',
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
 * 默认「特殊功能提示」段（任务 #87，文案在 #90 里补全）：只在任务带时间目标时出现，
 * 给 agent 一份**可运算的**时间上下文（持续 / 已过 / 剩余 / 是否到点）与任务号，
 * 并按进度给阶段口径（过半提醒、2/3 收尾、到点收口）。
 *
 * 这一栏存在的意义是「占位符的可见入口」：goal.* 与 task.* 都是每轮 check 同源
 * 渲染的同一份 ctx（check 返回对象走同一套模板），用户在这里改文案即可定制提示，
 * 不必改代码。默认文案刻意不复述 check 指令（那在 timecheck 段里），只补状态与阶段。
 * 进度用内置 helper 现算（percent / gte），不新增 ctx 字段。
 */
export const DEFAULT_GOALHINT_TEMPLATE = [
  '{{#if goal.check}}',
  '〔特殊功能提示 · 时间目标〕任务 #{{task.id}} 正在计时：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），{{#if goal.reached}}已到点（超时 {{formatDuration goal.overtimeSec}}）{{else}}剩余 {{goal.remainingHuman}}{{/if}}。',
  '{{#if goal.reached}}——时间已到：可以收口，把改动收敛成可交付状态，补验证与说明后按 ack 段 done。',
  '{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}——已过 2/3：进入收尾整理（收敛改动 / 补验证 / 写清遗留），别开新战线。',
  '{{else}}{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}——已过半：先确认主线走到哪，剩余时间只做收尾必需项。',
  '{{else}}——时间尚足：先做主线，再补细节。{{/if}}{{/if}}{{/if}}',
  '{{/if}}',
].join('\n');

/**
 * 默认「完成门禁提示」段（#90）：agent 未到点就想 `localtask done` 时**代替**原来那句
 * 固定 hint 出现在 blocked 返回里。与其它区块同源：模板可改、变量是 goal.* / task.*，
 * 并能用 helper 按进度给不同口径。`goal.blocked` 只在这条路径上为真，交付渲染时整段省略。
 */
export const DEFAULT_DONEGUARD_TEMPLATE = [
  '{{#if goal.blocked}}',
  '〔完成门禁 · 时间未到〕任务 #{{task.id}} 还不能 done：持续 {{goal.durationHuman}}，已过 {{goal.elapsedHuman}}（{{percent goal.elapsedSec goal.durationSec}}%），剩余 {{goal.remainingHuman}}。',
  '- 现在可做：{{#if (gte (percent goal.elapsedSec goal.durationSec) 67)}}收尾整理（收敛改动 / 补验证 / 写清遗留），或派 sub agent 提出新的需求继续推进{{else}}继续推进主线，并派 sub agent 重新提出新的需求{{/if}}。',
  '- 每轮推进先跑：nx-kv timegoal check --task {{goal.goalKey}} --summary "<本轮现状>"',
  '- 到点后再：nx-kv localtask done --id {{task.id}} --summary "<完成总结>"',
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
 * 默认「持续 get」**内文**（持续 get 区块模板外壳里的那一句指令）。
 *
 * 两层的分工，别混：
 *   - 外壳 = 区块模板（`DEFAULT_GETLOOP_TEMPLATE`，在设置 → 提示词模板 → 持续 get 区块里编辑），
 *     它只负责 `{{getloop.text}}` 的输出位置；
 *   - 内文 = 本模板（项目级的「继续 get 直到超时」指令，可按仓库覆写多条）。
 *
 * 放共享层是因为**前后端都要用同一份文案**：服务端渲染内文，前端「持续 get」配置弹窗
 * 把它当内置默认展示（此前前端另存了一份已经过期的副本，两边文案会悄悄分叉）。
 * 槽位口径：{{task.id}} = 任务编号（前端展示时转成 %s，保存时转回）；{{getloop.waitMinutes}}
 * = 阻塞窗口分钟数。
 */
export const DEFAULT_GETLOOP_INSTRUCTION =
  '{{#if task}}不要直接结束本轮：完成上面的任务（{{task.id}}）之后，继续调用 nx-kv localtask get 领取下一条任务。队列里有活会立即返回；没活时每次最多阻塞 {{getloop.waitMinutes}} 分钟，直到 get 返回 timeout 为止。{{/if}}';

/** 单条区块模板条目。 */
export interface PromptTemplateItem {
  id: string;
  name: string;
  template: string;
  builtin: boolean;
}

/** 每区块的模板列表：active 指向当前生效条目。 */
export interface BlockTemplateList {
  active: string;
  list: PromptTemplateItem[];
}

/** 区块定义：tag 是类 XML 标签名，defaultTemplate 是系统内置模板。 */
export interface BlockDef {
  id: string;
  tag: string;
  label: string;
  desc: string;
  defaultTemplate: string;
}

/**
 * 区块清单（顺序 = 输出顺序）。只保留编排语义：
 * `tag` 是类 XML 标签名，`defaultTemplate` 是系统内置模板。
 */
export const BLOCK_DEFS: readonly BlockDef[] = Object.freeze([
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
    id: 'goalhint',
    tag: 'nx-kv.goalhint',
    label: '特殊功能提示（timegoal）',
    desc: '任务带时间目标时出现：可直接用 goal.* 时间变量与 task 全文占位；每轮 check 同源渲染',
    defaultTemplate: DEFAULT_GOALHINT_TEMPLATE,
  },
  {
    id: 'doneguard',
    tag: 'nx-kv.doneguard',
    label: '完成门禁提示（timegoal）',
    desc: 'agent 未到点就想 done 时出现（blocked 返回的 guard）：说明剩余时间与可做事项，可用 helper 按进度分档',
    defaultTemplate: DEFAULT_DONEGUARD_TEMPLATE,
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

export function blockDefOf(id: string): BlockDef | null {
  return BLOCK_DEFS.find((d) => d.id === id) || null;
}

function clampTemplate(v: unknown): string {
  const s = String(v ?? '').trim();
  return s.length > MAX_BLOCK_TEMPLATE_LEN ? s.slice(0, MAX_BLOCK_TEMPLATE_LEN) : s;
}

function builtinItemOf(def: BlockDef): PromptTemplateItem {
  return {
    id: BUILTIN_TEMPLATE_ID,
    name: BUILTIN_TEMPLATE_NAME,
    template: def.defaultTemplate,
    builtin: true,
  };
}

/** 缺省：每个区块一份只含系统内置模板的列表（对象每次新建，避免共享引用）。 */
export function defaultBlockTemplateLists(): Record<string, BlockTemplateList> {
  const out: Record<string, BlockTemplateList> = {};
  for (const d of BLOCK_DEFS) {
    out[d.id] = { active: BUILTIN_TEMPLATE_ID, list: [builtinItemOf(d)] };
  }
  return out;
}

function normalizeItem(raw: unknown): PromptTemplateItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? '').trim().slice(0, 64);
  if (!id) return null;
  const name = String(rec.name ?? '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
  return { id, name, template: clampTemplate(rec.template), builtin: false };
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
 * @param raw `{ [blockId]: { active, list } }`（也接受 `{ [blockId]: [...] }`）
 */
export function normalizeBlockTemplateLists(raw: unknown): Record<string, BlockTemplateList> {
  const src: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, BlockTemplateList> = {};
  for (const def of BLOCK_DEFS) {
    const br = src[def.id];
    const brRec = br && typeof br === 'object' && !Array.isArray(br) ? (br as Record<string, unknown>) : null;
    const rawList: unknown[] = Array.isArray(br) ? br : Array.isArray(brRec?.list) ? (brRec.list as unknown[]) : [];
    const list: PromptTemplateItem[] = [builtinItemOf(def)];
    const seen = new Set<string>([BUILTIN_TEMPLATE_ID]);
    for (const rawItem of rawList) {
      // 内置条目固定只有一条、内容固定为默认模板；输入里的自定义内置项直接忽略。
      if (rawItem && typeof rawItem === 'object' && ((rawItem as Record<string, unknown>).id === BUILTIN_TEMPLATE_ID || (rawItem as Record<string, unknown>).builtin)) continue;
      const t = normalizeItem(rawItem);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      list.push(t);
      if (list.length >= MAX_PROMPT_TEMPLATES) break;
    }
    const wanted = String(brRec?.active ?? '').trim();
    out[def.id] = {
      active: list.some((t) => t.id === wanted) ? wanted : BUILTIN_TEMPLATE_ID,
      list,
    };
  }
  return out;
}

/** 每区块当前生效的那条模板（渲染链唯一入口）。 */
export interface ResolvedBlockTemplate {
  id: string;
  name: string;
  template: string;
  builtin: boolean;
}

/**
 * 解析出「每个区块当前生效的那条模板」（渲染链唯一入口）。
 * @param raw `{ [blockId]: { active, list } }`
 */
export function resolveBlockTemplates(raw: unknown): Record<string, ResolvedBlockTemplate> {
  const lists = normalizeBlockTemplateLists(raw);
  const out: Record<string, ResolvedBlockTemplate> = {};
  for (const def of BLOCK_DEFS) {
    const b = lists[def.id];
    if (!b) continue;
    const item = b.list.find((t) => t.id === b.active) ?? b.list[0];
    if (!item) continue;
    out[def.id] = {
      id: item.id,
      name: item.name,
      template: item.template,
      builtin: !!item.builtin,
    };
  }
  return out;
}

/** XML 区块段：tag 为标签名，text 为已渲染正文（空 text 由调用方滤掉）。 */
export interface XmlBlockPart {
  id?: string;
  tag: string;
  text: string;
}

/**
 * 把已渲染的段落包进根标签。parts: [{ id, tag, text }]（空 text 已由调用方滤掉）。
 * 没有可输出段落 → ''（调用方据此省略 instruction）。
 */
export function wrapXmlBlocks(parts?: readonly (XmlBlockPart | null | undefined)[] | null): string {
  const inner = (parts || [])
    .filter((p): p is XmlBlockPart => !!p && typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => `<${p.tag}>\n${p.text}\n</${p.tag}>`)
    .join('\n');
  return inner ? `<${XML_ROOT_TAG}>\n${inner}\n</${XML_ROOT_TAG}>` : '';
}
