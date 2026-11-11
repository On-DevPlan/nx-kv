// repos 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- board.list ----
export const boardListInput = z.object({

});

// ---- board.get ----
export const boardGetInput = z.object({
  id: z.string(),
});

// ---- board.add ----
export const boardAddInput = z.object({
  name: z.string(),
  desc: z.string().optional(),
});

// ---- board.update ----
export const boardUpdateInput = z.object({
  id: z.string(),
  name: z.string().optional(),
  desc: z.string().optional(),
});

// ---- board.remove ----
export const boardRemoveInput = z.object({
  id: z.string(),
});

// ---- board.assign ----
export const boardAssignInput = z.object({
  id: z.string(),
  board: z.string().optional().describe("目标看板 id / key / 名称"),
  before: z.string().optional().describe("插到这张卡片之前（按 key）"),
  remove: z.boolean().optional().describe("移出：带 --board 从该板移出，不带则从所有看板移出"),
});

// ---- board.rekey ----
export const boardRekeyInput = z.object({
  from: z.string(),
  to: z.string().describe("本机仓库：id / key / 路径 / 名称"),
  board: z.string().optional().describe("只在这张看板里重绑（省略 = 自动找包含它的看板）"),
});

// ---- board.prune ----
export const boardPruneInput = z.object({
  board: z.string().optional().describe("只清这张看板（省略 = 全部看板）"),
  all: z.boolean().optional().describe("连带远程地址的占位一起清（它们本来可以 clone 回来）"),
  apply: z.boolean().optional().describe("真正落盘（省略 = 只预览）"),
});

// ---- board.note ----
export const boardNoteInput = z.object({
  id: z.string(),
  board: z.string().describe("看板 id / key / 名称"),
  note: z.string().optional().describe("组内描述（多行可含关键路径/关键词；留空 = 清除）"),
});

// ---- board.import ----
export const boardImportInput = z.object({
  file: z.string().optional(),
});

// ---- board.export ----
export const boardExportInput = z.object({

});

// ---- board.prefix ----
export const boardPrefixInput = z.object({
  prefix: z.string(),
  board: z.string().optional().describe("目标看板（id / key / 名称；缺省 = 与前缀同名，自动新建）"),
});

// ---- repo.ref.clone ----
export const repoRefCloneInput = z.object({
  url: z.string(),
  name: z.string().optional().describe("名称（缺省取 URL 末段）"),
  desc: z.string().optional().describe("一句话描述（它参考什么）"),
  notes: z.string().optional(),
  board: z.array(z.string()).optional().describe("顺手挂到看板（id 可多个，逗号分隔）"),
  bind: z.array(z.string()).optional().describe("绑定的开发仓库（id/路径/名称，可多个，逗号分隔）"),
  depth: z.number().default(1).describe("浅克隆深度（默认 1）"),
  'no-bind': z.boolean().optional().describe("关闭自动绑定（默认绑当前目录命中的开发仓库）"),
});

// ---- repo.ref.add ----
export const repoRefAddInput = z.object({
  path: z.string(),
  remote: z.string().optional().describe("远程地址（目录没有 origin 时必给）"),
  name: z.string().optional(),
  desc: z.string().optional(),
  notes: z.string().optional(),
});

// ---- repo.ref.sync ----
export const repoRefSyncInput = z.object({
  id: z.string().optional(),
  all: z.boolean().optional().describe("同步全部参考仓库"),
});

// ---- repo.ref.check ----
export const repoRefCheckInput = z.object({

});

// ---- repo.ref.backfill ----
export const repoRefBackfillInput = z.object({
  from: z.string(),
  'dry-run': z.boolean().optional().describe("只算差异，不落盘"),
});

// ---- repo.bind ----
export const repoBindInput = z.object({
  id: z.string(),
  repo: z.array(z.string()).optional().describe("开发仓库（id/路径/名称，逗号分隔）—— 写仓库级绑定（不折算成组）"),
  board: z.array(z.string()).optional().describe("组 id/key/名称（逗号分隔）—— 写组级绑定（组内共享）"),
  remove: z.boolean().optional().describe("摘除：带 --repo/--board 摘指定维度，都不带 = 组 + 仓库全部摘除"),
});

