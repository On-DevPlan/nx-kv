// attachment 插件（order 20）：附件识别。
//
// 数据变换（attachTemplateCtx）留在 localtask/attach-template.ts —— 它依赖
// attach-resource 的标注工具链（kind 归一 / 可读性探测 / 取用命令），随插件搬会
// 牵动三处引用。插件消费宿主标注后的 attach 对象，**schema 逐字对齐它的真实形状**。
//
// ⚠️ 这里不能用 `z.array(z.looseObject({}))` 敷衍：schema 不只是「校验开关」，它是
// 变量目录的唯一来源（`GET /api/prompt/registry` 的 fields）——写成空对象，设置页就
// 再也说不出每个附件条目到底能引哪些变量，模板作者只能靠猜。
//
// 附件的真实形状是「一份公共清单字段 + 按 kind 分支的子对象」（见 attach-template.ts
// 的 ctxItemOf）：
//   file   → file{localPath,fileId,exists,syncCmd}        本机附件仓的盘上副本
//   url    → url{href,host}                               外部链接，直接抓取
//   task   → task{topicKey,seq,title,status,…,showCmd}    任务引用（不是副本，读最新正文）
//   ref    → ref{refId,title,desc,readCmd,content}        文档库实体（docs get --ref）
//   mdfile → mdfile{absPath,anchorDir,content,…,readCmd}  外部 .md 指针（docs mdfile）
//   folder → folder{absPath,exists,missing,readCmd}       本地目录指针（先列目录）
// 各 kind 的顶层同时平铺了子对象的字段（历史兼容：老模板写 {{localPath}} / {{href}}），
// 所以顶层用 discriminatedUnion + looseObject：kind 决定形状，未声明的扩展字段原样保留。
import { z } from 'zod';
import { PromptPlugin, supplied, type Supply, type TemplateText } from '../base.js';

/** 附件 kind（与 attach-resource.ts 的 baseKind 归一结果一致）。 */
export const ATTACH_KINDS = ['file', 'url', 'task', 'ref', 'mdfile', 'folder', 'repo'] as const;
/** 来源：正文内嵌 / 附件区（关系表 role 决定）。 */
export const ATTACH_ORIGINS = ['inline', 'area'] as const;

const kind = z.enum(ATTACH_KINDS);
/** 每条附件的类型说明（union 各分支共用同一句，去重后目录里能看到完整枚举）。 */
const KIND_DESC = '附件类型：file / url / task / ref / mdfile / folder / repo（决定子对象形状与取用命令）';
const origin = z.enum(ATTACH_ORIGINS);

/**
 * 每条附件都有的清单字段（ctxItemOf 的 item 部分，逐字对齐）。
 *
 * `origin` / `area` 是同义字段（area 是旧名），`kindLabel` / `originLabel` /
 * `sizeText` 是渲染用的人类可读串——模板里直接写 {{kindLabel}} 就行，不必自己拼。
 */
const baseItem = {
  id: z.string().describe('附件 id（kind=folder/mdfile 时也是 file content / docs mdfile 的入参）'),
  kind: kind.describe(KIND_DESC),
  kindLabel: z.string().describe('类型中文名：附件 / 图片 / 链接 / 任务 / 文档 / md / 文件夹'),
  isImage: z.boolean().describe('是否图片（仅 kind=file 且扩展名或 MIME 命中）'),
  name: z.string().describe('展示名（任务类为「#seq 标题」）'),
  size: z.number().describe('字节数（url/task/ref 为 0）'),
  sizeText: z.string().describe('人类可读体积（1.2 MB / 22 B；0 为空串）'),
  mime: z.string(),
  storage: z.string().describe('local（本机附件仓）/ external（磁盘原地）/ internal（库内实体）/ url'),
  role: z.string().describe('关系表角色：inline / reference / attach / doc'),
  origin,
  originLabel: z.string().describe('来源中文名：正文内嵌 / 附件区'),
  /** 旧字段名（= origin），老模板仍在用 */
  area: origin.describe('= origin（旧写法，正文内嵌 / 附件区）'),
  areaLabel: z.string(),
  usage: z.string().describe('取用方式（一句话 + 具体命令），直接可读给 agent'),
  cmd: z.string().describe('取用命令（有则给，url/file 可能为空）'),
  locator: z.string().describe('定位串（清单行末尾展示的「在哪」）'),
  needsSync: z.boolean().describe('是否需要额外同步（本机模型恒 false）'),
  note: z.string().describe('边上的说明（attach --note 的落点）'),
  mandatory: z.boolean().describe('#184：是否内部资源（task / ref / repo）——模板据此输出「必须访问」'),
  access: z.string().describe('#184：可执行的访问说明（内部资源强制访问用的具体命令）'),
  target: z.string(),
  targetKind: z.string(),
  targetKey: z.string(),
  targetSeq: z.number().nullable(),
};

