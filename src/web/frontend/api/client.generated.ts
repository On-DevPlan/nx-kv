// AUTO-GENERATED —— 由 scripts/gen-api-client.mjs（runtime/codegen.ts）生成，勿手改。
//
// 类型来自 zod schema（import type，zod 运行时不进浏览器包）；运行时校验在服务端
//（runtime/zod-bridge.ts，CLI 与 HTTP 共用同一份 schema）。传输层是手写的那一半：
// 调 createApiClient 时传入 api/client.ts 的 api() 即可。
// 重新生成：pnpm gen:api。新鲜度由 tests/unit/api-client.test.mjs 对账。

import type { z } from 'zod';
import type {
  authLoginInput,
} from '../../../modules/auth/schemas.js';
import type {
  bundledGetInput,
  bundledInstallInput,
} from '../../../modules/bundled/schemas.js';
import type {
  docAddInput,
  docAttachInput,
  docAttachNoteInput,
  docAttachmentsInput,
  docDetachInput,
  docGetInput,
  docListInput,
  docRemoveInput,
  docUpdateInput,
  docsBindInput,
  docsLinkInput,
  docsNotebindInput,
  docsSeedInput,
} from '../../../modules/docs/schemas.js';
import type {
  fileContentInput,
  fileGetInput,
  fileListInput,
  filePruneInput,
  fileRemoveInput,
  fileSyncInput,
  fileUploadInput,
} from '../../../modules/file/schemas.js';
import type {
  localtaskAddInput,
  localtaskAttachInput,
  localtaskAttachNoteInput,
  localtaskAttachmentsInput,
  localtaskCancelInput,
  localtaskCancelManyInput,
  localtaskChainInput,
  localtaskClaimInput,
  localtaskCloneInput,
  localtaskCloseManyInput,
  localtaskConfigInput,
  localtaskDetachInput,
  localtaskDoneInput,
  localtaskEventsInput,
  localtaskForkInput,
  localtaskGetInput,
  localtaskImportRemoteInput,
  localtaskPreviewInput,
  localtaskPruneInput,
  localtaskRemoveInput,
  localtaskRemoveManyInput,
  localtaskReopenInput,
  localtaskReorderInput,
  localtaskTaskRestoreInput,
  localtaskTimegoalLogInput,
  localtaskTopicAddInput,
  localtaskTopicRemoveInput,
  localtaskTopicRemoveManyInput,
  localtaskUpdateInput,
  taskMoveInput,
} from '../../../modules/localtask/schemas.js';
import type {
  boardAddInput,
  boardAssignInput,
  boardGetInput,
  boardImportInput,
  boardNoteInput,
  boardPrefixInput,
  boardPruneInput,
  boardRekeyInput,
  boardRemoveInput,
  boardUpdateInput,
  repoAddInput,
  repoBindInput,
  repoBindTopicsInput,
  repoCloneInput,
  repoDetectInput,
  repoDocAddInput,
  repoDocListInput,
  repoDocRemoveInput,
  repoExportInput,
  repoGetInput,
  repoImportDiffInput,
  repoImportInput,
  repoKeyMigrateInput,
  repoKeyRefreshInput,
  repoKeySetInput,
  repoKnowledgeInput,
  repoListInput,
  repoOpenInput,
  repoRefAddInput,
  repoRefCloneInput,
  repoRefNoteInput,
  repoRefOfInput,
  repoRefSyncInput,
  repoRemoteCheckInput,
  repoRemoteInput,
  repoRemoteListInput,
  repoRemotePickInput,
  repoRemoveInput,
  repoScanInput,
  repoUpdateInput,
} from '../../../modules/repos/schemas.js';
import type {
  settingSetInput,
} from '../../../modules/setting/schemas.js';
import type {
  timegoalCheckInput,
  timegoalClearInput,
  timegoalLogInput,
  timegoalSetInput,
  timegoalShowInput,
  timegoalUpdateInput,
} from '../../../modules/tasktool/schemas.js';
import type {
  templatesAddInput,
  templatesDefaultInput,
  templatesListInput,
  templatesRemoveInput,
  templatesUpdateInput,
} from '../../../modules/templates/schemas.js';
import type {
  groupAddInput,
  groupGetInput,
  groupMembersInput,
  groupRemoveInput,
  groupUpdateInput,
  groupUseInput,
  promptGetInput,
  promptRemoveInput,
  promptSetInput,
  todoAddInput,
  todoArchiveInput,
  todoAttachInput,
  todoAttachmentsInput,
  todoDoneInput,
  todoFreezeInput,
  todoGetInput,
  todoListInput,
  todoRemoveInput,
  todoUnfreezeInput,
  todoUpdateInput,
  topicAddInput,
  topicListInput,
  topicRemoveInput,
} from '../../../modules/todo/schemas.js';
import type {
  AuthLoginAction,
  AuthLogoutAction,
  AuthMeAction,
  AuthStatusAction,
} from '../../../modules/auth/actions/_manifest.generated.js';
import type {
  BundledGetAction,
  BundledGroupsAction,
  BundledInstallAction,
  BundledListAction,
} from '../../../modules/bundled/actions/_manifest.generated.js';
import type {
  DocAddAction,
  DocAttachAction,
  DocAttachNoteAction,
  DocAttachmentsAction,
  DocDetachAction,
  DocGetAction,
  DocListAction,
  DocRemoveAction,
  DocUpdateAction,
  DocsBindAction,
  DocsIndexAction,
  DocsLinkAction,
  DocsNotebindAction,
  DocsSeedAction,
} from '../../../modules/docs/actions/_manifest.generated.js';
import type {
  FileContentAction,
  FileGetAction,
  FileListAction,
  FileOrphansAction,
  FilePruneAction,
  FileRemoveAction,
  FileSyncAction,
  FileUploadAction,
} from '../../../modules/file/actions/_manifest.generated.js';
import type {
  LocaltaskAddAction,
  LocaltaskAttachAction,
  LocaltaskAttachNoteAction,
  LocaltaskAttachmentsAction,
  LocaltaskCancelAction,
  LocaltaskCancelManyAction,
  LocaltaskChainAction,
  LocaltaskClaimAction,
  LocaltaskCloneAction,
  LocaltaskCloseManyAction,
  LocaltaskConfigAction,
  LocaltaskDetachAction,
  LocaltaskDoneAction,
  LocaltaskEventsAction,
  LocaltaskForkAction,
  LocaltaskGetAction,
  LocaltaskImportRemoteAction,
  LocaltaskListAction,
  LocaltaskPresenceAction,
  LocaltaskPreviewAction,
  LocaltaskPruneAction,
  LocaltaskRemoveAction,
  LocaltaskRemoveManyAction,
  LocaltaskReopenAction,
  LocaltaskReorderAction,
  LocaltaskTaskRestoreAction,
  LocaltaskTimegoalLogAction,
  LocaltaskTopicAddAction,
  LocaltaskTopicRemoveAction,
  LocaltaskTopicRemoveManyAction,
  LocaltaskUpdateAction,
  TaskMoveAction,
} from '../../../modules/localtask/actions/_manifest.generated.js';
import type {
  BoardAddAction,
  BoardAssignAction,
  BoardExportAction,
  BoardGetAction,
  BoardImportAction,
  BoardListAction,
  BoardNoteAction,
  BoardPrefixAction,
  BoardPruneAction,
  BoardRekeyAction,
  BoardRemoveAction,
  BoardUpdateAction,
  RepoAddAction,
  RepoBindAction,
  RepoBindTopicsAction,
  RepoCloneAction,
  RepoDetectAction,
  RepoDocAddAction,
  RepoDocListAction,
  RepoDocRemoveAction,
  RepoExportAction,
  RepoGetAction,
  RepoImportAction,
  RepoImportDiffAction,
  RepoKeyMigrateAction,
  RepoKeyRefreshAction,
  RepoKeySetAction,
  RepoKnowledgeAction,
  RepoListAction,
  RepoOpenAction,
  RepoRefAddAction,
  RepoRefCheckAction,
  RepoRefCloneAction,
  RepoRefNoteAction,
  RepoRefOfAction,
  RepoRefSyncAction,
  RepoRemoteAction,
  RepoRemoteCheckAction,
  RepoRemoteListAction,
  RepoRemotePickAction,
  RepoRemoveAction,
  RepoScanAction,
  RepoUpdateAction,
} from '../../../modules/repos/actions/_manifest.generated.js';
import type {
  SettingGetAction,
  SettingSetAction,
} from '../../../modules/setting/actions/_manifest.generated.js';
import type {
  BootstrapAction,
  HealthAction,
} from '../../../modules/system/actions/_manifest.generated.js';
import type {
  TimegoalCheckAction,
  TimegoalClearAction,
  TimegoalListAction,
  TimegoalLogAction,
  TimegoalPruneAction,
  TimegoalSetAction,
  TimegoalShowAction,
  TimegoalUpdateAction,
} from '../../../modules/tasktool/actions/_manifest.generated.js';
import type {
  TemplatesAddAction,
  TemplatesDefaultAction,
  TemplatesListAction,
  TemplatesRemoveAction,
  TemplatesUpdateAction,
} from '../../../modules/templates/actions/_manifest.generated.js';
import type {
  GroupAddAction,
  GroupCurrentAction,
  GroupGetAction,
  GroupListAction,
  GroupMembersAction,
  GroupRemoveAction,
  GroupUpdateAction,
  GroupUseAction,
  PromptGetAction,
  PromptRemoveAction,
  PromptSetAction,
  TodoAddAction,
  TodoArchiveAction,
  TodoAttachAction,
  TodoAttachmentsAction,
  TodoDoneAction,
  TodoFreezeAction,
  TodoGetAction,
  TodoListAction,
  TodoRemoveAction,
  TodoUnfreezeAction,
  TodoUpdateAction,
  TopicAddAction,
  TopicListAction,
  TopicRemoveAction,
} from '../../../modules/todo/actions/_manifest.generated.js';