// ---- repo.ref.note ----
export const repoRefNoteInput = z.object({
  id: z.string(),
  repo: z.string().optional().describe("开发仓库（id/路径/名称）—— 写仓库级绑定的描述"),
  board: z.string().optional().describe("组 id/key/名称（与 --repo 二选一）—— 写组级绑定的描述"),
  note: z.string().optional().describe("绑定描述（多行可含关键路径/关键词；留空 = 清除）"),
});

// ---- repo.ref.of ----
export const repoRefOfInput = z.object({
  id: z.string().optional(),
});

// ---- repo.knowledge ----
export const repoKnowledgeInput = z.object({
  id: z.string().optional(),
  md: z.boolean().optional().describe("输出拼装好的单篇 markdown（字段名 md），get 封装直接可用"),
});

// ---- repo.remote ----
export const repoRemoteInput = z.object({
  id: z.string(),
  url: z.string().optional().describe("远程地址；缺省时 git remote get-url origin"),
  refresh: z.boolean().optional().describe("同时扫描全部 remote 并提示可更新的 key（同 repo key refresh）"),
});

// ---- repo.key.refresh ----
export const repoKeyRefreshInput = z.object({
  id: z.string().optional(),
  all: z.boolean().optional().describe("刷新全部仓库"),
  apply: z.boolean().optional().describe("把建议写回（自定义 key 只更新 remote，不覆盖 key）"),
});

// ---- repo.key.set ----
export const repoKeySetInput = z.object({
  id: z.string(),
  key: z.string().optional(),
  follow: z.boolean().optional().describe("取消自定义：key 重新跟随远程地址派生"),
});

// ---- repo.key.migrate ----
export const repoKeyMigrateInput = z.object({
  apply: z.boolean().optional().describe("写回磁盘（缺省只预览）"),
});

// ---- repo.remote.list ----
export const repoRemoteListInput = z.object({
  id: z.string().optional(),
});

// ---- repo.remote.pick ----
export const repoRemotePickInput = z.object({
  id: z.string(),
  url: z.string(),
});

// ---- repo.remote.check ----
export const repoRemoteCheckInput = z.object({
  id: z.string().optional(),
  url: z.string().optional().describe("要检查的地址；缺省 = 当前采纳的 remote"),
});

// ---- repo.clone ----
export const repoCloneInput = z.object({
  remote: z.string(),
  key: z.string().optional().describe("登记时用的 key（补占位时填它）"),
  name: z.string().optional(),
  desc: z.string().optional(),
  type: z.enum(["dev", "ref"]).default('dev').describe("dev 落 gitDevRoot，ref 落 gitRepoRoot"),
  depth: z.number().default(1).describe("浅克隆深度"),
});

// ---- repo.list ----
export const repoListInput = z.object({
  type: z.enum(["dev", "ref"]).optional().describe("只看某类：dev=开发仓库，ref=参考仓库"),
});

// ---- repo.get ----
export const repoGetInput = z.object({
  id: z.string(),
});

// ---- repo.add ----
export const repoAddInput = z.object({
  path: z.string(),
  name: z.string().optional(),
  icon: z.string().optional().describe("项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）"),
  desc: z.string().optional().describe("初始描述（写成项目主篇文档；之后描述以文档为准）"),
  notes: z.string().optional(),
  type: z.enum(["dev", "ref"]).optional().describe("dev=开发仓库（默认），ref=参考仓库"),
  remote: z.string().optional().describe("远程 git 地址（key 的来源；导出时导它）"),
  key: z.string().optional().describe("全局唯一 key（必填：有 remote 可省略并按 host/owner/repo 归一化；无 remote 时必须给）"),
  'key-custom': z.boolean().optional().describe("把 key 标记为自定义（显式给 --key 时默认就是自定义，不跟随 remote 变化）"),
});

// ---- repo.detect ----
export const repoDetectInput = z.object({
  path: z.string(),
});