/** kind=file：本机附件仓的盘上副本。**直接读 file.localPath**。 */
const fileItem = z.looseObject({
  ...baseItem,
  kind: z.literal('file').describe(KIND_DESC),
  localPath: z.string().describe('本机绝对路径（不存在时为空串，看 file.exists）'),
  fileId: z.string(),
  exists: z.boolean().describe('盘上是否真有这个文件'),
  syncCmd: z.string().describe('历史字段，恒为空串（本机附件没有同步这一步）'),
  path: z.string().describe('= localPath（旧写法）'),
  file: z.looseObject({
    localPath: z.string(),
    fileId: z.string(),
    exists: z.boolean(),
    syncCmd: z.string(),
  }).describe('本机文件视图：模板里用 {{#if file}}{{file.localPath}}{{/if}}'),
});

/** kind=url：外部链接，**直接抓 url.href**。 */
const urlItem = z.looseObject({
  ...baseItem,
  kind: z.literal('url').describe(KIND_DESC),
  href: z.string().describe('外部链接地址'),
  host: z.string().describe('host（从 href 解析，解析失败为空串）'),
  urlText: z.string().describe('= href（旧写法）'),
  url: z.looseObject({ href: z.string(), host: z.string() }).describe('链接视图：{{url.href}}'),
});

/** kind=task：任务引用（不是副本）。**用 task.showCmd 读最新正文**。 */
const taskItem = z.looseObject({
  ...baseItem,
  kind: z.literal('task').describe(KIND_DESC),
  taskId: z.number().describe('本地外键（任务搬家后不变；已被清理时为 0）'),
  topicKey: z.string(),
  topicName: z.string(),
  seq: z.number().describe('任务号（localtask show --id）'),
  title: z.string(),
  status: z.string().describe('pending / claimed / done / cancelled'),
  statusLabel: z.string().describe('状态中文名（清理后为「已清理」）'),
  address: z.string().describe('当前地址 topicKey:seq'),
  storedAddress: z.string().describe('登记时存下的地址（与 address 不同 = 地址漂移）'),
  addressDrift: z.boolean(),
  resolved: z.boolean().describe('能否读到目标任务（false = 已被清理）'),
  purged: z.boolean(),
  deleted: z.boolean().describe('目标任务是否已软删'),
  showCmd: z.string().describe('读最新正文的命令：nx-kv localtask show --id <seq> [--key <topicKey>]'),
  task: z.looseObject({
    taskId: z.number(),
    topicKey: z.string(),
    topicName: z.string(),
    seq: z.number(),
    title: z.string(),
    status: z.string(),
    statusLabel: z.string(),
    address: z.string(),
    storedAddress: z.string(),
    addressDrift: z.boolean(),
    resolved: z.boolean(),
    purged: z.boolean(),
    deleted: z.boolean(),
    showCmd: z.string(),
  }).describe('任务引用视图：{{#if task}}{{task.statusLabel}}{{/if}}'),
});

/** kind=ref：文档库实体（v7 起没有物理路径）。**用 ref.readCmd / refId 取正文**。 */
const refItem = z.looseObject({
  ...baseItem,
  kind: z.literal('ref').describe(KIND_DESC),
  refId: z.string().describe('文档 id（ref:xxxxxxxx）'),
  title: z.string().describe('文档标题（正文首行 # 标题，读不到时回落 desc / 文件名）'),
  desc: z.string(),
  readCmd: z.string().describe('读正文的命令：nx-kv docs get --ref <refId>'),
  content: z.string().describe('已内联的文档原文（role=doc 且读到全文时才有；可能为空）'),
  truncated: z.boolean().describe('内联原文是否被截断（超长时给命令自己取）'),
  ref: z.looseObject({
    refId: z.string(),
    title: z.string(),
    desc: z.string(),
    readCmd: z.string(),
    content: z.string(),
    truncated: z.boolean(),
  }).describe('文档视图：{{#if ref}}{{ref.content}}{{/if}}'),
});

