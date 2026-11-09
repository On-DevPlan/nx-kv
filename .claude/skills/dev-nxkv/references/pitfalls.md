# 常见坑与反模式

按「症状 → 根因 → 正确做法」记。都是本仓库真实踩过的。

## 架构与分层

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 面板上有的操作 CLI 没有 | 绕过 action 直接在前端/服务里写逻辑 | 所有操作先做成 action（`cli` 必有，`http` 可选），面板只调 `/api/*` |
| 循环依赖 / 启动即报错 | `modules/A` import `modules/B` 内部文件；或 runtime ↔ module 成环 | 跨模块只用对方 service 导出面；runtime 可 import modules，反向禁止 |
| 业务逻辑散落 | 在 `core/` 或 `shared/` 写业务 | `core/` 只放原语，`shared/` 只放无副作用纯函数，业务留在模块 service |
| 页面用后端私有函数 | 前端 import 后端模块 | 前端只能 `/api/*` + `src/shared/`；违反会被 `eslint.config.js` 拦 |
| 新增模块后跨模块 import 没被拦 | eslint 模块禁列是**枚举式**，漏补新模块就静默 | 新增模块时手动补 `'../<新模块>/*'`；别只依赖 review |
| 新增页面后整页白屏/`X is not defined` | 前端漏 import；前端 `no-undef` 已开 | 查 import；`pnpm lint` 会点名 |

## 存储与 SQL

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 引入 JSON 文件/原子 rename/文件锁做业务数据 | 沿用改造前的存储思路 | 本项目唯一业务数据源是 SQLite；文件只存附件/文档内容 |
| 测试把数据写进用户真实库 | 测试未隔离库路径 | 用 `tests/support/test-store.mjs` 临时库；它断言路径必须在 tmp 下 |
| 迁移后真实历史数据丢失 | 只适配夹具格式 | 迁移前跑 `db backup --dry-run`/`db migrate --dry-run`，覆盖旧 JSON、旧 key、软删行、跨队列依赖 |
| 软删语义矛盾 | 部分路径软删、部分硬删；查询漏过滤 | 全链路统一 `deleted_at IS NULL`；软删后同 key 再建应是恢复同一行，不是两行抢 UNIQUE |
| 任务依赖指向错误任务 | 把队列内 `seq` 写进 `task_deps.dep_id` | `dep_id` 必须是全局 `tasks.id`；插入时按 `(topic_id, seq)` 解析后再写，并与插入同事务 |
| 并发新增撞唯一索引 | 事务外预分配编号 | 编号分配 + 插入放在同一事务（`topics.next_seq` 只增不减） |
| 事务中途失败留下半套数据 | 跨表操作未包事务 | 多表/多行写入统一 `txw(...)`；回调内不要 `await` 外部 IO |
| 用 `tasks.id` 当 CLI 编号 / 用 `seq` 当外键 | 两个身份混用 | 对外显示 `seq`（`#12`），外键/依赖/派生链一律 `tasks.id` |
| `version` 是死列 | 声明了乐观锁字段却不递增/不校验 | 每次更新递增并在 `WHERE version = :old` 中校验；与 `round`（派生轮次）不是一回事 |
| 把需要过滤的字段塞进 `ext` | 图省事 | `ext` 无索引，**凡是要进 WHERE 的字段都不许进 ext** |

## 提示词与模板

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 改了模板但领取结果没变 | 改的是 `templates` 表（任务正文模板），或没选中该区块的生效模板 | 提示词改对应区块的模板列表，并确认该块当前生效项 |
| 出现 `[object Object]` | 旧模板把列表变量当字符串插值 | 列表用 `{{#each}}`；旧纯文本占位符交给 `migrateLegacyPlaceholders` 迁移 |
| 恢复出自研解析器/区块对象 | 参考了旧文档或旧代码 | 只保留「共享 ctx + 字符串模板 + 薄编排」；`items/wrapper/{{block.content}}` 仅迁移兼容 |
| 每个区块又搞一套变量域 | 沿用了旧「区块对象」思路 | 所有区块共用 `buildDeliveryCtx` 的一份 ctx，不要把变量字典或语法说明搬进 UI |
| 服务端先拼多行文本再塞模板 | 为了方便 | 传结构化数组，模板里 `{{#each}}` 组织行 |
| 提示词里的 `<`/`&` 变成 HTML 实体 | 忘了关转义 | 引擎固定 `noEscape: true`，不要给模板单独加转义选项 |
| 保存坏模板成功、领取时被悄悄换回内置 | 没有保存校验，只靠运行期回落 | 保存时 `validateTemplate`（precompile）拒绝；运行期回落必须写 `renderWarnings` |
| 一条坏模板让整个队列领不出任务 | 把渲染异常当致命错误 | 该块回落内置模板，不阻断领取，但告警必须可见 |
| 正文里的 `{{...}}` 被二次解析 | 多层渲染/预渲染 | 单遍渲染；`task.text` 只作为数据插入 |

