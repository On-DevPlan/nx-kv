// localtask 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- localtask.attach ----
export const localtaskAttachInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  path: z.string().optional().describe("本机文件路径（落 ~/.nx-kv/attachments/local/ 再登记）"),
  fileId: z.string().optional().describe("已有附件的 id（32 位 hex，可带扩展名；本机仓或云端）"),
  url: z.string().optional().describe("外部链接（http/https；kind=url）"),
  task: z.string().optional().describe("同主题下的任务编号（kind=task，落 nxkv://task/<id>）"),
  ref: z.string().optional().describe("文档路径或 ref id（kind=ref，落 nxkv://ref/<refId>）"),
  inline: z.boolean().optional().describe("文档进原文：交付时附全文（截断 2 万字）而不是只给路径；仅 --ref 有效"),
  name: z.string().optional().describe("显示名 / 本地文件名（默认取原名）"),
  kind: z.string().optional().describe("image | file（仅 --path/--fileId 用；不给按扩展名判）"),
  note: z.string().optional().describe("绑定说明（desc）：附件区条目备注 / 文档绑定的一行简介，交付清单透出"),
  noEmbed: z.boolean().optional().describe("只写 attachments + task_attach（role=attach），不改正文"),
  'no-embed': z.boolean().optional().describe("同 --noEmbed（连字符写法）"),
});

// ---- localtask.detach ----
export const localtaskDetachInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  attachment: z.string().describe("资源 id（见 localtask attachments）"),
  purge: z.boolean().optional().describe("连资源行与本机字节一起删（仍被其他任务/文档引用时拒绝删）"),
});

// ---- localtask.attach-note ----
export const localtaskAttachNoteInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  attachment: z.string().describe("资源 id（见 localtask attachments）"),
  note: z.string().optional().describe("说明文字（留空 = 清掉）"),
});

// ---- localtask.attachments ----
export const localtaskAttachmentsInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.clone ----
export const localtaskCloneInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.fork ----
export const localtaskForkInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.claim ----
export const localtaskClaimInput = z.object({
  cwd: z.string().optional(),
  timeout: z.number().optional().describe("阻塞上限（秒）；仅项目开启「持续 get」时有意义"),
  'no-open': z.boolean().optional().describe("不自动打开浏览器（测试用）"),
  param: z.array(z.string()).optional().describe("外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取"),
});

// ---- localtask.preview ----
export const localtaskPreviewInput = z.object({
  id: z.number().optional().describe("任务编号（草稿预览可省，改给 --text）"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  text: z.string().optional().describe("直接预览这段正文（草稿未落库时用；给了就不读库存）"),
  param: z.array(z.string()).optional().describe("外部参数（平面扩展）：k=v，与 get 的 --param 同语义"),
});

// ---- localtask.reopen ----
export const localtaskReopenInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  text: z.string().optional().describe("修改后的任务正文（Markdown）；不给则只重开不改内容"),
  kind: z.string().optional().describe("reopen（验收反馈，默认）或 comment（划选评论）"),
  quote: z.string().optional().describe("划选原文（comment 时）"),
  feedback: z.string().optional().describe("用户反馈原文；不给 text 时追加到当前正文末尾（#79，base = 服务端最新正文）"),
  feedbackHeading: z.string().optional().describe("追加反馈段的段名（缺省 comment=## 反馈修改 / reopen=## 验收反馈）"),
  feedbackBold: z.boolean().optional().describe("追加的反馈是否逐行加粗（缺省 comment=false / reopen=true）"),
});

// ---- localtask.done ----
export const localtaskDoneInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  summary: z.string().describe("完成总结（记为本轮终态 + timegoal 日志）"),
});

// ---- localtask.timegoalLog ----
export const localtaskTimegoalLogInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.config ----
export const localtaskConfigInput = z.object({
  timeout: z.number().optional().describe("超时秒数（1-600）"),
  ack: z.string().optional().describe("ack 汇报要求（写入 ack 区块的「命令行」模板并启用；默认内置要求 agent 调 localtask done）。传空 = 恢复内置"),
  'ack-list': z.array(z.string()).optional().describe("整体替换 ack 完成总结提示词列表（多条）"),
  ackList: z.array(z.string()).optional().describe("同 --ack-list（驼峰写法，HTTP body 用）"),
  'delivery-template': z.string().optional().describe("交付上下文模板（写入 context 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板。变量与语法见 skill / docs"),
  'reset-delivery-template': z.boolean().optional().describe("恢复 context 区块内置模板"),
  'attach-template': z.string().optional().describe("附件段提示词（写入 attachment 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板"),
  attachTemplate: z.string().optional().describe("同 --attach-template（驼峰写法，HTTP body 用）"),
  'reset-attach-template': z.boolean().optional().describe("恢复 attachment 区块内置模板"),
  'append-mode': z.string().optional().describe("系统上下文追加模式（全局）：xml（默认，每段包独立标签）/ plain（按空行直接拼正文）。HTTP body 用 appendMode"),
  'block-templates': z.string().optional().describe("每区块模板列表（JSON 对象）：{\"context\":{\"active\":\"builtin\",\"list\":[…]},…}。HTTP body 用 blockTemplates（对象）"),
});