/** kind=mdfile：外部 .md 文件指针。**用 mdfile.readCmd 读磁盘当前内容**。 */
const mdfileItem = z.looseObject({
  ...baseItem,
  kind: z.literal('mdfile').describe(KIND_DESC),
  absPath: z.string().describe('磁盘绝对路径'),
  anchorDir: z.string().describe('登记时的锚定目录（相对路径按它解析）'),
  path: z.string().describe('= absPath（旧写法）'),
  mdPath: z.string().describe('= absPath（旧写法）'),
  content: z.string().describe('已内联的磁盘正文（可能为空）'),
  truncated: z.boolean(),
  stale: z.boolean().describe('磁盘内容与登记指纹不一致'),
  missing: z.boolean().describe('文件当前不可读'),
  mdfile: z.looseObject({
    absPath: z.string(),
    anchorDir: z.string(),
    content: z.string(),
    truncated: z.boolean(),
    stale: z.boolean(),
    missing: z.boolean(),
    readCmd: z.string().describe('读磁盘内容的命令：nx-kv docs mdfile <id>'),
  }).describe('外部 md 视图：读正文用 {{mdfile.readCmd}}，内联正文在 {{mdfile.content}}'),
});

/** kind=folder：本地目录指针。**先列 absPath 目录，再读需要的文件**。 */
const folderItem = z.looseObject({
  ...baseItem,
  kind: z.literal('folder').describe(KIND_DESC),
  absPath: z.string().describe('目录绝对路径（先列这个目录，再读需要的文件）'),
  path: z.string().describe('= absPath（旧写法）'),
  exists: z.boolean(),
  missing: z.boolean(),
  folder: z.looseObject({
    absPath: z.string(),
    exists: z.boolean(),
    missing: z.boolean(),
    readCmd: z.string().describe('查看目录状态的命令：nx-kv file content <id>'),
  }).describe('目录视图：{{#if folder}}{{folder.absPath}}{{/if}}'),
});

/**
 * kind=repo：参考仓库附件（#184）。登记指针，字节在原 checkout。
 * **实现必须参考该仓库源码**：先 repo.getCmd 确认元数据，再列 repo.localPath、Read 关键文件；
 * 已整理文档用 repo.docCmd 列出后 docs get --ref 读取。
 */
const repoItem = z.looseObject({
  ...baseItem,
  kind: z.literal('repo').describe(KIND_DESC),
  repoKey: z.string().describe('仓库 key（如 github.com/org/name）'),
  repoName: z.string().describe('仓库名'),
  repoDesc: z.string().describe('仓库一句话描述'),
  repoType: z.string().describe('ref（参考仓库）/ dev（开发仓库）'),
  typeLabel: z.string().describe('类型中文名：参考仓库 / 开发仓库 / 仓库'),
  localPath: z.string().describe('checkout 的绝对路径（读源码从这里开始）'),
  path: z.string().describe('= localPath（旧写法）'),
  exists: z.boolean().describe('checkout 目录是否还在盘上'),
  missing: z.boolean().describe('checkout 不可用（目录不在或被标记缺失）'),
  branch: z.string().describe('当前分支（取不到为空串）'),
  docs: z.array(z.string()).describe('该仓库已整理的文档 refId 列表'),
  docCount: z.number().describe('已整理文档数'),
  getCmd: z.string().describe('确认仓库元数据的命令：nx-kv repo get --id <key>'),
  docCmd: z.string().describe('列出仓库文档的命令：nx-kv repo doc list --id <key>'),
  repo: z.looseObject({
    key: z.string(),
    name: z.string(),
    desc: z.string(),
    repoType: z.string(),
    typeLabel: z.string(),
    localPath: z.string(),
    exists: z.boolean(),
    missing: z.boolean(),
    branch: z.string(),
    docs: z.array(z.string()),
    docCount: z.number(),
    getCmd: z.string(),
    docCmd: z.string(),
    cmd: z.string().describe('= getCmd（模板里写 {{repo.cmd}} 确认元数据）'),
  }).describe('仓库视图：{{repo.localPath}} 读源码、{{repo.cmd}} 确认元数据'),
});