## 任务/依赖/渲染链路

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 预览和真实领取不一致 | 复制了一套预览渲染 | 预览必须复用 `buildTaskDelivery`（`preview: true`），不得另写渲染 |
| 预览「看起来对」但真实 get 缺上下文 | 用 `--text` 草稿预览 | 草稿预览绕开库存/附件/目标路径；最终证据必须用 `--id` 或真实 `get` |
| 依赖查询卡死 | 递归 CTE 无深度/回环保护 | 使用 `core/workflow/readiness.js` 的现有实现；新增图算法必须加回环 + 深度上限 |
| 引擎写回把手工依赖洗掉 | 快照覆盖 `blocks_following` / `blockBy` | 本地依赖取「现有 ∪ 快照边」并集；闸门边不写 `blockBy` |
| 跨队列依赖进了本队列 DAG | 没区分 `"topicKey:seq"` 与本地 id | 跨队列依赖只落任务行 `blockBy` 的 foreign 部分，不进本 topic 引擎节点图 |

## 术语与设置键

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 文档/UI 里「主题」「目录」「队列」混用 | 历史命名漂移 | 本地实体统一叫「队列（topic）」；「云端主题」明确加 cloud 前缀；「目录」只是页面视图 |
| 「项目组」和「仓库组」对不上 | UI 叫项目组、CLI 叫 board、schema 叫 group | 代码/文档统一 `repo group` / `group_key`；`board` 仅历史 CLI 别名 |
| 继续写旧设置键当来源 | 不知道新权威位置 | 权威是各区块自己的模板列表与生效项；旧键只用于迁移 |
| 把 `config.groupId` 当成仓库组 | 两个 `group` 重名 | `config.groupId` 是云端工作空间；仓库组是 `repos.type='group'` |
| 仓库 key 又按名字/随机生成 | 沿用了旧 `local/<name>` 兜底 | key 只能显式给或由 remote 归一化；无 remote 时必须报错让用户填，导入同理 |
| clone 之后任务链断了 | clone 只复制正文，没写派生边 | 需要保留链用 `fork`（正文复制 + `task_links` type=comment）；两者语义不要混用 |

## 交付与文档

| 症状 | 根因 | 正确做法 |
|---|---|---|
| 汇报「测试通过」但拿不出输出 | 只看退出码/凭感觉 | 附命令与关键输出；渲染给 preview/get 片段，DB 给 `verify` 结果 |
| CLI 改了但 README/技能还是旧命令 | 只改代码 | 同步 `README.md`、`docs/project&projectsCli.md`、`assets/<name>/` |
| 面板设置出现两套同样功能 | 任务模板与提示词模板混写 | 设置页保持「任务模板」与「提示词模板」分离，各自单一 CRUD |
| 在真实库上试迁移/试模板 | 图快 | 先 `nx-kv db backup`；迁移先 `--dry-run`；模板先在临时库或 preview 验证 |
| 提交混入并行会话的改动 | 图省事 `git add -A` | 只按文件名 add 本次自己的文件；工作区可能有多会话 |
| 新样式写进 `style.css` | 没注意 v1/v2 | 新样式优先 `style-v2.css` 的 tokens；`style.css` 只存量维护 |
| 以为 `task_refs` 有数据 | 表存在 ≠ 功能在用 | 任务附件看正文 markdown + 本机附件仓；`task_refs` 当前无写入方 |
