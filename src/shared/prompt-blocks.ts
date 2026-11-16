// 提示词渲染共享定义（前后端共用，零依赖；这里只放数据与校验函数，引擎在 core）。
//
// **模型（v6，唯一基准方案 docs/research/prompt-plugin-single-route.md §2/§4）：**
//   - 模板真相在 DB（lt.blockTemplates），出厂快照在 modules/promptplug/Template/
//     blockTemplates.json（ensure 首启落库）。**本文件不再持有任何模板正文**——
//     内置文案的唯一出处是出厂快照，杜绝「常量 ≡ JSON ≡ DB」三角漂移。
//   - 整个渲染领域只有一个 ctx：所有区块模板都从同一份数据取值——
//     不存在「某模块自带一套变量域」。
//   - 每个区块（context / attachment / timecheck / goalhint / doneguard / ext / ack /
//     getloop）各自有一份独立的模板列表：
//     `blockTemplates[id] = { active, list: [{ id, name, template, builtin }] }`。
//   - 每个区块**始终恰好一条系统内置模板**（id 固定 `builtin`）：不可删除、不可改
//     （写路径拒绝改动 builtin——落库后 builtin 是真数据，读路径改写它就会出现
//     「库里存 A、渲染用 B」）。
//   - normalize 是**纯校验**（§4.1）：不合成、不补齐、不折算。缺段 / 缺 builtin /
//     重复 id / 超限都是事故，抛错；唯一的「修」是 active 指空 → 回落 builtin
//     （数据自愈，不是兼容）。
//   - 模板由 core/instruction-template.ts（Handlebars 4.x）渲染；列表变量是结构化数组，
//     用 `{{#each}}` 展开；有无用 `{{#if}}` 判断。另有一组内置 helper（比较 / 逻辑 /
//     数值 / 字符串 / 时间，见该文件的 HELPER_DEFS），失败输出可见的 NaN / false，不抛错。
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
 * 区块 id 清单（顺序 = 插件默认 order 位）。
 *
 * 唯一真相是插件数组（modules/promptplug/factory.ts 的 PLUGIN_IDS + 各插件 id）；
 * shared 零依赖拿不到 modules，这里只放**纯数据镜像**，一致性由
 * tests/unit/prompt-registry.test.mjs 对账（PROMPT_BLOCK_IDS ≡ 插件数组 id 序列）。
 */
export const PROMPT_BLOCK_IDS: readonly string[] = Object.freeze([
  'context', 'attachment', 'timecheck', 'goalhint', 'doneguard', 'ext', 'ack', 'getloop',
]);

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

/** 归一化后的「每区块模板列表」集合（恒产出全部 PROMPT_BLOCK_IDS 区块）。 */
export type BlockLists = Record<string, BlockTemplateList>;

function badShape(msg: string): Error {
  return new Error(`lt.blockTemplates 形状非法：${msg}`);
}

/** 校验一条用户条目；非法返回 null（直接丢弃不报错——保存路径另有白名单校验兜语义）。 */
function checkItem(raw: unknown, blockId: string): PromptTemplateItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = String(rec.id ?? '').trim().slice(0, 64);
  if (!id) return null;
  if (id === BUILTIN_TEMPLATE_ID) return null; // builtin 恒由校验单独处理，混进用户区即弃
  const name = String(rec.name ?? '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
  const template = String(rec.template ?? '');
  if (template.length > MAX_BLOCK_TEMPLATE_LEN) {
    throw badShape(`「${blockId}」条目 ${id} 的模板超过 ${MAX_BLOCK_TEMPLATE_LEN} 字上限`);
  }
  return { id, name, template, builtin: false };
}

/**
 * 校验「每区块模板列表」（**纯校验，不合成**——方案 §4.1）。
 *
 * 规则：
 *   - 输入必须是 `{ [blockId]: { active, list } }`，8 个 id 齐全；缺一个即抛出
 *     （说明库没被播种或被人为清空——属事故，不补齐）；
 *   - 列表里恰好一条 `builtin`（混在用户位置 / 缺失都抛）；builtin 的 template
 *     必须非空、≤8000 字；
 *   - 用户条目按 id 去重（重复抛）、每块 ≤ `MAX_PROMPT_TEMPLATES` 条（超限抛）；
 *   - `active` 指向不存在的条目 → 回落 `builtin`（唯一的回落，且不是兼容，是数据自愈）。
 * 未知区块键（如历史 rule）忽略。
 */
export function normalizeBlockTemplateLists(raw: unknown): BlockLists {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badShape('需要 { [blockId]: { active, list } } 对象');
  }
  const src = raw as Record<string, unknown>;
  const out: BlockLists = {};
  for (const blockId of PROMPT_BLOCK_IDS) {
    const br = src[blockId];
    if (!br || typeof br !== 'object' || Array.isArray(br)) {
      throw badShape(`缺区块「${blockId}」（8 段必须齐全，不补齐——先跑 ensurePromptTemplates 落库）`);
    }
    const rec = br as Record<string, unknown>;
    const rawList = rec.list;
    if (!Array.isArray(rawList)) {
      throw badShape(`「${blockId}」缺 list 数组`);
    }
    const builtin = rawList.find(
      (x) => x && typeof x === 'object' && (x as Record<string, unknown>).id === BUILTIN_TEMPLATE_ID,
    ) as Record<string, unknown> | undefined;
    if (!builtin) {
      throw badShape(`「${blockId}」缺内置条目 builtin（不可删除）`);
    }
    const builtinTpl = String(builtin.template ?? '');
    if (!builtinTpl.trim()) {
      throw badShape(`「${blockId}」内置模板为空（内置文本来自出厂快照，不允许为空）`);
    }
    if (builtinTpl.length > MAX_BLOCK_TEMPLATE_LEN) {
      throw badShape(`「${blockId}」内置模板超过 ${MAX_BLOCK_TEMPLATE_LEN} 字上限`);
    }
    const list: PromptTemplateItem[] = [
      {
        id: BUILTIN_TEMPLATE_ID,
        name: String(builtin.name ?? '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || BUILTIN_TEMPLATE_NAME,
        template: builtinTpl,
        builtin: true,
      },
    ];
    const seen = new Set<string>([BUILTIN_TEMPLATE_ID]);
    for (const rawItem of rawList) {
      if (rawItem && typeof rawItem === 'object' && (rawItem as Record<string, unknown>).builtin === true) continue;
      const t = checkItem(rawItem, blockId);
      if (!t) continue;
      if (seen.has(t.id)) throw badShape(`「${blockId}」条目 id 重复：${t.id}`);
      seen.add(t.id);
      list.push(t);
      if (list.length > MAX_PROMPT_TEMPLATES) {
        throw badShape(`「${blockId}」模板条数超过 ${MAX_PROMPT_TEMPLATES} 上限`);
      }
    }
    const wanted = String(rec.active ?? '').trim();
    out[blockId] = {
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
 * @param raw `{ [blockId]: { active, list } }`（先过 normalize 校验）
 */
export function resolveBlockTemplates(raw: unknown): Record<string, ResolvedBlockTemplate> {
  const lists = normalizeBlockTemplateLists(raw);
  const out: Record<string, ResolvedBlockTemplate> = {};
  for (const blockId of PROMPT_BLOCK_IDS) {
    const b = lists[blockId]!;
    const item = b.list.find((t) => t.id === b.active) ?? b.list[0]!;
    out[blockId] = {
      id: item.id,
      name: item.name,
      template: item.template,
      builtin: item.builtin,
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