/** 一条附件：kind 决定形状（discriminatedUnion 给的是「kind 与字段必须自洽」这道闸）。 */
const attachItem = z
  .discriminatedUnion('kind', [fileItem, urlItem, taskItem, refItem, mdfileItem, folderItem, repoItem])
  .describe('附件条目：file / url / task / ref / mdfile / folder / repo，各有自己的子对象与取用命令');

const schema = z.strictObject({
  // strictObject 只钉顶层段键（attach）；attach 由宿主构造，段内形状见上。
  attach: z
    .looseObject({
      count: z.number().describe('附件总数'),
      inlineCount: z.number().describe('正文内嵌数量'),
      areaCount: z.number().describe('附件区数量'),
      hasInline: z.boolean(),
      hasArea: z.boolean(),
      mandatoryCount: z.number().describe('#184：内部资源（任务 / 文档 / 仓库）数量'),
      hasMandatory: z.boolean().describe('#184：是否存在必须访问的内部资源'),
      list: z.array(attachItem).describe('结构化清单：模板用 {{#each attach.list}} 展开'),
    })
    .nullable(),
});

/** 内置模板（#152：正文进代码）。 */
const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if attach}}
〔附件〕本任务包含 {{attach.count}} 个附件（正文内嵌 {{attach.inlineCount}} · 附件区 {{attach.areaCount}}）。{{#if attach.hasMandatory}}其中 {{attach.mandatoryCount}} 个是**系统内部资源**（任务 / 文档 / 仓库）——它们必须被实际访问：任务先读正文、文档先读全文、仓库先读源码并确认元数据；**未访问不得直接开始实现或交付**。{{else}}请先识别附件内容（图片先看图、文档先读内容、文件夹先列目录）再开始处理，不要跳过附件。{{/if}}

附件清单：
{{#each attach.list}}
  - [{{originLabel}}] {{kindLabel}} {{name}}{{#if sizeText}}（{{sizeText}}）{{/if}}：{{#if file}}{{#if file.exists}}{{file.localPath}}{{else}}未同步到本地（fileId {{file.fileId}}）{{/if}}{{/if}}{{#if url}}{{url.href}}{{/if}}{{#if task}}{{#if task.resolved}}#{{task.seq}} {{task.title}} · 地址 {{task.address}}（{{task.statusLabel}}）{{else}}地址 {{task.address}}（{{task.statusLabel}}）{{/if}}{{/if}}{{#if ref}}{{ref.title}}{{/if}}{{#if mdfile}}{{mdfile.absPath}}{{#if mdfile.missing}}（源文件已不在）{{/if}}{{/if}}{{#if folder}}{{folder.absPath}}{{#if folder.missing}}（目录已不在）{{/if}}{{/if}}{{#if repo}}{{repo.typeLabel}} {{repo.key}}{{#if repo.localPath}} · {{repo.localPath}}{{/if}}{{#if repo.missing}}（checkout 已不在）{{/if}}{{/if}}{{#if mandatory}}〔必须访问〕{{/if}}{{#if note}}  # {{note}}{{/if}}
{{/each}}
{{#if attach.hasMandatory}}
必须访问（内部资源，逐条执行，不得跳过）：
{{#each attach.list}}{{#if mandatory}}
  - {{kindLabel}}《{{name}}》：{{access}}
{{/if}}{{/each}}
{{/if}}

取用方式：
{{#each attach.list}}
  - {{kindLabel}} 《{{name}}》：{{usage}}
{{/each}}
{{#each attach.list}}{{#if mdfile}}{{#if mdfile.content}}〔外部 md · {{name}}〕（{{mdfile.absPath}}{{#if mdfile.truncated}}，已截断{{/if}}{{#if mdfile.stale}}，内容有变化{{/if}}）：

{{mdfile.content}}

{{/if}}{{/if}}{{/each}}
{{#each attach.list}}{{#if ref}}{{#if ref.content}}〔文档原文 · {{ref.title}}〕：

{{ref.content}}

{{/if}}{{/if}}{{/each}}
{{/if}}`,
};

export class AttachmentPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'attachment';
  readonly order = 20;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.attachment';
  readonly label = '附件识别';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  /** deps.attach：attachTemplateCtx(attachments).attach（无附件 → null）；可传函数惰性求值 */
  constructor(template: string, private readonly deps: { attach: Supply<unknown> }) {
    super(template);
  }

  protected async buildData() {
    return { attach: (await supplied(this.deps.attach) ?? null) as z.infer<typeof schema>['attach'] };
  }
}