/** 传输层契约（手写的那一半）：返回 data（错误信封由 api() 拆好，失败即 throw）。 */
export interface Transport {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

export interface ApiClient {
/** 聚合上下文：版本 / 登录态 / 工作空间 / 命令表 */
  bootstrap(): Promise<Awaited<ReturnType<InstanceType<typeof BootstrapAction>['run']>>>;
/** 健康检查（本机配置 + 后端可达性） */
  health(): Promise<Awaited<ReturnType<InstanceType<typeof HealthAction>['run']>>>;
/** 读本机设置（附件自动下载、附件目录、参考仓库存储根） */
  get(): Promise<Awaited<ReturnType<InstanceType<typeof SettingGetAction>['run']>>>;
/** 改本机设置（只改传入项） */
  set(input?: z.input<typeof settingSetInput>): Promise<Awaited<ReturnType<InstanceType<typeof SettingSetAction>['run']>>>;
/** 登录并保存 token 到本机配置 */
  login(input: z.input<typeof authLoginInput>): Promise<Awaited<ReturnType<InstanceType<typeof AuthLoginAction>['run']>>>;
/** 清除本机保存的 token */
  logout(): Promise<Awaited<ReturnType<InstanceType<typeof AuthLogoutAction>['run']>>>;
/** 向后端确认身份（验证 token 是否仍有效） */
  me(): Promise<Awaited<ReturnType<InstanceType<typeof AuthMeAction>['run']>>>;
/** 查看本机登录态（不请求后端，离线可用） */
  status(): Promise<Awaited<ReturnType<InstanceType<typeof AuthStatusAction>['run']>>>;
/** 新建看板（主题容器） */
  add(input: z.input<typeof boardAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardAddAction>['run']>>>;
/** 把仓库聚合进看板（可同时在多个看板；--remove 移出；--before 插位；仓库给 id / key / 路径） */
  assign(input: z.input<typeof boardAssignInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardAssignAction>['run']>>>;
/** 导出看板 JSON（可回灌给 board import） */
  export(): Promise<Awaited<ReturnType<InstanceType<typeof BoardExportAction>['run']>>>;
/** 查看单个看板（含成员仓库与描述） */
  boardGet(input: z.input<typeof boardGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardGetAction>['run']>>>;
/** 导入看板 JSON（一个看板 = 一个主题；按 path/name 匹配已登记仓库） */
  import(input?: z.input<typeof boardImportInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardImportAction>['run']>>>;
/** 看板清单：每个主题里有哪些仓库、各自的一句话描述 */
  list(): Promise<Awaited<ReturnType<InstanceType<typeof BoardListAction>['run']>>>;
/** 写/清组内描述：仓库在看板里的角色与配合关系（--note 留空 = 清除；仓库给 id / key / 绝对路径） */
  note(input: z.input<typeof boardNoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardNoteAction>['run']>>>;
/** 按前缀归组：把名字以 <prefix> 开头的仓库一次性挂进看板（--board 给目标看板；不给就按前缀名自动建同名看板） */
  prefix(input: z.input<typeof boardPrefixInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardPrefixAction>['run']>>>;
/** 清理占位成员：组里引用、本机没登记且没有远程地址的仓库（默认预览，--apply 落盘；带 remote 的加 --all 才清） */
  prune(input?: z.input<typeof boardPruneInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardPruneAction>['run']>>>;
/** 把组里的占位 key 重绑到本机仓库（关系改、登记不动；组内描述与文档绑定跟着搬） */
  rekey(input: z.input<typeof boardRekeyInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardRekeyAction>['run']>>>;
/** 删看板（里面的仓库回到未分组，登记不动） */
  remove(input: z.input<typeof boardRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardRemoveAction>['run']>>>;
/** 改看板名称 / 描述 */
  update(input: z.input<typeof boardUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof BoardUpdateAction>['run']>>>;
/** 登记一个仓库 */
  repoAdd(input: z.input<typeof repoAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoAddAction>['run']>>>;
/** 把「未绑定」队列按路径前缀绑到真实仓库（先建 refs 再绑；默认预览，--apply 落盘） */
  bindTopics(input?: z.input<typeof repoBindTopicsInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoBindTopicsAction>['run']>>>;
/** 绑定参考仓库到组或单个开发仓库（两类并存；--board 组级、--repo 仓库级；--remove 摘除） */
  bind(input: z.input<typeof repoBindInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoBindAction>['run']>>>;
/** 按 remote 克隆并登记（--key 指定占位 key → 组里位置自动补齐） */
  clone(input: z.input<typeof repoCloneInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoCloneAction>['run']>>>;
/** 探测目录的 git remote（添加仓库前自动填充远程地址；只读） */
  detect(input: z.input<typeof repoDetectInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoDetectAction>['run']>>>;
/** 给项目加一篇介绍文档：--rel 自有树路径 / --path 外部绝对路径 / --ref <参考仓库key> --file <仓库内相对路径>（同 rel/path 重复添加 = 更新） */
  docAdd(input: z.input<typeof repoDocAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoDocAddAction>['run']>>>;
/** 列出项目的介绍文档集（主篇 + 其余各篇，含来源形态：自有树 / 外部 / ref 仓库） */
  docList(input: z.input<typeof repoDocListInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoDocListAction>['run']>>>;
/** 从项目的介绍文档集里摘掉一篇（--index 从 1 起，1 = 主篇） */
  docRemove(input: z.input<typeof repoDocRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoDocRemoveAction>['run']>>>;
/** 导出仓库布局 JSON（全局 key + 分组 + 参考关系；不含本地路径）；--zip 打包成 zip */
  repoExport(input?: z.input<typeof repoExportInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoExportAction>['run']>>>;
/** 查看单个仓库的登记信息 */
  repoGet(input: z.input<typeof repoGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoGetAction>['run']>>>;
/** 导入前的差异检查：逐条给出 新增/有差异/一致/本地未拥有（零副作用） */
  diff(input?: z.input<typeof repoImportDiffInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoImportDiffAction>['run']>>>;
/** 导入仓库布局（--strategy ours|overwrite|duplicate；--select 按 key 挑；--clone 选克隆范围） */
  repoImport(input?: z.input<typeof repoImportInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoImportAction>['run']>>>;
/** 把内部关系（看板成员/绑定）从随机 id 改写成 key（幂等；--apply 落盘） */
  migrate(input?: z.input<typeof repoKeyMigrateInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoKeyMigrateAction>['run']>>>;
/** 刷新仓库 key：扫描 git remote（SSH 优先），提示可更新的 key/远程地址；--apply 落盘 */
  refresh(input?: z.input<typeof repoKeyRefreshInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoKeyRefreshAction>['run']>>>;
/** 设置自定义 key（全局唯一，不跟随远程地址自动变）；--follow 恢复为跟随 remote */
  keySet(input: z.input<typeof repoKeySetInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoKeySetAction>['run']>>>;
/** 取仓库完整知识：项目介绍 + 所属组（介绍/组内描述/绑定文档）+ 参考仓库（--md 拼成单篇 markdown；缺省当前目录） */
  knowledge(input?: z.input<typeof repoKnowledgeInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoKnowledgeAction>['run']>>>;
/** 仓库清单（本地任务的主题会按路径匹配到这里，取它的上下文） */
  repoList(input?: z.input<typeof repoListInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoListAction>['run']>>>;
/** 在系统文件管理器中打开 */
  open(input: z.input<typeof repoOpenInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoOpenAction>['run']>>>;
/** 把一个已存在的 checkout 登记为参考仓库（不 clone；remote 缺省读 origin） */
  refAdd(input: z.input<typeof repoRefAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefAddAction>['run']>>>;
/** 检查参考仓库完整性：目录/.git/origin 一致性 + 组级/仓库级绑定死链（零副作用） */
  check(): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefCheckAction>['run']>>>;
/** 克隆远程仓库为参考仓库（落到 gitRepoRoot，登记 + 可选绑定当前目录的开发仓库） */
  refClone(input: z.input<typeof repoRefCloneInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefCloneAction>['run']>>>;
/** 写/清绑定描述：这个参考在该组/该仓库里参考什么（--note 留空 = 清除） */
  refNote(input: z.input<typeof repoRefNoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefNoteAction>['run']>>>;
/** 查某仓库（缺省当前目录）的参考仓库：直接绑定到本仓库的 + 所属组绑定的，两类并列 */
  of(input?: z.input<typeof repoRefOfInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefOfAction>['run']>>>;
/** 同步参考仓库（git pull --ff-only；--all 同步全部） */
  sync(input?: z.input<typeof repoRefSyncInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRefSyncAction>['run']>>>;
/** 检查 remote 是否存在（git ls-remote：存在 / 不存在 / 不可达，三种结论分清） */
  remoteCheck(input?: z.input<typeof repoRemoteCheckInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRemoteCheckAction>['run']>>>;
/** 列出仓库的全部 remote 候选（git remote -v），标出当前采纳的那条 */
  remoteList(input?: z.input<typeof repoRemoteListInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRemoteListAction>['run']>>>;
/** 人工指定采纳哪条 remote（key 随之重算；自定义 key 不动） */
  pick(input: z.input<typeof repoRemotePickInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRemotePickAction>['run']>>>;
/** 登记/更新仓库的远程 git 地址（无 --url = 从目录 origin 读取存档并重算 key） */
  remote(input: z.input<typeof repoRemoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRemoteAction>['run']>>>;
/** 移除登记（不动磁盘文件） */
  repoRemove(input: z.input<typeof repoRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoRemoveAction>['run']>>>;
/** 扫描目录发现 git 仓库；--dry-run 只列出（发现模式，不登记） */
  scan(input?: z.input<typeof repoScanInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoScanAction>['run']>>>;
/** 修改仓库路径 / 名称 / 备注 / 类型 / 远程地址 / key；--get-loop* 配置项目级「持续 get」（waitgoal：该项目 get 无任务时阻塞等人回填 + 交付文本带继续 get 模板）。描述已改为文档，不再经这里改 */
  repoUpdate(input: z.input<typeof repoUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof RepoUpdateAction>['run']>>>;
/** 新建自有文档（--body 给 Markdown 正文；--body-file <文件> / - 读管道；已存在则报冲突） */
  docAdd2(input: z.input<typeof docAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocAddAction>['run']>>>;
/** 改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变） */
  attachNote(input: z.input<typeof docAttachNoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocAttachNoteAction>['run']>>>;
/** 给文档挂资源：--path / --fileId / --url / --task / --doc 之一；默认追加进正文，--no-embed 只挂附件区（不写正文） */
  attach(input: z.input<typeof docAttachInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocAttachAction>['run']>>>;
/** 这篇文档用了哪些资源（ref_attach：图片/文件/URL/内部 task、ref 引用） */
  attachments(input: z.input<typeof docAttachmentsInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocAttachmentsAction>['run']>>>;
/** 解除文档与附件的关系（默认只解除关系）；--purge 无人引用时连资源行与本机字节一起删 */
  detach(input: z.input<typeof docDetachInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocDetachAction>['run']>>>;
/** 读文档全文：rel:<路径>（或裸相对路径）= 自有；path:<绝对路径> = 外部（须在绑定闭包内）；约定路径缺失时惰性播种 */
  docGet(input: z.input<typeof docGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocGetAction>['run']>>>;
/** 文档树索引（自有 + 可选外部；零副作用，双链解析的数据源） */
  docList2(input?: z.input<typeof docListInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocListAction>['run']>>>;
/** 删除自有文档（外部绑定不可删） */
  docRemove2(input: z.input<typeof docRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocRemoveAction>['run']>>>;
/** 写文档正文（面板保存走这里；自有走 own 树、外部走绑定闭包内原文件；写盘后摘要回写 desc / 组内 note） */
  docUpdate(input: z.input<typeof docUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocUpdateAction>['run']>>>;
/** 绑定项目/组介绍的文档覆盖（--repo 或 --board 二选一 + --rel <自有路径> | --path <外部文件/目录>；--reset 拆回约定路径） */
  docsBind(input?: z.input<typeof docsBindInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocsBindAction>['run']>>>;
/** 双链索引（docId + 文件名；前端点击 [[..]] 前拉一次；解析规则见 core/wikilink.js） */
  index(): Promise<Awaited<ReturnType<InstanceType<typeof DocsIndexAction>['run']>>>;
/** 维护组的附加文档列表（--doc <自有路径|绝对路径> + --note/--tag；--remove <序号> 移除；--before <序号> 插位；同 doc 重复添加 = 更新） */
  link(input: z.input<typeof docsLinkInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocsLinkAction>['run']>>>;
/** 绑定组内仓库描述的文档覆盖（--board <看板> --repo <仓库> + --rel/--path/--reset；仓库须为该组成员） */
  notebind(input: z.input<typeof docsNotebindInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocsNotebindAction>['run']>>>;
/** 把仓库 desc / 看板 desc / 组内 note 字符串播种成约定路径的 md（缺省预览，--apply 执行；幂等） */
  seed(input?: z.input<typeof docsSeedInput>): Promise<Awaited<ReturnType<InstanceType<typeof DocsSeedAction>['run']>>>;
/** 向某主题（工作目录）的队列回填一条任务（有 wait 在等则即时投递，否则排队）；--global 推到全局共享池；--duration 给任务带时间目标（领取即计时，完成前必须 check）；--board/--project 让任务带工作组语义（正文 frontmatter：board + project + 双方介绍引用），并落进该项目的队列；正文自带 frontmatter 时同样认归属——补介绍引用，落点跟到项目队列（显式给过 --cwd 时不挪窝） */
  localtaskAdd(input: z.input<typeof localtaskAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskAddAction>['run']>>>;
/** 改一条附件绑定的说明（desc）：--attachment <资源 id> --note <说明>（只动说明，角色/位置不变） */
  localtaskAttachNote(input: z.input<typeof localtaskAttachNoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskAttachNoteAction>['run']>>>;
/** 给任务挂附件：--path 存本机附件仓 / --fileId 引用已有附件 / --url / --task（同主题任务）/ --ref（文档）；默认嵌进正文，--no-embed 只挂到附件区（不写正文），--ref 加 --inline 文档进原文（交付带全文） */
  localtaskAttach(input: z.input<typeof localtaskAttachInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskAttachAction>['run']>>>;
/** 列出某条任务引用的附件（正文里的 ![名](fileId) 嵌入），以及本地是否已有（给 agent 直接读本地文件） */
  localtaskAttachments(input: z.input<typeof localtaskAttachmentsInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskAttachmentsAction>['run']>>>;
/** 关闭某主题的等待：阻塞中的 wait 立即收尾（与超时同一出口，带 cancelled 标记；不删主题与任务） */
  cancel(input?: z.input<typeof localtaskCancelInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskCancelAction>['run']>>>;
/** 批量取消待领取任务（按 --ids，定位到 --cwd 主题或 --key）：只处理 pending，已领取/已交付/已取消跳过；取消为终态，原文留档 */
  cancelMany(input: z.input<typeof localtaskCancelManyInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskCancelManyAction>['run']>>>;
/** 查一条任务的链：history 节点（origin/reopen/comment/current）+ 旧 forkOf 祖先/子任务；面板点节点可旁路查看正文 */
  chain(input: z.input<typeof localtaskChainInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskChainAction>['run']>>>;
/** 领取任务：有任务立即领（含任务级 timegoal 的 check 指令）；没任务默认立即返回 timeout，项目开启「持续 get」后自动唤起阻塞窗口等人回填 */
  claim(input?: z.input<typeof localtaskClaimInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskClaimAction>['run']>>>;
/** 克隆任务：复制正文内容为一条新任务（同主题；全局任务仍进全局池）。不带派生链、不继承时间目标与依赖——开新活用 */
  localtaskClone(input: z.input<typeof localtaskCloneInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskCloneAction>['run']>>>;
/** 批量收口待领取任务（按 --ids，定位到 --cwd 主题或 --key）：不要求先领取；--status done 写完成总结，cancelled 只改状态；已领取/已交付跳过 */
  closeMany(input: z.input<typeof localtaskCloseManyInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskCloseManyAction>['run']>>>;
/** 配置等待超时（秒）/ ack 汇报要求（ack 区块，done 指令与收尾要求唯一出口）/ 每区块模板列表 */
  config(input?: z.input<typeof localtaskConfigInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskConfigAction>['run']>>>;
/** 解除任务与附件的关系（默认只解除关系，资源进孤儿池）；--purge 在无人引用时连资源行与本机字节一起删 */
  localtaskDetach(input: z.input<typeof localtaskDetachInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskDetachAction>['run']>>>;
/** 标记任务完成：--summary 完成总结必填；带时间目标的任务未到点会被拒绝（blocked），到点自动记录最终 check */
  done(input: z.input<typeof localtaskDoneInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskDoneAction>['run']>>>;
/** 等待事件流：waiting 开始 / reminder 30s·10s / resolved delivered|timeout（SSE 长连接） */
  events(input?: z.input<typeof localtaskEventsInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskEventsAction>['run']>>>;
/** Fork 任务：复制正文内容为新任务，并把它挂到源任务的任务链下（保留评论/反馈链）；不继承时间目标与依赖 */
  fork(input: z.input<typeof localtaskForkInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskForkAction>['run']>>>;
/** 查看单条任务（按 --id，定位到 --cwd 主题或 --key）；正文引用附件时带附件清单与本地路径（自动下载跟随本机设置） */
  localtaskGet(input: z.input<typeof localtaskGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskGetAction>['run']>>>;
/** 从远程清单（KV 后端）导入任务到本地队列：按内容定位远程那条 → 落进本地队列 → 远程那条标记为已完成（note 写明被哪个队列领走） */
  importRemote(input?: z.input<typeof localtaskImportRemoteInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskImportRemoteAction>['run']>>>;
/** 总览全部主题（工作目录、现状、是否等待中、待领取数） */
  localtaskList(): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskListAction>['run']>>>;
/** 探测主面板上当前打开的「实时任务」标签数（活动 SSE 连接数；用于 wait 不重复开页） */
  presence(): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskPresenceAction>['run']>>>;
/** 预览一条任务在 get/wait 时的交付提示词（只读：不领取、不写盘、不启动计时、不为附件发网）；草稿用 --text 直接预览 */
  preview(input?: z.input<typeof localtaskPreviewInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskPreviewAction>['run']>>>;
/** 清理旧脏数据（旧模型无目录主题、空主题；等待中一律保留） */
  localtaskPrune(input?: z.input<typeof localtaskPruneInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskPruneAction>['run']>>>;
/** 删除一条任务（按 --id，定位到 --cwd 主题或 --key）；删除是**可恢复**的（软删除），加 --purge 彻底清除 */
  localtaskRemove(input: z.input<typeof localtaskRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskRemoveAction>['run']>>>;
/** 批量删除任务（按 --ids，定位到 --cwd 主题或 --key）：一次落盘，逐条软删除（可 restore 恢复）；缺失的编号不阻断其余删除 */
  removeMany(input: z.input<typeof localtaskRemoveManyInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskRemoveManyAction>['run']>>>;
/** 重开任务（验收反馈 / 重做 / 评论）：回写原任务正文，旧态压进 history；已完成则回到 pending 待再领 */
  reopen(input: z.input<typeof localtaskReopenInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskReopenAction>['run']>>>;
/** 调整待领取任务优先级（--id <编号> 移到 --before-id <编号> 前或 --after-id <编号> 后） */
  reorder(input: z.input<typeof localtaskReorderInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskReorderAction>['run']>>>;
/** 恢复一条被删除（软删除）的任务（撤销删除） */
  restore(input: z.input<typeof localtaskTaskRestoreInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskTaskRestoreAction>['run']>>>;
/** 查看任务级时间目标的每轮 check 记录（时间、已用/剩余、是否到点、当轮总结） */
  timegoalLog(input: z.input<typeof localtaskTimegoalLogInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskTimegoalLogAction>['run']>>>;
/** 登记一个工作目录：空目录也常驻（prune 不清）；--summary 顺带写「现状摘要」（面板顶栏摘要的编辑入口） */
  topicAdd(input: z.input<typeof localtaskTopicAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskTopicAddAction>['run']>>>;
/** 删除整个主题（含全部任务；按 --cwd 或 --key，等待中需 --force） */
  topicRemove(input?: z.input<typeof localtaskTopicRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskTopicRemoveAction>['run']>>>;
/** 批量删除主题（--keys/--cwds 逗号分隔，或 --all；等待中默认跳过，--force 连等待中删） */
  topicRemoveMany(input?: z.input<typeof localtaskTopicRemoveManyInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskTopicRemoveManyAction>['run']>>>;
/** 编辑任务内容（按 --id，定位到 --cwd 主题或 --key）；可同时改时间目标声明（--duration/--goal-prompt/--clear-goal，仅未领取时可改——领取即计时，起表后声明是既成事实） */
  localtaskUpdate(input: z.input<typeof localtaskUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof LocaltaskUpdateAction>['run']>>>;
/** 在本机队列与云端清单之间迁移任务（先写目标端、成功才改源端；--undo 按返回的 target-id 精确撤销） */
  move(input?: z.input<typeof taskMoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof TaskMoveAction>['run']>>>;
/** 时间运算 + 原文回显 prompt + 写入一次状态日志；每次必须提供当前现状 --summary */
  timegoalCheck(input: z.input<typeof timegoalCheckInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalCheckAction>['run']>>>;
/** 清空本目录 timegoal（无则 no_goal，不抛错） */
  clear(input: z.input<typeof timegoalClearInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalClearAction>['run']>>>;
/** 列出所有有 timegoal 的目录（按截止升序；已到点的单列在归档区） */
  timegoalList(): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalListAction>['run']>>>;
/** 查看本目录 timegoal 的检查日志（每轮 check 的现状） */
  log(input: z.input<typeof timegoalLogInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalLogAction>['run']>>>;
/** 彻底清除已到点 / 已归档的时间目标（到点本身已自动归档，这里是连归档区一起清） */
  timegoalPrune(): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalPruneAction>['run']>>>;
/** 为本目录设置/替换 timegoal：duration + 完整全局提示词（原文固化到 store） */
  timegoalSet(input: z.input<typeof timegoalSetInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalSetAction>['run']>>>;
/** 查看当前 timegoal（不算时间）：--cwd 目录级，--task 任务级（key 在领取交付里自带） */
  show(input?: z.input<typeof timegoalShowInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalShowAction>['run']>>>;
/** 更新本目录 timegoal 的提示词（可选同时改时长，--duration；保留起点，不重置计时） */
  timegoalUpdate(input: z.input<typeof timegoalUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof TimegoalUpdateAction>['run']>>>;
/** 新增任务模板（--body 给 Markdown 正文；多行正文用 --body-file <文件> 或 --body - 读管道；--setDefault 同时设为默认；--scope 设可见域、--topic 记创建主题并默认仅该主题可见） */
  templatesAdd(input: z.input<typeof templatesAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof TemplatesAddAction>['run']>>>;
/** 设置默认模板（新建页的起始正文换成它）；带 --body/--name/--scope 则改默认模板本身 */
  default(input: z.input<typeof templatesDefaultInput>): Promise<Awaited<ReturnType<InstanceType<typeof TemplatesDefaultAction>['run']>>>;
/** 列出任务模板（含默认模板 id；新建页的起始正文按默认模板取） */
  templatesList(input?: z.input<typeof templatesListInput>): Promise<Awaited<ReturnType<InstanceType<typeof TemplatesListAction>['run']>>>;
/** 删除任务模板（内置默认模板不可删；删的是默认模板则默认回落到内置） */
  templatesRemove(input: z.input<typeof templatesRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof TemplatesRemoveAction>['run']>>>;
/** 编辑任务模板（--name 改名 / --body 改正文 / --scope 改可见域，只改传入项；多行正文用 --body-file；内置模板的正文也可改） */
  templatesUpdate(input: z.input<typeof templatesUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof TemplatesUpdateAction>['run']>>>;
/** 新建工作空间 */
  groupAdd(input: z.input<typeof groupAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupAddAction>['run']>>>;
/** 查看当前工作空间 */
  current(): Promise<Awaited<ReturnType<InstanceType<typeof GroupCurrentAction>['run']>>>;
/** 查看单个工作空间 */
  groupGet(input: z.input<typeof groupGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupGetAction>['run']>>>;
/** 列出我的工作空间（* 为当前） */
  groupList(): Promise<Awaited<ReturnType<InstanceType<typeof GroupListAction>['run']>>>;
/** 查看工作空间成员 */
  members(input: z.input<typeof groupMembersInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupMembersAction>['run']>>>;
/** 解散工作空间（后端要求组内已无 KV） */
  groupRemove(input: z.input<typeof groupRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupRemoveAction>['run']>>>;
/** 改名 / 改描述（只改传入的字段） */
  groupUpdate(input: z.input<typeof groupUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupUpdateAction>['run']>>>;
/** 切换当前工作空间（id 或名称；0 / default 回默认组） */
  use(input: z.input<typeof groupUseInput>): Promise<Awaited<ReturnType<InstanceType<typeof GroupUseAction>['run']>>>;
/** 读取某主题的上下文提示词 */
  promptGet(input: z.input<typeof promptGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof PromptGetAction>['run']>>>;
/** 删除某主题的提示词 */
  promptRemove(input: z.input<typeof promptRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof PromptRemoveAction>['run']>>>;
/** 写入某主题的上下文提示词（覆盖） */
  promptSet(input: z.input<typeof promptSetInput>): Promise<Awaited<ReturnType<InstanceType<typeof PromptSetAction>['run']>>>;
/** 新增任务到待办（topic 不在快捷列表时自动补上） */
  todoAdd(input: z.input<typeof todoAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoAddAction>['run']>>>;
/** 把已完成里较旧的条目归档到冷 key（默认 30 天前） */
  archive(input?: z.input<typeof todoArchiveInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoArchiveAction>['run']>>>;
/** 给任务追加附件：--path 上传本机文件，或 --fileId 追加已上传附件，以 markdown 嵌入正文末尾 */
  todoAttach(input: z.input<typeof todoAttachInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoAttachAction>['run']>>>;
/** 列出某条任务引用的附件，以及本地是否已有（给 agent 直接读本地文件） */
  todoAttachments(input: z.input<typeof todoAttachmentsInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoAttachmentsAction>['run']>>>;
/** 标记完成（--ref 定位；--result 写进 note 作为完成结果） */
  todoDone(input: z.input<typeof todoDoneInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoDoneAction>['run']>>>;
/** 冻结任务（按内容定位；id 保留，解冻时校验冲突） */
  freeze(input: z.input<typeof todoFreezeInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoFreezeAction>['run']>>>;
/** 查看单个任务（按内容定位；自动在待办/已完成/冻结里找） */
  todoGet(input: z.input<typeof todoGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoGetAction>['run']>>>;
/** 列出任务（--topic / --status 过滤；默认三个桶全列） */
  todoList(input?: z.input<typeof todoListInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoListAction>['run']>>>;
/** 删除任务（按内容定位，只删命中的那一条） */
  todoRemove(input: z.input<typeof todoRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoRemoveAction>['run']>>>;
/** 解冻回待办（按内容定位；id 撞车时自动换新 id） */
  unfreeze(input: z.input<typeof todoUnfreezeInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoUnfreezeAction>['run']>>>;
/** 编辑任务（按内容定位，只改传入的字段） */
  todoUpdate(input: z.input<typeof todoUpdateInput>): Promise<Awaited<ReturnType<InstanceType<typeof TodoUpdateAction>['run']>>>;
/** 加入快捷主题 */
  topicAdd2(input: z.input<typeof topicAddInput>): Promise<Awaited<ReturnType<InstanceType<typeof TopicAddAction>['run']>>>;
/** 快捷主题列表（含各状态任务数） */
  topicList(input?: z.input<typeof topicListInput>): Promise<Awaited<ReturnType<InstanceType<typeof TopicListAction>['run']>>>;
/** 移出快捷主题（不动已有任务；仍被任务使用时会在结果里提示） */
  topicRemove2(input: z.input<typeof topicRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof TopicRemoveAction>['run']>>>;
/** 取附件本体：面板内联预览；CLI 打印出图地址与本地路径 */
  content(input: z.input<typeof fileContentInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileContentAction>['run']>>>;
/** 查单个附件的元数据与本地路径 */
  fileGet(input: z.input<typeof fileGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileGetAction>['run']>>>;
/** 列出当前用户空间的附件（含本地已同步路径） */
  fileList(input?: z.input<typeof fileListInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileListAction>['run']>>>;
/** 列出无主资源（没有任何任务/文档关系边；删任务、删文档、删正文行之后用） */
  orphans(): Promise<Awaited<ReturnType<InstanceType<typeof FileOrphansAction>['run']>>>;
/** 回收无主资源（DB 行 + 附件根目录内的本机/镜像字节；仍被引用的不删） */
  filePrune(input?: z.input<typeof filePruneInput>): Promise<Awaited<ReturnType<InstanceType<typeof FilePruneAction>['run']>>>;
/** 删除附件（后端软删；本地副本要清用 file sync --prune） */
  fileRemove(input: z.input<typeof fileRemoveInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileRemoveAction>['run']>>>;
/** 把附件同步到本机（默认全部；--ids 只同步指定附件）——为了不再依赖网络读附件 */
  fileSync(input?: z.input<typeof fileSyncInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileSyncAction>['run']>>>;
/** 上传附件（--local 存本机附件仓，本地任务贴图用；默认传当前用户空间的云端图床） */
  upload(input?: z.input<typeof fileUploadInput>): Promise<Awaited<ReturnType<InstanceType<typeof FileUploadAction>['run']>>>;
/** 输出内置 skill 全文（prefix + sentinel + 正文 + install 状态），并顺手装到本机 */
  bundledGet(input?: z.input<typeof bundledGetInput>): Promise<Awaited<ReturnType<InstanceType<typeof BundledGetAction>['run']>>>;
/** 列出可装的 group（groups.json 的组名 → 它包含哪些 skill） */
  groups(): Promise<Awaited<ReturnType<InstanceType<typeof BundledGroupsAction>['run']>>>;
/** 安装内置 skill 到 skills 目录（默认 nx-kv → ~/.claude/skills；--group <key> 一键装一组；--all 装全部并直接覆盖） */
  install(input?: z.input<typeof bundledInstallInput>): Promise<Awaited<ReturnType<InstanceType<typeof BundledInstallAction>['run']>>>;
/** 列出包内自带 skill（含文件数与描述）+ 默认装哪个 + 有哪些 group */
  bundledList(): Promise<Awaited<ReturnType<InstanceType<typeof BundledListAction>['run']>>>;
}

export function createApiClient(transport: Transport): ApiClient {
  return {
    // action: system.bootstrap
    async bootstrap() {
      const path = `/api/bootstrap`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BootstrapAction>['run']>>;
    },
    // action: system.health
    async health() {
      const path = `/api/health`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof HealthAction>['run']>>;
    },
    // action: setting.get
    async get() {
      const path = `/api/setting`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof SettingGetAction>['run']>>;
    },
    // action: setting.set
    async set(input?: z.input<typeof settingSetInput>) {
      const inp = input ?? ({} as z.input<typeof settingSetInput>);
      const path = `/api/setting`;
      const body = { "autoSyncAttachments": inp["autoSyncAttachments"], "attachmentsDir": inp["attachmentsDir"], "gitRepoRoot": inp["gitRepoRoot"], "gitDevRoot": inp["gitDevRoot"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof SettingSetAction>['run']>>;
    },
    // action: auth.login
    async login(input: z.input<typeof authLoginInput>) {
      const inp = input ?? ({} as z.input<typeof authLoginInput>);
      const path = `/api/auth/login`;
      const body = { "email": inp["email"], "password": inp["password"], "baseUrl": inp["baseUrl"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof AuthLoginAction>['run']>>;
    },
    // action: auth.logout
    async logout() {
      const path = `/api/auth/logout`;
      return (await transport.request("POST", path, undefined)) as Awaited<ReturnType<InstanceType<typeof AuthLogoutAction>['run']>>;
    },
    // action: auth.me
    async me() {
      const path = `/api/auth/me`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof AuthMeAction>['run']>>;
    },
    // action: auth.status
    async status() {
      const path = `/api/auth`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof AuthStatusAction>['run']>>;
    },
    // action: board.add
    async add(input: z.input<typeof boardAddInput>) {
      const inp = input ?? ({} as z.input<typeof boardAddInput>);
      const path = `/api/boards`;
      const body = { "name": inp["name"], "desc": inp["desc"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardAddAction>['run']>>;
    },
    // action: board.assign
    async assign(input: z.input<typeof boardAssignInput>) {
      const inp = input ?? ({} as z.input<typeof boardAssignInput>);
      const path = `/api/boards/assign`;
      const body = { "id": inp["id"], "board": inp["board"], "before": inp["before"], "remove": inp["remove"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardAssignAction>['run']>>;
    },
    // action: board.export
    async export() {
      const path = `/api/boards/export`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BoardExportAction>['run']>>;
    },
    // action: board.get
    async boardGet(input: z.input<typeof boardGetInput>) {
      const inp = input ?? ({} as z.input<typeof boardGetInput>);
      const path = `/api/boards/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BoardGetAction>['run']>>;
    },
    // action: board.import
    async import(input?: z.input<typeof boardImportInput>) {
      const inp = input ?? ({} as z.input<typeof boardImportInput>);
      const path = `/api/boards/import`;
      const body = { "file": inp["file"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardImportAction>['run']>>;
    },
    // action: board.list
    async list() {
      const path = `/api/boards`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BoardListAction>['run']>>;
    },
    // action: board.note
    async note(input: z.input<typeof boardNoteInput>) {
      const inp = input ?? ({} as z.input<typeof boardNoteInput>);
      const path = `/api/boards/note`;
      const body = { "id": inp["id"], "board": inp["board"], "note": inp["note"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardNoteAction>['run']>>;
    },
    // action: board.prefix
    async prefix(input: z.input<typeof boardPrefixInput>) {
      const inp = input ?? ({} as z.input<typeof boardPrefixInput>);
      const path = `/api/boards/prefix`;
      const body = { "prefix": inp["prefix"], "board": inp["board"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardPrefixAction>['run']>>;
    },
    // action: board.prune
    async prune(input?: z.input<typeof boardPruneInput>) {
      const inp = input ?? ({} as z.input<typeof boardPruneInput>);
      const path = `/api/boards/prune`;
      const body = { "board": inp["board"], "all": inp["all"], "apply": inp["apply"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardPruneAction>['run']>>;
    },
    // action: board.rekey
    async rekey(input: z.input<typeof boardRekeyInput>) {
      const inp = input ?? ({} as z.input<typeof boardRekeyInput>);
      const path = `/api/boards/rekey`;
      const body = { "from": inp["from"], "to": inp["to"], "board": inp["board"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardRekeyAction>['run']>>;
    },
    // action: board.remove
    async remove(input: z.input<typeof boardRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof boardRemoveInput>);
      const path = `/api/boards/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("DELETE", path, undefined)) as Awaited<ReturnType<InstanceType<typeof BoardRemoveAction>['run']>>;
    },
    // action: board.update
    async update(input: z.input<typeof boardUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof boardUpdateInput>);
      const path = `/api/boards/${encodeURIComponent(String(inp["id"]))}`;
      const body = { "name": inp["name"], "desc": inp["desc"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof BoardUpdateAction>['run']>>;
    },
    // action: repo.add
    async repoAdd(input: z.input<typeof repoAddInput>) {
      const inp = input ?? ({} as z.input<typeof repoAddInput>);
      const path = `/api/repos`;
      const body = { "path": inp["path"], "name": inp["name"], "icon": inp["icon"], "desc": inp["desc"], "notes": inp["notes"], "type": inp["type"], "remote": inp["remote"], "key": inp["key"], "key-custom": inp["key-custom"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoAddAction>['run']>>;
    },
    // action: repo.bind-topics
    async bindTopics(input?: z.input<typeof repoBindTopicsInput>) {
      const inp = input ?? ({} as z.input<typeof repoBindTopicsInput>);
      const path = `/api/repos/bind-topics`;
      const body = { "repo": inp["repo"], "apply": inp["apply"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoBindTopicsAction>['run']>>;
    },
    // action: repo.bind
    async bind(input: z.input<typeof repoBindInput>) {
      const inp = input ?? ({} as z.input<typeof repoBindInput>);
      const path = `/api/repos/bind`;
      const body = { "id": inp["id"], "repo": inp["repo"], "board": inp["board"], "remove": inp["remove"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoBindAction>['run']>>;
    },
    // action: repo.clone
    async clone(input: z.input<typeof repoCloneInput>) {
      const inp = input ?? ({} as z.input<typeof repoCloneInput>);
      const path = `/api/repos/clone`;
      const body = { "remote": inp["remote"], "key": inp["key"], "name": inp["name"], "desc": inp["desc"], "type": inp["type"], "depth": inp["depth"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoCloneAction>['run']>>;
    },
    // action: repo.detect
    async detect(input: z.input<typeof repoDetectInput>) {
      const inp = input ?? ({} as z.input<typeof repoDetectInput>);
      const path = `/api/repos/detect`;
      const body = { "path": inp["path"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoDetectAction>['run']>>;
    },
    // action: repo.doc.add
    async docAdd(input: z.input<typeof repoDocAddInput>) {
      const inp = input ?? ({} as z.input<typeof repoDocAddInput>);
      const path = `/api/repos/docs`;
      const body = { "id": inp["id"], "rel": inp["rel"], "path": inp["path"], "ref": inp["ref"], "file": inp["file"], "note": inp["note"], "tag": inp["tag"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoDocAddAction>['run']>>;
    },
    // action: repo.doc.list
    async docList(input: z.input<typeof repoDocListInput>) {
      const inp = input ?? ({} as z.input<typeof repoDocListInput>);
      let path = `/api/repos/docs`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoDocListAction>['run']>>;
    },
    // action: repo.doc.remove
    async docRemove(input: z.input<typeof repoDocRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof repoDocRemoveInput>);
      const path = `/api/repos/docs`;
      const body = { "id": inp["id"], "index": inp["index"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoDocRemoveAction>['run']>>;
    },
    // action: repo.export
    async repoExport(input?: z.input<typeof repoExportInput>) {
      const inp = input ?? ({} as z.input<typeof repoExportInput>);
      let path = `/api/repos/export`;
      const q = new URLSearchParams();
      if (inp["zip"] !== undefined) q.set("zip", String(inp["zip"]));
      if (inp["repos"] !== undefined) q.set("repos", String(inp["repos"]));
      if (inp["boards"] !== undefined) q.set("boards", String(inp["boards"]));
      if (inp["no-unassigned"] !== undefined) q.set("no-unassigned", String(inp["no-unassigned"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoExportAction>['run']>>;
    },
    // action: repo.get
    async repoGet(input: z.input<typeof repoGetInput>) {
      const inp = input ?? ({} as z.input<typeof repoGetInput>);
      const path = `/api/repos/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoGetAction>['run']>>;
    },
    // action: repo.import.diff
    async diff(input?: z.input<typeof repoImportDiffInput>) {
      const inp = input ?? ({} as z.input<typeof repoImportDiffInput>);
      const path = `/api/repos/import/diff`;
      const body = { "file": inp["file"], "json": inp["json"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoImportDiffAction>['run']>>;
    },
    // action: repo.import
    async repoImport(input?: z.input<typeof repoImportInput>) {
      const inp = input ?? ({} as z.input<typeof repoImportInput>);
      const path = `/api/repos/import`;
      const body = { "file": inp["file"], "json": inp["json"], "strategy": inp["strategy"], "select": inp["select"], "boards": inp["boards"], "clone": inp["clone"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoImportAction>['run']>>;
    },
    // action: repo.key.migrate
    async migrate(input?: z.input<typeof repoKeyMigrateInput>) {
      const inp = input ?? ({} as z.input<typeof repoKeyMigrateInput>);
      const path = `/api/repos/key/migrate`;
      const body = { "apply": inp["apply"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoKeyMigrateAction>['run']>>;
    },
    // action: repo.key.refresh
    async refresh(input?: z.input<typeof repoKeyRefreshInput>) {
      const inp = input ?? ({} as z.input<typeof repoKeyRefreshInput>);
      const path = `/api/repos/key/refresh`;
      const body = { "id": inp["id"], "all": inp["all"], "apply": inp["apply"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoKeyRefreshAction>['run']>>;
    },
    // action: repo.key.set
    async keySet(input: z.input<typeof repoKeySetInput>) {
      const inp = input ?? ({} as z.input<typeof repoKeySetInput>);
      const path = `/api/repos/key`;
      const body = { "id": inp["id"], "key": inp["key"], "follow": inp["follow"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoKeySetAction>['run']>>;
    },
    // action: repo.knowledge
    async knowledge(input?: z.input<typeof repoKnowledgeInput>) {
      const inp = input ?? ({} as z.input<typeof repoKnowledgeInput>);
      let path = `/api/repos/knowledge`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["md"] !== undefined) q.set("md", String(inp["md"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoKnowledgeAction>['run']>>;
    },
    // action: repo.list
    async repoList(input?: z.input<typeof repoListInput>) {
      const inp = input ?? ({} as z.input<typeof repoListInput>);
      let path = `/api/repos`;
      const q = new URLSearchParams();
      if (inp["type"] !== undefined) q.set("type", String(inp["type"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoListAction>['run']>>;
    },
    // action: repo.open
    async open(input: z.input<typeof repoOpenInput>) {
      const inp = input ?? ({} as z.input<typeof repoOpenInput>);
      const path = `/api/repos/open`;
      const body = { "id": inp["id"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoOpenAction>['run']>>;
    },
    // action: repo.ref.add
    async refAdd(input: z.input<typeof repoRefAddInput>) {
      const inp = input ?? ({} as z.input<typeof repoRefAddInput>);
      const path = `/api/repos/ref/add`;
      const body = { "path": inp["path"], "remote": inp["remote"], "name": inp["name"], "desc": inp["desc"], "notes": inp["notes"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRefAddAction>['run']>>;
    },
    // action: repo.ref.check
    async check() {
      const path = `/api/repos/ref/check`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoRefCheckAction>['run']>>;
    },
    // action: repo.ref.clone
    async refClone(input: z.input<typeof repoRefCloneInput>) {
      const inp = input ?? ({} as z.input<typeof repoRefCloneInput>);
      const path = `/api/repos/ref/clone`;
      const body = { "url": inp["url"], "name": inp["name"], "desc": inp["desc"], "notes": inp["notes"], "board": inp["board"], "bind": inp["bind"], "depth": inp["depth"], "no-bind": inp["no-bind"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRefCloneAction>['run']>>;
    },
    // action: repo.ref.note
    async refNote(input: z.input<typeof repoRefNoteInput>) {
      const inp = input ?? ({} as z.input<typeof repoRefNoteInput>);
      const path = `/api/repos/ref/note`;
      const body = { "id": inp["id"], "repo": inp["repo"], "board": inp["board"], "note": inp["note"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRefNoteAction>['run']>>;
    },
    // action: repo.ref.of
    async of(input?: z.input<typeof repoRefOfInput>) {
      const inp = input ?? ({} as z.input<typeof repoRefOfInput>);
      let path = `/api/repos/ref/of`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoRefOfAction>['run']>>;
    },
    // action: repo.ref.sync
    async sync(input?: z.input<typeof repoRefSyncInput>) {
      const inp = input ?? ({} as z.input<typeof repoRefSyncInput>);
      const path = `/api/repos/ref/sync`;
      const body = { "id": inp["id"], "all": inp["all"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRefSyncAction>['run']>>;
    },
    // action: repo.remote.check
    async remoteCheck(input?: z.input<typeof repoRemoteCheckInput>) {
      const inp = input ?? ({} as z.input<typeof repoRemoteCheckInput>);
      let path = `/api/repos/remote/check`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["url"] !== undefined) q.set("url", String(inp["url"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoRemoteCheckAction>['run']>>;
    },
    // action: repo.remote.list
    async remoteList(input?: z.input<typeof repoRemoteListInput>) {
      const inp = input ?? ({} as z.input<typeof repoRemoteListInput>);
      let path = `/api/repos/remote/list`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof RepoRemoteListAction>['run']>>;
    },
    // action: repo.remote.pick
    async pick(input: z.input<typeof repoRemotePickInput>) {
      const inp = input ?? ({} as z.input<typeof repoRemotePickInput>);
      const path = `/api/repos/remote/pick`;
      const body = { "id": inp["id"], "url": inp["url"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRemotePickAction>['run']>>;
    },
    // action: repo.remote
    async remote(input: z.input<typeof repoRemoteInput>) {
      const inp = input ?? ({} as z.input<typeof repoRemoteInput>);
      const path = `/api/repos/remote`;
      const body = { "id": inp["id"], "url": inp["url"], "refresh": inp["refresh"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoRemoteAction>['run']>>;
    },
    // action: repo.remove
    async repoRemove(input: z.input<typeof repoRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof repoRemoveInput>);
      const path = `/api/repos/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("DELETE", path, undefined)) as Awaited<ReturnType<InstanceType<typeof RepoRemoveAction>['run']>>;
    },
    // action: repo.scan
    async scan(input?: z.input<typeof repoScanInput>) {
      const inp = input ?? ({} as z.input<typeof repoScanInput>);
      const path = `/api/repos/scan`;
      const body = { "root": inp["root"], "depth": inp["depth"], "dry-run": inp["dry-run"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoScanAction>['run']>>;
    },
    // action: repo.update
    async repoUpdate(input: z.input<typeof repoUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof repoUpdateInput>);
      const path = `/api/repos/${encodeURIComponent(String(inp["id"]))}`;
      const body = { "path": inp["path"], "name": inp["name"], "icon": inp["icon"], "desc": inp["desc"], "notes": inp["notes"], "type": inp["type"], "remote": inp["remote"], "key": inp["key"], "key-custom": inp["key-custom"], "get-loop": inp["get-loop"], "get-loop-minutes": inp["get-loop-minutes"], "get-loop-template": inp["get-loop-template"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof RepoUpdateAction>['run']>>;
    },
    // action: doc.add
    async docAdd2(input: z.input<typeof docAddInput>) {
      const inp = input ?? ({} as z.input<typeof docAddInput>);
      const path = `/api/docs/item`;
      const body = { "rel": inp["rel"], "body": inp["body"], "bodyFile": inp["bodyFile"], "body-file": inp["body-file"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocAddAction>['run']>>;
    },
    // action: doc.attach-note
    async attachNote(input: z.input<typeof docAttachNoteInput>) {
      const inp = input ?? ({} as z.input<typeof docAttachNoteInput>);
      const path = `/api/docs/attach-note`;
      const body = { "ref": inp["ref"], "attachment": inp["attachment"], "note": inp["note"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof DocAttachNoteAction>['run']>>;
    },
    // action: doc.attach
    async attach(input: z.input<typeof docAttachInput>) {
      const inp = input ?? ({} as z.input<typeof docAttachInput>);
      const path = `/api/docs/attach`;
      const body = { "ref": inp["ref"], "path": inp["path"], "fileId": inp["fileId"], "url": inp["url"], "task": inp["task"], "doc": inp["doc"], "name": inp["name"], "note": inp["note"], "noEmbed": inp["noEmbed"], "no-embed": inp["no-embed"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocAttachAction>['run']>>;
    },
    // action: doc.attachments
    async attachments(input: z.input<typeof docAttachmentsInput>) {
      const inp = input ?? ({} as z.input<typeof docAttachmentsInput>);
      let path = `/api/docs/attachments`;
      const q = new URLSearchParams();
      if (inp["ref"] !== undefined) q.set("ref", String(inp["ref"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof DocAttachmentsAction>['run']>>;
    },
    // action: doc.detach
    async detach(input: z.input<typeof docDetachInput>) {
      const inp = input ?? ({} as z.input<typeof docDetachInput>);
      const path = `/api/docs/attach`;
      const body = { "ref": inp["ref"], "attachment": inp["attachment"], "purge": inp["purge"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof DocDetachAction>['run']>>;
    },
    // action: doc.get
    async docGet(input: z.input<typeof docGetInput>) {
      const inp = input ?? ({} as z.input<typeof docGetInput>);
      let path = `/api/docs/item`;
      const q = new URLSearchParams();
      if (inp["ref"] !== undefined) q.set("ref", String(inp["ref"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof DocGetAction>['run']>>;
    },
    // action: doc.list
    async docList2(input?: z.input<typeof docListInput>) {
      const inp = input ?? ({} as z.input<typeof docListInput>);
      let path = `/api/docs`;
      const q = new URLSearchParams();
      if (inp["external"] !== undefined) q.set("external", String(inp["external"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof DocListAction>['run']>>;
    },
    // action: doc.remove
    async docRemove2(input: z.input<typeof docRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof docRemoveInput>);
      const path = `/api/docs/item`;
      const body = { "ref": inp["ref"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof DocRemoveAction>['run']>>;
    },
    // action: doc.update
    async docUpdate(input: z.input<typeof docUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof docUpdateInput>);
      const path = `/api/docs/item`;
      const body = { "ref": inp["ref"], "body": inp["body"], "bodyFile": inp["bodyFile"], "body-file": inp["body-file"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof DocUpdateAction>['run']>>;
    },
    // action: docs.bind
    async docsBind(input?: z.input<typeof docsBindInput>) {
      const inp = input ?? ({} as z.input<typeof docsBindInput>);
      const path = `/api/docs/bind`;
      const body = { "repo": inp["repo"], "board": inp["board"], "rel": inp["rel"], "path": inp["path"], "reset": inp["reset"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocsBindAction>['run']>>;
    },
    // action: docs.index
    async index() {
      const path = `/api/docs/index`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof DocsIndexAction>['run']>>;
    },
    // action: docs.link
    async link(input: z.input<typeof docsLinkInput>) {
      const inp = input ?? ({} as z.input<typeof docsLinkInput>);
      const path = `/api/docs/link`;
      const body = { "board": inp["board"], "doc": inp["doc"], "note": inp["note"], "tag": inp["tag"], "remove": inp["remove"], "before": inp["before"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocsLinkAction>['run']>>;
    },
    // action: docs.notebind
    async notebind(input: z.input<typeof docsNotebindInput>) {
      const inp = input ?? ({} as z.input<typeof docsNotebindInput>);
      const path = `/api/docs/note-bind`;
      const body = { "board": inp["board"], "repo": inp["repo"], "rel": inp["rel"], "path": inp["path"], "reset": inp["reset"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocsNotebindAction>['run']>>;
    },
    // action: docs.seed
    async seed(input?: z.input<typeof docsSeedInput>) {
      const inp = input ?? ({} as z.input<typeof docsSeedInput>);
      const path = `/api/docs/seed`;
      const body = { "apply": inp["apply"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof DocsSeedAction>['run']>>;
    },
    // action: localtask.add
    async localtaskAdd(input: z.input<typeof localtaskAddInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskAddInput>);
      const path = `/api/localtasks`;
      const body = { "text": inp["text"], "cwd": inp["cwd"], "summary": inp["summary"], "global": inp["global"], "board": inp["board"], "project": inp["project"], "duration": inp["duration"], "goal-prompt": inp["goal-prompt"], "goalPrompt": inp["goalPrompt"], "block-by": inp["block-by"], "blockBy": inp["blockBy"], "gate": inp["gate"], "fork-of": inp["fork-of"], "forkOf": inp["forkOf"], "fork-kind": inp["fork-kind"], "forkKind": inp["forkKind"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskAddAction>['run']>>;
    },
    // action: localtask.attach-note
    async localtaskAttachNote(input: z.input<typeof localtaskAttachNoteInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskAttachNoteInput>);
      const path = `/api/localtasks/attach-note`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "attachment": inp["attachment"], "note": inp["note"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskAttachNoteAction>['run']>>;
    },
    // action: localtask.attach
    async localtaskAttach(input: z.input<typeof localtaskAttachInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskAttachInput>);
      const path = `/api/localtasks/attach`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "path": inp["path"], "fileId": inp["fileId"], "url": inp["url"], "task": inp["task"], "ref": inp["ref"], "inline": inp["inline"], "name": inp["name"], "kind": inp["kind"], "note": inp["note"], "noEmbed": inp["noEmbed"], "no-embed": inp["no-embed"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskAttachAction>['run']>>;
    },
    // action: localtask.attachments
    async localtaskAttachments(input: z.input<typeof localtaskAttachmentsInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskAttachmentsInput>);
      let path = `/api/localtasks/attachments`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["key"] !== undefined) q.set("key", String(inp["key"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskAttachmentsAction>['run']>>;
    },
    // action: localtask.cancel
    async cancel(input?: z.input<typeof localtaskCancelInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskCancelInput>);
      const path = `/api/localtasks/cancel`;
      const body = { "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskCancelAction>['run']>>;
    },
    // action: localtask.cancelMany
    async cancelMany(input: z.input<typeof localtaskCancelManyInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskCancelManyInput>);
      const path = `/api/localtasks/items/cancel`;
      const body = { "ids": inp["ids"], "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskCancelManyAction>['run']>>;
    },
    // action: localtask.chain
    async chain(input: z.input<typeof localtaskChainInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskChainInput>);
      let path = `/api/localtasks/chain`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["key"] !== undefined) q.set("key", String(inp["key"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskChainAction>['run']>>;
    },
    // action: localtask.claim
    async claim(input?: z.input<typeof localtaskClaimInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskClaimInput>);
      const path = `/api/localtasks/claim`;
      const body = { "cwd": inp["cwd"], "timeout": inp["timeout"], "no-open": inp["no-open"], "param": inp["param"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskClaimAction>['run']>>;
    },
    // action: localtask.clone
    async localtaskClone(input: z.input<typeof localtaskCloneInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskCloneInput>);
      const path = `/api/localtasks/clone`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskCloneAction>['run']>>;
    },
    // action: localtask.closeMany
    async closeMany(input: z.input<typeof localtaskCloseManyInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskCloseManyInput>);
      const path = `/api/localtasks/items/close`;
      const body = { "ids": inp["ids"], "cwd": inp["cwd"], "key": inp["key"], "status": inp["status"], "summary": inp["summary"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskCloseManyAction>['run']>>;
    },
    // action: localtask.config
    async config(input?: z.input<typeof localtaskConfigInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskConfigInput>);
      const path = `/api/localtasks/setting`;
      const body = { "timeout": inp["timeout"], "ack": inp["ack"], "ack-list": inp["ack-list"], "ackList": inp["ackList"], "delivery-template": inp["delivery-template"], "reset-delivery-template": inp["reset-delivery-template"], "attach-template": inp["attach-template"], "attachTemplate": inp["attachTemplate"], "reset-attach-template": inp["reset-attach-template"], "append-mode": inp["append-mode"], "block-templates": inp["block-templates"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskConfigAction>['run']>>;
    },
    // action: localtask.detach
    async localtaskDetach(input: z.input<typeof localtaskDetachInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskDetachInput>);
      const path = `/api/localtasks/attach`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "attachment": inp["attachment"], "purge": inp["purge"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskDetachAction>['run']>>;
    },
    // action: localtask.done
    async done(input: z.input<typeof localtaskDoneInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskDoneInput>);
      const path = `/api/localtasks/done`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "summary": inp["summary"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskDoneAction>['run']>>;
    },
    // action: localtask.events
    async events(input?: z.input<typeof localtaskEventsInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskEventsInput>);
      let path = `/api/localtasks/events`;
      const q = new URLSearchParams();
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["key"] !== undefined) q.set("key", String(inp["key"]));
      if (inp["timeout"] !== undefined) q.set("timeout", String(inp["timeout"]));
      if (inp["limit"] !== undefined) q.set("limit", String(inp["limit"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskEventsAction>['run']>>;
    },
    // action: localtask.fork
    async fork(input: z.input<typeof localtaskForkInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskForkInput>);
      const path = `/api/localtasks/fork`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskForkAction>['run']>>;
    },
    // action: localtask.get
    async localtaskGet(input: z.input<typeof localtaskGetInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskGetInput>);
      let path = `/api/localtasks/item`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["key"] !== undefined) q.set("key", String(inp["key"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskGetAction>['run']>>;
    },
    // action: localtask.importRemote
    async importRemote(input?: z.input<typeof localtaskImportRemoteInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskImportRemoteInput>);
      const path = `/api/localtasks/import-remote`;
      const body = { "ref": inp["ref"], "cwd": inp["cwd"], "global": inp["global"], "topic": inp["topic"], "pick": inp["pick"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskImportRemoteAction>['run']>>;
    },
    // action: localtask.list
    async localtaskList() {
      const path = `/api/localtasks`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskListAction>['run']>>;
    },
    // action: localtask.presence
    async presence() {
      const path = `/api/localtasks/presence`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskPresenceAction>['run']>>;
    },
    // action: localtask.preview
    async preview(input?: z.input<typeof localtaskPreviewInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskPreviewInput>);
      const path = `/api/localtasks/preview`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "text": inp["text"], "param": inp["param"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskPreviewAction>['run']>>;
    },
    // action: localtask.prune
    async localtaskPrune(input?: z.input<typeof localtaskPruneInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskPruneInput>);
      const path = `/api/localtasks/prune`;
      const body = { "all-finished": inp["all-finished"], "dry-run": inp["dry-run"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskPruneAction>['run']>>;
    },
    // action: localtask.remove
    async localtaskRemove(input: z.input<typeof localtaskRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskRemoveInput>);
      const path = `/api/localtasks/item`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "purge": inp["purge"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskRemoveAction>['run']>>;
    },
    // action: localtask.removeMany
    async removeMany(input: z.input<typeof localtaskRemoveManyInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskRemoveManyInput>);
      const path = `/api/localtasks/items`;
      const body = { "ids": inp["ids"], "cwd": inp["cwd"], "key": inp["key"], "purge": inp["purge"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskRemoveManyAction>['run']>>;
    },
    // action: localtask.reopen
    async reopen(input: z.input<typeof localtaskReopenInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskReopenInput>);
      const path = `/api/localtasks/reopen`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "text": inp["text"], "kind": inp["kind"], "quote": inp["quote"], "feedback": inp["feedback"], "feedbackHeading": inp["feedbackHeading"], "feedbackBold": inp["feedbackBold"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskReopenAction>['run']>>;
    },
    // action: localtask.reorder
    async reorder(input: z.input<typeof localtaskReorderInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskReorderInput>);
      const path = `/api/localtasks/reorder`;
      const body = { "id": inp["id"], "beforeId": inp["beforeId"], "afterId": inp["afterId"], "before-id": inp["before-id"], "after-id": inp["after-id"], "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskReorderAction>['run']>>;
    },
    // action: localtask.task.restore
    async restore(input: z.input<typeof localtaskTaskRestoreInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskTaskRestoreInput>);
      const path = `/api/localtasks/tasks/restore`;
      const body = { "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskTaskRestoreAction>['run']>>;
    },
    // action: localtask.timegoalLog
    async timegoalLog(input: z.input<typeof localtaskTimegoalLogInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskTimegoalLogInput>);
      let path = `/api/localtasks/timegoal-log`;
      const q = new URLSearchParams();
      if (inp["id"] !== undefined) q.set("id", String(inp["id"]));
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["key"] !== undefined) q.set("key", String(inp["key"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof LocaltaskTimegoalLogAction>['run']>>;
    },
    // action: localtask.topic.add
    async topicAdd(input: z.input<typeof localtaskTopicAddInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskTopicAddInput>);
      const path = `/api/localtasks/topic`;
      const body = { "cwd": inp["cwd"], "summary": inp["summary"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskTopicAddAction>['run']>>;
    },
    // action: localtask.topic.remove
    async topicRemove(input?: z.input<typeof localtaskTopicRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskTopicRemoveInput>);
      const path = `/api/localtasks/topic`;
      const body = { "cwd": inp["cwd"], "key": inp["key"], "force": inp["force"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskTopicRemoveAction>['run']>>;
    },
    // action: localtask.topic.removeMany
    async topicRemoveMany(input?: z.input<typeof localtaskTopicRemoveManyInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskTopicRemoveManyInput>);
      const path = `/api/localtasks/topics/remove`;
      const body = { "keys": inp["keys"], "cwds": inp["cwds"], "all": inp["all"], "force": inp["force"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskTopicRemoveManyAction>['run']>>;
    },
    // action: localtask.update
    async localtaskUpdate(input: z.input<typeof localtaskUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof localtaskUpdateInput>);
      const path = `/api/localtasks/item`;
      const body = { "id": inp["id"], "text": inp["text"], "cwd": inp["cwd"], "key": inp["key"], "duration": inp["duration"], "goal-prompt": inp["goal-prompt"], "goalPrompt": inp["goalPrompt"], "clear-goal": inp["clear-goal"], "clearGoal": inp["clearGoal"], "block-by": inp["block-by"], "blockBy": inp["blockBy"], "clear-block-by": inp["clear-block-by"], "clearBlockBy": inp["clearBlockBy"], "gate": inp["gate"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof LocaltaskUpdateAction>['run']>>;
    },
    // action: task.move
    async move(input?: z.input<typeof taskMoveInput>) {
      const inp = input ?? ({} as z.input<typeof taskMoveInput>);
      const path = `/api/task/move`;
      const body = { "from": inp["from"], "to": inp["to"], "id": inp["id"], "cwd": inp["cwd"], "key": inp["key"], "topic": inp["topic"], "text": inp["text"], "pick": inp["pick"], "merge": inp["merge"], "group": inp["group"], "undo": inp["undo"], "target-id": inp["target-id"], "tombstone-id": inp["tombstone-id"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TaskMoveAction>['run']>>;
    },
    // action: timegoal.check
    async timegoalCheck(input: z.input<typeof timegoalCheckInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalCheckInput>);
      let path = `/api/timegoals/check`;
      const q = new URLSearchParams();
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["task"] !== undefined) q.set("task", String(inp["task"]));
      if (inp["summary"] !== undefined) q.set("summary", String(inp["summary"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TimegoalCheckAction>['run']>>;
    },
    // action: timegoal.clear
    async clear(input: z.input<typeof timegoalClearInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalClearInput>);
      const path = `/api/timegoals`;
      const body = { "cwd": inp["cwd"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof TimegoalClearAction>['run']>>;
    },
    // action: timegoal.list
    async timegoalList() {
      const path = `/api/timegoals/all`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TimegoalListAction>['run']>>;
    },
    // action: timegoal.log
    async log(input: z.input<typeof timegoalLogInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalLogInput>);
      let path = `/api/timegoals/log`;
      const q = new URLSearchParams();
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TimegoalLogAction>['run']>>;
    },
    // action: timegoal.prune
    async timegoalPrune() {
      const path = `/api/timegoals/prune`;
      return (await transport.request("POST", path, undefined)) as Awaited<ReturnType<InstanceType<typeof TimegoalPruneAction>['run']>>;
    },
    // action: timegoal.set
    async timegoalSet(input: z.input<typeof timegoalSetInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalSetInput>);
      const path = `/api/timegoals`;
      const body = { "cwd": inp["cwd"], "duration": inp["duration"], "prompt": inp["prompt"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TimegoalSetAction>['run']>>;
    },
    // action: timegoal.show
    async show(input?: z.input<typeof timegoalShowInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalShowInput>);
      let path = `/api/timegoals`;
      const q = new URLSearchParams();
      if (inp["cwd"] !== undefined) q.set("cwd", String(inp["cwd"]));
      if (inp["task"] !== undefined) q.set("task", String(inp["task"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TimegoalShowAction>['run']>>;
    },
    // action: timegoal.update
    async timegoalUpdate(input: z.input<typeof timegoalUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof timegoalUpdateInput>);
      const path = `/api/timegoals`;
      const body = { "cwd": inp["cwd"], "prompt": inp["prompt"], "duration": inp["duration"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof TimegoalUpdateAction>['run']>>;
    },
    // action: templates.add
    async templatesAdd(input: z.input<typeof templatesAddInput>) {
      const inp = input ?? ({} as z.input<typeof templatesAddInput>);
      const path = `/api/templates`;
      const body = { "name": inp["name"], "body": inp["body"], "bodyFile": inp["bodyFile"], "body-file": inp["body-file"], "setDefault": inp["setDefault"], "set-default": inp["set-default"], "scope": inp["scope"], "topic": inp["topic"], "cwd": inp["cwd"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TemplatesAddAction>['run']>>;
    },
    // action: templates.default
    async default(input: z.input<typeof templatesDefaultInput>) {
      const inp = input ?? ({} as z.input<typeof templatesDefaultInput>);
      const path = `/api/templates/default`;
      const body = { "id": inp["id"], "name": inp["name"], "body": inp["body"], "values": inp["values"], "scope": inp["scope"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof TemplatesDefaultAction>['run']>>;
    },
    // action: templates.list
    async templatesList(input?: z.input<typeof templatesListInput>) {
      const inp = input ?? ({} as z.input<typeof templatesListInput>);
      let path = `/api/templates`;
      const q = new URLSearchParams();
      if (inp["topic"] !== undefined) q.set("topic", String(inp["topic"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      if (inp["repo"] !== undefined) q.set("repo", String(inp["repo"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TemplatesListAction>['run']>>;
    },
    // action: templates.remove
    async templatesRemove(input: z.input<typeof templatesRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof templatesRemoveInput>);
      const path = `/api/templates/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("DELETE", path, undefined)) as Awaited<ReturnType<InstanceType<typeof TemplatesRemoveAction>['run']>>;
    },
    // action: templates.update
    async templatesUpdate(input: z.input<typeof templatesUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof templatesUpdateInput>);
      const path = `/api/templates/${encodeURIComponent(String(inp["id"]))}`;
      const body = { "name": inp["name"], "body": inp["body"], "bodyFile": inp["bodyFile"], "body-file": inp["body-file"], "scope": inp["scope"], "values": inp["values"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof TemplatesUpdateAction>['run']>>;
    },
    // action: group.add
    async groupAdd(input: z.input<typeof groupAddInput>) {
      const inp = input ?? ({} as z.input<typeof groupAddInput>);
      const path = `/api/groups`;
      const body = { "name": inp["name"], "description": inp["description"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof GroupAddAction>['run']>>;
    },
    // action: group.current
    async current() {
      const path = `/api/group`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof GroupCurrentAction>['run']>>;
    },
    // action: group.get
    async groupGet(input: z.input<typeof groupGetInput>) {
      const inp = input ?? ({} as z.input<typeof groupGetInput>);
      const path = `/api/groups/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof GroupGetAction>['run']>>;
    },
    // action: group.list
    async groupList() {
      const path = `/api/groups`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof GroupListAction>['run']>>;
    },
    // action: group.members
    async members(input: z.input<typeof groupMembersInput>) {
      const inp = input ?? ({} as z.input<typeof groupMembersInput>);
      const path = `/api/groups/${encodeURIComponent(String(inp["id"]))}/members`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof GroupMembersAction>['run']>>;
    },
    // action: group.remove
    async groupRemove(input: z.input<typeof groupRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof groupRemoveInput>);
      const path = `/api/groups/${encodeURIComponent(String(inp["id"]))}`;
      return (await transport.request("DELETE", path, undefined)) as Awaited<ReturnType<InstanceType<typeof GroupRemoveAction>['run']>>;
    },
    // action: group.update
    async groupUpdate(input: z.input<typeof groupUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof groupUpdateInput>);
      const path = `/api/groups/${encodeURIComponent(String(inp["id"]))}`;
      const body = { "name": inp["name"], "description": inp["description"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof GroupUpdateAction>['run']>>;
    },
    // action: group.use
    async use(input: z.input<typeof groupUseInput>) {
      const inp = input ?? ({} as z.input<typeof groupUseInput>);
      const path = `/api/group`;
      const body = { "locator": inp["locator"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof GroupUseAction>['run']>>;
    },
    // action: prompt.get
    async promptGet(input: z.input<typeof promptGetInput>) {
      const inp = input ?? ({} as z.input<typeof promptGetInput>);
      let path = `/api/prompts/${encodeURIComponent(String(inp["topic"]))}`;
      const q = new URLSearchParams();
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof PromptGetAction>['run']>>;
    },
    // action: prompt.remove
    async promptRemove(input: z.input<typeof promptRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof promptRemoveInput>);
      const path = `/api/prompts/${encodeURIComponent(String(inp["topic"]))}`;
      const body = { "group": inp["group"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof PromptRemoveAction>['run']>>;
    },
    // action: prompt.set
    async promptSet(input: z.input<typeof promptSetInput>) {
      const inp = input ?? ({} as z.input<typeof promptSetInput>);
      const path = `/api/prompts/${encodeURIComponent(String(inp["topic"]))}`;
      const body = { "text": inp["text"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof PromptSetAction>['run']>>;
    },
    // action: todo.add
    async todoAdd(input: z.input<typeof todoAddInput>) {
      const inp = input ?? ({} as z.input<typeof todoAddInput>);
      const path = `/api/todo`;
      const body = { "text": inp["text"], "topic": inp["topic"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoAddAction>['run']>>;
    },
    // action: todo.archive
    async archive(input?: z.input<typeof todoArchiveInput>) {
      const inp = input ?? ({} as z.input<typeof todoArchiveInput>);
      const path = `/api/todo/archive`;
      const body = { "before": inp["before"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoArchiveAction>['run']>>;
    },
    // action: todo.attach
    async todoAttach(input: z.input<typeof todoAttachInput>) {
      const inp = input ?? ({} as z.input<typeof todoAttachInput>);
      const path = `/api/todo/attach`;
      const body = { "ref": inp["ref"], "path": inp["path"], "fileId": inp["fileId"], "name": inp["name"], "kind": inp["kind"], "accessLevel": inp["accessLevel"], "topic": inp["topic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoAttachAction>['run']>>;
    },
    // action: todo.attachments
    async todoAttachments(input: z.input<typeof todoAttachmentsInput>) {
      const inp = input ?? ({} as z.input<typeof todoAttachmentsInput>);
      let path = `/api/todo/attachments`;
      const q = new URLSearchParams();
      if (inp["ref"] !== undefined) q.set("ref", String(inp["ref"]));
      if (inp["topic"] !== undefined) q.set("topic", String(inp["topic"]));
      if (inp["pick"] !== undefined) q.set("pick", String(inp["pick"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TodoAttachmentsAction>['run']>>;
    },
    // action: todo.done
    async todoDone(input: z.input<typeof todoDoneInput>) {
      const inp = input ?? ({} as z.input<typeof todoDoneInput>);
      const path = `/api/todo/done`;
      const body = { "ref": inp["ref"], "result": inp["result"], "topic": inp["topic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoDoneAction>['run']>>;
    },
    // action: todo.freeze
    async freeze(input: z.input<typeof todoFreezeInput>) {
      const inp = input ?? ({} as z.input<typeof todoFreezeInput>);
      const path = `/api/todo/freeze`;
      const body = { "ref": inp["ref"], "topic": inp["topic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoFreezeAction>['run']>>;
    },
    // action: todo.get
    async todoGet(input: z.input<typeof todoGetInput>) {
      const inp = input ?? ({} as z.input<typeof todoGetInput>);
      let path = `/api/todo/item`;
      const q = new URLSearchParams();
      if (inp["ref"] !== undefined) q.set("ref", String(inp["ref"]));
      if (inp["topic"] !== undefined) q.set("topic", String(inp["topic"]));
      if (inp["pick"] !== undefined) q.set("pick", String(inp["pick"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TodoGetAction>['run']>>;
    },
    // action: todo.list
    async todoList(input?: z.input<typeof todoListInput>) {
      const inp = input ?? ({} as z.input<typeof todoListInput>);
      let path = `/api/todo`;
      const q = new URLSearchParams();
      if (inp["topic"] !== undefined) q.set("topic", String(inp["topic"]));
      if (inp["status"] !== undefined) q.set("status", String(inp["status"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TodoListAction>['run']>>;
    },
    // action: todo.remove
    async todoRemove(input: z.input<typeof todoRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof todoRemoveInput>);
      const path = `/api/todo/item`;
      const body = { "ref": inp["ref"], "topic": inp["topic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoRemoveAction>['run']>>;
    },
    // action: todo.unfreeze
    async unfreeze(input: z.input<typeof todoUnfreezeInput>) {
      const inp = input ?? ({} as z.input<typeof todoUnfreezeInput>);
      const path = `/api/todo/unfreeze`;
      const body = { "ref": inp["ref"], "topic": inp["topic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoUnfreezeAction>['run']>>;
    },
    // action: todo.update
    async todoUpdate(input: z.input<typeof todoUpdateInput>) {
      const inp = input ?? ({} as z.input<typeof todoUpdateInput>);
      const path = `/api/todo/item`;
      const body = { "ref": inp["ref"], "topic": inp["topic"], "text": inp["text"], "note": inp["note"], "matchTopic": inp["matchTopic"], "pick": inp["pick"], "group": inp["group"] };
      return (await transport.request("PATCH", path, body)) as Awaited<ReturnType<InstanceType<typeof TodoUpdateAction>['run']>>;
    },
    // action: topic.add
    async topicAdd2(input: z.input<typeof topicAddInput>) {
      const inp = input ?? ({} as z.input<typeof topicAddInput>);
      const path = `/api/topics`;
      const body = { "name": inp["name"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof TopicAddAction>['run']>>;
    },
    // action: topic.list
    async topicList(input?: z.input<typeof topicListInput>) {
      const inp = input ?? ({} as z.input<typeof topicListInput>);
      let path = `/api/topics`;
      const q = new URLSearchParams();
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof TopicListAction>['run']>>;
    },
    // action: topic.remove
    async topicRemove2(input: z.input<typeof topicRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof topicRemoveInput>);
      const path = `/api/topics`;
      const body = { "name": inp["name"], "group": inp["group"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof TopicRemoveAction>['run']>>;
    },
    // action: file.content
    async content(input: z.input<typeof fileContentInput>) {
      const inp = input ?? ({} as z.input<typeof fileContentInput>);
      let path = `/api/file/content/${encodeURIComponent(String(inp["fileId"]))}`;
      const q = new URLSearchParams();
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof FileContentAction>['run']>>;
    },
    // action: file.get
    async fileGet(input: z.input<typeof fileGetInput>) {
      const inp = input ?? ({} as z.input<typeof fileGetInput>);
      let path = `/api/file/item`;
      const q = new URLSearchParams();
      if (inp["fileId"] !== undefined) q.set("fileId", String(inp["fileId"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof FileGetAction>['run']>>;
    },
    // action: file.list
    async fileList(input?: z.input<typeof fileListInput>) {
      const inp = input ?? ({} as z.input<typeof fileListInput>);
      let path = `/api/file`;
      const q = new URLSearchParams();
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      if (inp["limit"] !== undefined) q.set("limit", String(inp["limit"]));
      if (inp["offset"] !== undefined) q.set("offset", String(inp["offset"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof FileListAction>['run']>>;
    },
    // action: file.orphans
    async orphans() {
      const path = `/api/file/orphans`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof FileOrphansAction>['run']>>;
    },
    // action: file.prune
    async filePrune(input?: z.input<typeof filePruneInput>) {
      const inp = input ?? ({} as z.input<typeof filePruneInput>);
      const path = `/api/file/prune`;
      const body = { "dry-run": inp["dry-run"], "dryRun": inp["dryRun"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof FilePruneAction>['run']>>;
    },
    // action: file.remove
    async fileRemove(input: z.input<typeof fileRemoveInput>) {
      const inp = input ?? ({} as z.input<typeof fileRemoveInput>);
      const path = `/api/file/item`;
      const body = { "fileId": inp["fileId"], "group": inp["group"] };
      return (await transport.request("DELETE", path, body)) as Awaited<ReturnType<InstanceType<typeof FileRemoveAction>['run']>>;
    },
    // action: file.sync
    async fileSync(input?: z.input<typeof fileSyncInput>) {
      const inp = input ?? ({} as z.input<typeof fileSyncInput>);
      const path = `/api/file/sync`;
      const body = { "ids": inp["ids"], "dir": inp["dir"], "prune": inp["prune"], "dryRun": inp["dryRun"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof FileSyncAction>['run']>>;
    },
    // action: file.upload
    async upload(input?: z.input<typeof fileUploadInput>) {
      const inp = input ?? ({} as z.input<typeof fileUploadInput>);
      const path = `/api/file`;
      const body = { "path": inp["path"], "content": inp["content"], "name": inp["name"], "contentType": inp["contentType"], "local": inp["local"], "accessLevel": inp["accessLevel"], "group": inp["group"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof FileUploadAction>['run']>>;
    },
    // action: bundled.get
    async bundledGet(input?: z.input<typeof bundledGetInput>) {
      const inp = input ?? ({} as z.input<typeof bundledGetInput>);
      let path = `/api/bundled/content`;
      const q = new URLSearchParams();
      if (inp["name"] !== undefined) q.set("name", String(inp["name"]));
      if (inp["ref"] !== undefined) q.set("ref", String(inp["ref"]));
      if (inp["group"] !== undefined) q.set("group", String(inp["group"]));
      if (inp["to"] !== undefined) q.set("to", String(inp["to"]));
      const query = q.toString();
      if (query) path += path.includes('?') ? '&' + query : '?' + query;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BundledGetAction>['run']>>;
    },
    // action: bundled.groups
    async groups() {
      const path = `/api/bundled/groups`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BundledGroupsAction>['run']>>;
    },
    // action: bundled.install
    async install(input?: z.input<typeof bundledInstallInput>) {
      const inp = input ?? ({} as z.input<typeof bundledInstallInput>);
      const path = `/api/bundled/install`;
      const body = { "name": inp["name"], "group": inp["group"], "to": inp["to"], "force": inp["force"], "all": inp["all"] };
      return (await transport.request("POST", path, body)) as Awaited<ReturnType<InstanceType<typeof BundledInstallAction>['run']>>;
    },
    // action: bundled.list
    async bundledList() {
      const path = `/api/bundled`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BundledListAction>['run']>>;
    },
  };
}
