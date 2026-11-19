// localtask 的**跨语言出参视图**（契约用，见 ActionMeta.output）。
//
// 为什么单独一个文件：`localtask.get` / `claim` / `done` / `reopen` / `add` / `update`
// 六条 action 都要往外说话，其中「一条任务长什么样」必须**只写一次**——写成六份，
// 字段迟早分叉，端侧就会看到「同一个东西，两个名字」。
//
// 一条纪律：**这里是视图，不是 service 的返回结构**。
//   · `localtask.list` 刻意不声明 `tasks`（每个主题挂着全部任务，某主题实测 194 条）；
//   · `claim` / `done` / `reopen` 刻意不声明 `task` 整体，只给 `taskId`——
//     端侧要看详情就调 `localtask.get`，别让「领一条」变成「解码一份长正文」；
//   · 声明少了不影响服务端返回（契约不裁剪运行时响应，见设计 §4.3），
//     CLI 与 HTTP 的完整返回一个字都不变。
import { z } from 'zod';

/** 正文里引用到的一个附件（服务端已标好本地路径与用法）。 */
export const attachmentView = z.object({
  id: z.string(),
  kind: z.string().describe('file / url / task / ref …'),
  kindLabel: z.string().describe('给人看的种类名'),
  name: z.string(),
  sizeText: z.string().describe('已格式化的大小（65.8 KB）；url 类可能为空串'),
  isImage: z.boolean(),
  size: z.int().optional(),
  mime: z.string().optional(),
  note: z.string().optional().describe('附件上的备注（原型图、日志…）'),
  localPath: z.string().optional().describe('本机绝对路径；未落盘时为空'),
  exists: z.boolean().optional().describe('本地文件是否还在'),
  needsSync: z.boolean().optional(),
  cmd: z.string().optional().describe('需要同步时给用户的一条命令'),
  usage: z.string().optional().describe('agent/端侧该怎么用它（已在本机就直接读）'),
});

/** 一条任务：端侧详情页要显示的全部字段。 */
export const taskView = z.object({
  id: z.int().describe('任务编号（主题内自增，跨主题不唯一）'),
  text: z.string().describe('正文（Markdown，可能带 frontmatter）'),
  status: z.string().describe('pending / claimed / done / cancelled'),
  round: z.int().describe('第几轮（每次重开 +1）'),
  roundSummary: z.string().describe('本轮完成总结；未完成时为空串'),
  reopenCount: z.int(),
  childCount: z.int(),
  childRoundCount: z.int(),
  createdAt: z.string(),
  consumedAt: z.string().describe('被领取的时间；未领取为空串'),
  pickupSec: z.int().nullable().describe('入队到领取的秒数；未领取为 null'),
  completedAt: z.string(),
  doneAt: z.string(),
  feedback: z.string().describe('完成总结原文（与服务端历史同一份）'),
  claimedBy: z.string().describe('领取方标识（agent / 端侧）'),
  claimedByName: z.string(),
  claimedFrom: z.string().describe('local / global'),
  ready: z.boolean().describe('当前是否「可领取」'),
  blocksFollowing: z.boolean().describe('是否为闸门任务'),
  blockBy: z.array(z.string()).describe('依赖的任务 id（全部完成后本条才可领）'),
  deletedAt: z.string(),
  archivedAt: z.string(),
  archivedReason: z.string(),
  attachments: z
    .array(attachmentView)
    .optional()
    .describe('正文引用到的附件；标注失败时整个字段缺失（fail-open）'),
});

/**
 * 「领一条」的结果视图。
 *
 * status 是**三态闭集**：ok 领到 / timeout 暂时没活 / blocked 被依赖或闸门挡住。
 * 端侧据此决定「进详情」「停在队列」「解释为什么领不了」，不必解析错误文本。
 *
 * 只回**编号**不回整条任务：领到手的那一刻端侧要跳详情，但详情页的正文、
 * 附件、轮次是 `localtask.get` 的活 —— 让「领一条」顺手多解码一份长正文，
 * 是端侧最容易被拖慢的地方（历史某主题一条正文 200KB）。
 */
export const claimView = z.object({
  status: z.enum(['ok', 'timeout', 'blocked']).describe('领取结果：ok / timeout / blocked'),
  taskId: z.int().optional().describe('领到的任务编号（status=ok 时有）'),
  name: z.string().optional().describe('主题名'),
  summary: z.string().optional().describe('主题现状'),
  timeoutMs: z.int().optional().describe('timeout 时的等待上限（毫秒）'),
  instant: z.boolean().optional().describe('是否为「没活就立刻回」的即时模式'),
});

/** 「新建一条」的结果视图（只回编号：详情交给 `localtask.get`）。 */
export const addView = z.object({
  status: z.string(),
  id: z.int().describe('新任务编号'),
  name: z.string().optional().describe('落进哪个主题'),
  cwd: z.string().optional(),
  delivered: z.boolean().optional().describe('是否即时投递给正在 wait 的 agent'),
  queued: z.boolean().optional().describe('是否只是排队等人领取'),
});

/** 「改正文」的结果视图（只回编号）。 */
export const updateView = z.object({
  status: z.string(),
  id: z.int().describe('被改的任务编号'),
  name: z.string().optional().describe('当前所在主题'),
  cwd: z.string().optional(),
  moved: z.boolean().optional().describe('是否因归属变了而换了队列'),
});

/** 「标完成」的结果视图。 */
export const doneView = z.object({
  status: z.string().describe('ok / blocked'),
  completed: z.boolean().optional().describe('本次是否真的标成了完成'),
  already: z.boolean().optional().describe('之前就已经完成过（无需重复标记）'),
  completedAt: z.string().optional(),
  reason: z.string().optional().describe('blocked 的原因：not_claimed / goal_not_reached …'),
  remainingSec: z.int().optional().describe('时间目标未到点时还差多少秒'),
  deadline: z.string().optional().describe('时间目标的截止时间'),
  hint: z.string().optional().describe('给人看的下一步提示'),
});

/**
 * 「重开 / 评论」的结果视图。
 *
 * 注意 `id` 是**新任务**的编号，`parentId` 才是被评论的那条——
 * 端侧提交完评价后应该跳到 `id`，否则会停在一条已经被历史压住的任务上。
 */
export const reopenView = z.object({
  status: z.string(),
  id: z.int().describe('重开后产生的新任务编号'),
  parentId: z.int().optional().describe('被重开的原任务编号'),
  kind: z.string().optional().describe('reopen（验收反馈）/ comment（划选评论）'),
  name: z.string().optional(),
  moved: z.boolean().optional().describe('是否因正文里的归属变了而换了队列'),
  reopened: z.boolean().optional(),
  forked: z.boolean().optional(),
});