// ---- localtask.prune ----
export const localtaskPruneInput = z.object({
  'all-finished': z.boolean().optional().describe("连同已全部领取、无待领的主题一起清"),
  'dry-run': z.boolean().optional().describe("只报告将清理哪些，不实际删除"),
});

// ---- localtask.reorder ----
export const localtaskReorderInput = z.object({
  id: z.number().describe("要移动的任务编号"),
  beforeId: z.number().optional().describe("插到该编号之前（与 afterId 二选一）"),
  afterId: z.number().optional().describe("插到该编号之后（与 beforeId 二选一）"),
  'before-id': z.number().optional().describe("同 --beforeId（连字符写法）"),
  'after-id': z.number().optional().describe("同 --afterId（连字符写法）"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- task.move ----
export const taskMoveInput = z.object({
  from: z.enum(["local", "cloud"]).optional().describe("迁移源"),
  to: z.enum(["local", "cloud"]).optional().describe("迁移目标"),
  id: z.number().optional().describe("本机任务编号（from=local 时必填）"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  topic: z.string().optional().describe("云端主题（= 目录名；from=cloud 必填，to=cloud 缺省用目录名）"),
  text: z.string().optional().describe("云端任务内容（from=cloud 时按内容定位）"),
  pick: z.number().optional().describe("云端同内容多条时的编号（消歧）"),
  merge: z.boolean().optional().describe("目标端已有同内容时合并到已有条目（不新增）"),
  group: z.number().optional().describe("云端工作空间 id（默认取当前）"),
  undo: z.boolean().optional().describe("撤销一次迁移（配合 --target-id 与原 move 参数）"),
  'target-id': z.number().optional().describe("撤销用：迁移时返回的 targetId"),
  'tombstone-id': z.number().optional().describe("撤销 local→cloud 时可显式指定本机迁出条目编号（缺省用 --id）"),
});

// ---- localtask.list ----
export const localtaskListInput = z.object({

});

// ---- localtask.get ----
export const localtaskGetInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.chain ----
export const localtaskChainInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.remove ----
export const localtaskRemoveInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  purge: z.boolean().optional().describe("彻底删除（不可恢复）；不加就是软删除，可 restore 回来"),
});

// ---- localtask.removeMany ----
export const localtaskRemoveManyInput = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  purge: z.boolean().optional().describe("彻底删除（不可恢复）；不加就是软删除"),
});