// ---- repo.update ----
export const repoUpdateInput = z.object({
  id: z.string(),
  path: z.string().optional(),
  name: z.string().optional(),
  icon: z.string().optional().describe("项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）"),
  desc: z.string().optional().describe("（已废弃）描述是文档：改正文用 docs set，换绑用 docs bind —— 传了会报错"),
  notes: z.string().optional(),
  type: z.enum(["dev", "ref"]).optional().describe("dev=开发仓库，ref=参考仓库"),
  remote: z.string().optional().describe("远程 git 地址"),
  key: z.string().optional().describe("自定义 key（给了就视为 keyCustom）"),
  'key-custom': z.boolean().optional().describe("key 是否自定义（true=不跟随 remote）"),
  'get-loop': z.enum(["on", "off"]).optional().describe("持续 get 开关"),
  'get-loop-minutes': z.number().optional().describe("无任务时的阻塞窗口（分钟，默认 10，上限 600s 夹制）"),
  'get-loop-template': z.string().optional().describe("领到任务时追加的「继续 get」模板——整体替换为这一条（多条在设置面板按条增删；占位符 {{task.id}}/{{task.text}} 等；置空 = 用默认模板）"),
});

// ---- repo.doc.list ----
export const repoDocListInput = z.object({
  id: z.string(),
});

// ---- repo.doc.add ----
export const repoDocAddInput = z.object({
  id: z.string(),
  rel: z.string().optional().describe("自有树内相对路径（如 repo/github.com/me/x.md）"),
  path: z.string().optional().describe("外部绝对路径（只读引用）"),
  ref: z.string().optional().describe("参考仓库 key（type=ref 的本机仓库）"),
  file: z.string().optional().describe("参考仓库内的相对路径（配合 --ref）"),
  note: z.string().optional().describe("这篇的说明"),
  tag: z.string().optional().describe("分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）"),
});

// ---- repo.doc.remove ----
export const repoDocRemoveInput = z.object({
  id: z.string(),
  index: z.number().describe("序号（1 = 主篇）"),
});

// ---- repo.remove ----
export const repoRemoveInput = z.object({
  id: z.string(),
});

// ---- repo.scan ----
export const repoScanInput = z.object({
  root: z.string().optional(),
  depth: z.number().default(3),
  'dry-run': z.boolean().optional().describe("只列出发现的仓库，不登记"),
});

// ---- repo.open ----
export const repoOpenInput = z.object({
  id: z.string(),
});

// ---- repo.export ----
export const repoExportInput = z.object({
  zip: z.string().optional().describe("打包成 zip 写到这个路径（含 layout.json + README）"),
  repos: z.array(z.string()).optional().describe("只导出这些仓库 key（逗号分隔；空 = 全部）"),
  boards: z.array(z.string()).optional().describe("只导出这些看板 key（逗号分隔；空 = 全部）"),
  'no-unassigned': z.boolean().optional().describe("不带未分组的仓库"),
});

// ---- repo.import.diff ----
export const repoImportDiffInput = z.object({
  file: z.string().optional(),
  json: z.string().optional().describe("（面板）直接给布局 JSON"),
});

// ---- repo.import ----
export const repoImportInput = z.object({
  file: z.string().optional(),
  json: z.string().optional().describe("（面板）直接给布局 JSON"),
  strategy: z.enum(["ours", "overwrite", "duplicate"]).default('ours').describe("冲突方案：保留本地 / 覆盖 / 另存 key-import-N"),
  select: z.array(z.string()).optional().describe("只处理这些仓库 key（逗号分隔；空 = 全部）"),
  boards: z.array(z.string()).optional().describe("只处理这些看板 key（逗号分隔；空 = 全部）"),
  clone: z.enum(["all", "dev", "ref", "none"]).optional().describe("要克隆哪些（默认 none = 只登记）"),
});

// ---- repo.bind-topics ----
export const repoBindTopicsInput = z.object({
  repo: z.string().optional().describe("仓库 id / key / 路径 / 名称（缺省 = 全部登记仓库）"),
  apply: z.boolean().optional().describe("真正落盘（省略 = 只预览命中计划）"),
});