// ---- localtask.cancelMany ----
export const localtaskCancelManyInput = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.closeMany ----
export const localtaskCloseManyInput = z.object({
  ids: z.array(z.string()).describe("任务编号，逗号分隔或给多次"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  status: z.string().optional().describe("done（标为完成，默认）或 cancelled（取消）"),
  summary: z.string().optional().describe("完成总结（status=done 时可选）"),
});

// ---- localtask.task.restore ----
export const localtaskTaskRestoreInput = z.object({
  id: z.number().describe("任务编号"),
  cwd: z.string().optional(),
  key: z.string().optional(),
});

// ---- localtask.importRemote ----
export const localtaskImportRemoteInput = z.object({
  ref: z.array(z.string()).optional().describe("远程任务内容（整串，可给多次）"),
  cwd: z.string().optional(),
  global: z.boolean().optional().describe("导入到全局共享池（--cwd 被忽略）"),
  topic: z.string().optional().describe("远程主题（消歧用）"),
  pick: z.number().optional().describe("同内容多条时的编号（消歧用）"),
});

// ---- localtask.add ----
export const localtaskAddInput = z.object({
  text: z.string(),
  cwd: z.string().optional().describe("工作目录（作为主题；默认当前目录）。归属由 --project 决定：给了 --project 就用它推导落点，这里再给且不一致会报错"),
  summary: z.string().optional().describe("顺带刷新该主题的当前现状（可选）"),
  global: z.boolean().optional().describe("推到全局主题（共享池）：任何目录的 wait 在本地空时自动领取；--cwd 被忽略"),
  board: z.string().optional().describe("工作组（看板）id / key / 名称：任务正文自动带上 frontmatter（board + 组介绍引用），该任务才会出现在组面板里；必须同时给 --project 指明归属项目"),
  project: z.string().optional().describe("归属项目（仓库 key / 名称 / 路径）：任务挂在哪个项目上，落点目录由它推导，frontmatter 带上 project + 项目介绍引用；配 --board 时必须是该组成员"),
  duration: z.string().optional().describe("时间目标时长（2h / 90m / 5小时）：领取即计时，未到点不许标完成"),
  'goal-prompt': z.string().optional().describe("时间目标的附加要求（随 check 指令一起固化，可省）"),
  goalPrompt: z.string().optional().describe("同 --goal-prompt（驼峰写法）"),
  'block-by': z.string().optional().describe("DAG 依赖：逗号分隔的任务 id（如 12,13）——这些任务全部完成后本条才可领取"),
  blockBy: z.string().optional().describe("同 --block-by（驼峰 / HTTP body）"),
  gate: z.boolean().optional().describe("闸门任务：自身未完成（无 completedAt）时，队列里排在它后面的 pending 都不可领"),
  'fork-of': z.string().optional().describe("任务链（#69）：这条任务从哪条派生——裸数字=同主题父任务编号，或 \"key:id\"=跨主题；父任务必须存在"),
  forkOf: z.string().optional().describe("同 --fork-of（驼峰 / HTTP body）"),
  'fork-kind': z.string().optional().describe("派生种类：comment（评论/随手派生，默认）或 reopen（验收反馈重开）"),
  forkKind: z.string().optional().describe("同 --fork-kind（驼峰写法）"),
});

// ---- localtask.update ----
export const localtaskUpdateInput = z.object({
  id: z.number().describe("任务编号"),
  text: z.string().optional().describe("改成这个内容；只改时间目标时可省"),
  cwd: z.string().optional(),
  key: z.string().optional(),
  duration: z.string().optional().describe("时间目标时长（2h / 90m）：未领取时设/改声明；只带 --goal-prompt 不带时长会报错"),
  'goal-prompt': z.string().optional().describe("时间目标附加要求（随 check 指令固化）；只改时长不带它则保留原附加要求"),
  goalPrompt: z.string().optional().describe("同 --goal-prompt（驼峰写法，HTTP body 用）"),
  'clear-goal': z.boolean().optional().describe("清掉时间目标声明（未领取时）"),
  clearGoal: z.boolean().optional().describe("同 --clear-goal（驼峰写法，HTTP body 用）"),
  'block-by': z.string().optional().describe("改 DAG 依赖（逗号分隔 id）；空串等同 --clear-block-by"),
  blockBy: z.string().optional().describe("同 --block-by"),
  'clear-block-by': z.boolean().optional().describe("清掉 blockBy 依赖"),
  clearBlockBy: z.boolean().optional().describe("同 --clear-block-by"),
  gate: z.boolean().optional().describe("设/清闸门（true=挡住后续；false=取消闸门）"),
});

// ---- localtask.topic.add ----
export const localtaskTopicAddInput = z.object({
  cwd: z.string().describe("工作目录（绝对路径或可解析的相对路径）"),
  summary: z.string().optional().describe("现状摘要（可选；已登记目录即更新）"),
});

// ---- localtask.topic.remove ----
export const localtaskTopicRemoveInput = z.object({
  cwd: z.string().optional().describe("工作目录（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key（与 --cwd 二选一）"),
  force: z.boolean().optional().describe("连等待中的主题也删（agent 将超时收尾）"),
});

// ---- localtask.topic.removeMany ----
export const localtaskTopicRemoveManyInput = z.object({
  keys: z.array(z.string()).optional().describe("主题 key，逗号分隔"),
  cwds: z.array(z.string()).optional().describe("工作目录，逗号分隔"),
  all: z.boolean().optional().describe("清空全部主题（等待中仍跳过，除非 --force）"),
  force: z.boolean().optional().describe("连等待中的主题一起删"),
});

// ---- localtask.wait ----
export const localtaskWaitInput = z.object({
  cwd: z.string().optional(),
  summary: z.string().optional().describe("已废弃：当前现状不再收（面板上没有对应输入界面）"),
  timeout: z.number().optional().describe("阻塞上限（秒）；缺省用页面配置（推荐 180，最大 600）"),
  'no-open': z.boolean().optional().describe("不自动打开浏览器（测试用）"),
  param: z.array(z.string()).optional().describe("外部参数（平面扩展）：k=v，可重复或逗号分隔；进交付模板 ctx，模板里 {{k}} / {{params.k}} 取"),
});

// ---- localtask.cancel ----
export const localtaskCancelInput = z.object({
  cwd: z.string().optional().describe("工作目录（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key（与 --cwd 二选一）"),
});

// ---- localtask.presence ----
export const localtaskPresenceInput = z.object({

});

// ---- localtask.events ----
export const localtaskEventsInput = z.object({
  cwd: z.string().optional().describe("工作目录过滤（与 --key 二选一）"),
  key: z.string().optional().describe("主题 key 过滤（与 --cwd 二选一）"),
  timeout: z.number().optional().describe("最多监听多少秒后自动结束（默认不限）"),
  limit: z.number().optional().describe("最多输出多少条事件后自动结束（默认不限）"),
});
