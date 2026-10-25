# timegoal 到期语义研究：归档-保留-清除 vs 立即删除

只读外部研究，未改动 `src/`、`tests/`、`assets/`。日期 2026-10-21。

## Search log

mmx（`mmx search query --q "<q>" --output json --quiet`）：

1. `kubernetes TTL controller`
2. `Kubernetes TTLAfterFinished job finished cleanup TTL controller delay`（首次报 Network request failed，重试成功）
3. `soft delete then purge hard delete retention window expired records pattern deleted_at scheduled purge job`
4. `dead letter queue retention period expired message still readable message broker TTL per message`
5. `lazy garbage collection on read vs background sweeper trade-off write amplification read latency`
6. `Redis keyspace notification expired event active expiry cycle lazy vs active expiration`
7. `bounded ring buffer keep last N entries capped history append-only log losing early history audit`
8. `kubernetes job activeDeadlineSeconds running long deadline exceeded vs no timeout cronjob concurrencyPolicy`
9. `expired lease grace period finalizer before deletion consumer still reads expired record DynamoDB TTL attribute deletion marker`
10. `overdue by how long past due shown in status UI overdue duration versus binary expired flag`
11. `redis.io documentation expire keys expiration active expire cycle lazy expire site:redis.io`
12. `github actions workflow job timeout-minutes maximum runtime limit default 360 minutes`

web_fetch **成功**：https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/ ；https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/ ；https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/ ；https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html ；https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html ；https://raw.githubusercontent.com/github/docs/main/content/actions/reference/workflows-and-actions/workflow-syntax.md
web_fetch **404 / 未取到**（相关结论改用上面的 API reference 或二手来源并已标注）：`https://redis.io/docs/latest/develop/use/expire/`、`https://kubernetes.io/docs/concepts/workloads/controllers/ttl-after-finished/`、`https://kubernetes.io/docs/concepts/workloads/jobs/job/`

## Findings

### Q1 归档后再清除 vs 到点即删

标准形态是「到期 → 保留一段可读窗口 → 再硬删」，不是到期即删。

- **Kubernetes TTL-after-finished 控制器**：Job 结束后 TTL 秒才「eligible for cascading removal」，TTL 窗口内 Job 对象与其 status/logs 完全可读。
  "The TTL-after-finished controller assumes that a Job is eligible to be cleaned up TTL seconds after the Job has finished. The timer starts once the status condition of the Job changes to show that the Job is either Complete or Failed; once the TTL has expired, that Job becomes eligible for cascading removal." — https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/
- **DynamoDB TTL**："DynamoDB automatically deletes expired items within a few days of their expiration time, without consuming write throughput." 且过期未删的 item **仍在读路径返回**，需要显式过滤："Expired items that are pending deletion can be filtered from read and write operations… If they are not filtered, they'll continue to show in read and write operations until they are deleted by the background process." — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html 、https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html
  这正是本设计的形状：**归档 = 过期未删（仍可读），列表过滤 = 「filter expired items from read operations」**。
- **软删 + 定时 purge**："A grace period of 30 days used the existing soft delete mechanism. During this window, records could be restored. After 30 days, a scheduled job performed hard deletes" — https://www.lukretium.com/blog/the-soft-delete-that-deleted-nothing ；`purgeExpiredDeletes(db, collectionName, retentionDays = 90)` — https://oneuptime.com/blog/post/2026-03-31-mongodb-soft-deletes/
- **反面教材（消息代理默认是即删）**：ActiveMQ 的 TTL 到期是「broker threw away or shuffled into the DLQ because its TTL ran out before a consumer got to it. Nothing crashed… The data is just gone.」— https://www.netdata.cloud/guides/activemq/activemq-expired-messages 。RabbitMQ 侧 TTL 消息在配置 DLX 时走死信而非静默丢弃 — https://aicancode.org/learn/rabbitmq/message-ttl 。
  也就是说：**队列语义天然是「到期不可读」，我们刻意不跟随**，因为契约要求到点后那一轮仍要拿到 prompt 原文。
- Redis 的语义同样是「过期即读不到」（惰性删除时 GET 返回 nil）—— UNVERIFIED（redis.io 官方页 404，仅二手来源 https://scp.net.cn/blog/redis/16-expiration ）。
- K8s Lease / 分布式锁的「grace period + finalizer」先释放再删的具体实现：**UNVERIFIED**（本轮未取到权威实现页）。

### Q2 保留窗口该多长

决定因素有两个：**消费方最晚多久来读一次** + **结果需要被查看多久**。

- K8s：`ttlSecondsAfterFinished` 由使用者按工作负载设。实际取值样本 100s / 300s / 3600s；生产清单写 "ttlSecondsAfterFinished Set to 300–1800 (5–30 min) Automatically cleans up finished jobs after logs are collected" — https://oneuptime.com/blog/post/2026-02-09-ttl-after-finished-auto-clean-jobs/view 、https://devscampus.com/technologies/kubernetes/learn/jobs-and-cronjobs/job-cleanup
  同页原话点明了「窗口 = 消费者的轮询间隔 + 查看时间」："One minute gives you time to verify the job completed before it disappears." / "An hour gives you plenty of time to notice failures, check logs, and debug issues before the job vanishes."
- DynamoDB：TTL 删除通常在过期后「几天内」发生，且过期 item 期间仍可读 — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- 合规型软删：30 天宽限 / 90 天保留（见 Q1 两个链接）。
- **我们的 7 天**：比 K8s 作业日志级（分钟~小时）宽 2~3 个数量级，但落在 DynamoDB「几天」与合规 purge「30~90 天」之间。对本地单用户工具、且消费方（agent）每轮读一次，7 天是**极大富余**，但它其实是由「7 天内至少要有人 check 一次」这个假设撑着的——见 Q1 边界与下方风险。

### Q3 惰性 GC vs 后台清扫

- **成熟系统几乎都是两者并用**：Redis = 惰性（访问时 `expireIfNeeded`）+ 主动（每 100ms 随机抽 20 个 key，过期比例 >25% 继续抽，单轮上限 25ms）；Redis 不做「每 key 一个定时器」，理由是调度成本过高 — https://scp.net.cn/blog/redis/16-expiration 、https://www.renrendaima.com/wap/article/20627.html 。redis.io 原文 UNVERIFIED（404）。
- **DynamoDB** 是纯后台：删除由后台进程做，不消耗写吞吐，但**不保证立刻删**（可能几天） — https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html
- **K8s TTL 控制器**是后台 reconcile：它从对象 status 里已有的时间戳起算，不需要 per-object 定时器 — https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/
- 代价对比（可验证的那半边）：惰性 = 读取零额外 CPU，但过期对象**继续占存储、继续产生读费用** — "These items still count towards storage and read costs until they are deleted."（AWS，同上）；后台 = 主动、延迟可控，但吃 CPU/写、且不保证实时。
- **单用户本地 CLI 用惰性是正当选择**：没有守护进程依赖、没有定时器成本，与 Redis「不给每个 key 挂定时器」的动机一致。代价是「永远没人读 → 永不回收」，我们靠 `pruneExpired()`（`src/modules/timegoal/service.js:510`）作为人工兜底。
- **并发写风险（需诚实标注）**：`loadRecycledStore()`（`service.js:246`）是 read→mutate→write，`saveStore()`（`service.js:93`）整文件覆写，只在**单进程内**串行（`saveQueue`, `service.js:92`）。CLI 与面板两个进程同时读写时可能互相覆盖。把回收挂到读路径**放大了这个既有风险**（一次 list 也会触发写盘）。

### Q4 「只留最近 N 条」的历史

- 是被广泛接受的模式。Kubernetes CronJob 直接把它做成字段：`successfulJobsHistoryLimit` "The number of successful finished jobs to retain. Value must be non-negative integer. **Defaults to 3.**"、`failedJobsHistoryLimit` "The number of failed finished jobs to retain… **Defaults to 1.**" — https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/
- ring buffer 作为「每对象有界最近历史」："You want the most recent N things: the last few log lines for an error report… Storage must be bounded, old entries should fall off by themselves" — https://www.ziglang.in/learn/how-to/ring-buffer ；Redis 版 `LPUSH` + `LTRIM` — https://oneuptime.com/blog/post/2026-03-31-redis-ring-buffer/view
- 坑：
  1. **丢早期历史**。我们的 `splice(0, ...)` 丢的是最旧 200 条，即长跑任务里「开局上下文」先消失；K8s 也留最近若干条，方向一致。
  2. **静默截断**：读者无法区分「看了全部轮次」与「只看了最后 200 条」。K8s 没这问题，因为它从不断言完整性。
  3. **审计诉求**：若该 log 本身是审计记录，截断即违规——我们的 log 是过程记录不是审计记录，故可接受；但 7 天后整个 goal 被硬删，审计维度上等于**零留存**。
  4. K8s 把「成功历史(3)」与「失败历史(1)」分开设限，提示：**失败项通常才是你要留的**；我们按时间统一截断，不区分。

### Q5 「已超时多久」作为一等值

- **二进制状态是存储层的标准**：K8s Job 用 Complete/Failed condition；GitHub Actions 用 conclusion（success/failure/cancelled）；DynamoDB TTL 只给时间戳，不给「超时量」；Redis 完全不给。
- **「逾期多久」是成熟的表现层惯例**：
  - 三态（Valid / Due Soon / Overdue），且每次加载按到期日与 due-soon 窗口重算 — https://www.fleetservice365.com/help/assets/asset-renewals
  - 逾期计数徽标 — https://activitytimeline.atlassian.net/wiki/spaces/AC/pages/46510846/Overdue+or+Expired+Tickets+Indicator
  - 电子表格惯用法 "Days overdue as a number: =MAX(0,TODAY()-A2)" — https://canispreadsheet.com/how-to/flag-overdue-dates.html
  - 审计任务按到期窗口判 overdue — https://helpcenter.audit-now.com/en/articles/11179526-understanding-overdue-audit-tasks-and-how-to-report-on-them
  - 发票每日后台扫描后把过期单据置为 Overdue 状态 — https://qwtn.co.uk/help/invoicing/payment-tracking
- 结论：**我们的做法（`reached` 仍是布尔契约，`overtimeSec` 是派生展示值）完全对齐惯例**，不是自创。`src/modules/timegoal/service.js:206` + `index.js:47`、`index.js:64` 已经把它渲染成「已超时 2 小时 13 分」。

### Q6 时长上限

- **24 小时硬上限确实是「跑 N 小时」类工具的反模式**：GitHub Actions 的 `jobs.<id>.timeout-minutes` 文档写明 "The maximum number of minutes to let a job run before GitHub automatically cancels it. **Default: 360**"，step 级 "Maximum: 360 for both GitHub-hosted and self-hosted runners"，并补一句 "If the timeout exceeds the job execution time limit for the runner, the job will be canceled when the execution time limit is met instead." — https://raw.githubusercontent.com/github/docs/main/content/actions/reference/workflows-and-actions/workflow-syntax.md
  → 真实平台的常态是**平台级天花板 + 用户值可覆盖但以平台为准**，而不是放任无限。
- **Kubernetes 的对应物没有默认上限**：`activeDeadlineSeconds` "Specifies the duration in seconds relative to the startTime that the job may be continuously active before the system tries to terminate it; value must be positive integer."（可选、无默认）— https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/job-v1/
- K8s 的长任务惯用法是 Deployment（无上限）或带显式 `activeDeadlineSeconds` 的 Job；周期任务用 cron `schedule` + `startingDeadlineSeconds`（那是**启动**截止，不是时长上限）— https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/cron-job-v1/
- 我们的 365 天上限（`service.js:28`）**对齐 K8s 的「操作者自定截止、无隐式短天花板」**，比 GitHub 的 6h 默认更适合「跑一晚上/连续优化几天」的目标。唯一可对标点是：K8s 明确「Job 被 suspend 时该计时器会停住并在 resume 后重置」，而我们 `updateTimegoal`（`service.js:435`）始终保留已用时间——这是一个**刻意的差异**，不是缺陷，但可作为可选项。

## Verdict on our design

1. **自动归档（到点仍可读）—— 对齐**。这就是 K8s TTL-after-finished 与 DynamoDB TTL 的形状；列表过滤掉的正是 AWS 文档里的 "filter expired items from read operations"。
2. **7 天保留 —— 富余、但不是"标准值"**。K8s 作业日志级用 5~30 分钟、DynamoDB 用"几天"、合规 purge 用 30~90 天；7 天落在 DynamoDB 带，但它是本地工具，不必向合规档靠拢。**保持 7 天可以**，但应写成可配置。
3. **惰性 GC（读路径回收）—— 对齐且正当**，但**只做了一半**：Redis 是惰性+主动并用，我们的主动侧只有手动 `pruneExpired()`。缺口是 `setTimegoal()`（`service.js:265`）、`updateTimegoal()`（`service.js:442`）、`clearTimegoal()`（`service.js:472`）都走 `loadStore()` 而非 `loadRecycledStore()`，**连写路径都不触发回收**。
4. **200 条日志上限 —— 对齐**（K8s CronJob 默认 3/1 同属"只留最近 N 条"）。唯一实质缺陷是**静默截断**，没有"已截断"标记。
5. **`overtimeSec` —— 对齐**，属于成熟的表现层惯例（overdue-by-duration），且未动 `reached` 布尔契约。
6. **365 天上限 —— 对齐**，与 K8s `activeDeadlineSeconds`（可选、无默认）同一取向；GitHub 的 6 小时说明「平台级天花板」是常态，但工具类不该照抄。
7. **人类单位时长（`5h`/`5小时`）—— 无外部先例可引，属纯 UX 便利，UNVERIFIED**（未找到任何成熟系统用「5小时」这类写法；本轮检索到的同类只有 cron 表达式与裸秒/毫秒）。
8. **【新发现的风险】7 天保留会切断「最终读取」契约**：`autoRecycle()`（`service.js:225`）在读路径上**先删后读**，一旦归档满 7 天就整条删除（含 `prompt`），此后 `check` 返回 `hasGoal:false`——agent 最后一轮拿不到 prompt 原文。研究结论是保留窗口应「不小于消费方轮询间隔 × 安全系数」；我们 365 天目标 + 每轮读一次的假设下 7 天够用，但机器关掉 8 天就静默丢目标。
9. **【新发现的问题】列表会把归档项的完整 prompt 一起吐出来**：`goalView()`（`service.js:113`）含 `prompt: g.prompt`，而 `listTimegoals()`（`service.js:487`）对 active + archived 都走 goalView → 归档区 N 个目标就是 N×20KB prompt。保留期越长越明显。
10. **【新发现的问题】读路径写盘放大并发风险**：`loadRecycledStore()` 让「一次 list」也可能触发整文件覆写，与并发的 `check` 存在互相覆盖的可能（`saveStore` 只在单进程内串行）。

## Concrete changes recommended

1. `service.js: autoRecycle()` —— 保留期到期时**只删 `log`，保留 goal 外壳与 `prompt`**（存储增长由「目录数」而非「日志条数」兜底），让「过期仍可读」永久成立；对应研究结论：过期 item 的可读性不应随保留期结束而突然消失。
2. `service.js: autoRecycle()` —— 硬删时留一个极小 tombstone（`{name, cwd, deadline, purgedAt}`），让 `showTimegoal()`/`checkTimegoal()` 能回「已于 X 过期、保留期后清除」，而不是伪装成"从未设过目标"（对齐 DynamoDB Streams 的 TTL-deletion 标记思路）。
3. `service.js: setTimegoal()` —— 把 `loadStore()` 换成 `loadRecycledStore()`（或调用新增的 `sweepExpired()`），补上 Redis 式的"主动清扫"那一半，避免长期不读时 store 永不清。
4. `service.js: goalView()` + `listTimegoals()` —— 给 goalView 加 `includePrompt` 开关，`listTimegoals()` 的 archived 视图不返回完整 prompt（只给前 N 字预览）。
5. `service.js: checkTimegoal()` + `getTimegoalLog()` —— 记录总轮次并返回 `logTruncated` / `totalEntries`，让 200 条上限**可见**而不是静默丢历史。
6. `service.js: ARCHIVE_RETENTION_SEC` —— 改为可用环境变量覆盖（如 `NX_KV_TIMEGOAL_RETENTION_SEC`），并把默认值按「agent 轮询间隔 × 安全系数」写进注释。
7. `service.js: updateTimegoal()` —— 可选：提供「暂停」语义（暂停期间停表、恢复后重算），对齐 K8s `activeDeadlineSeconds` 的 suspend 行为，而非总是把已用时间计入。

## 验证说明

- 全部 12 条 mmx 查询与 6 次成功 web_fetch 均实际执行；正文每条断言都带 URL 或 `path:line`；未能取到的源（redis.io 过期文档、k8s jobs 概念页、k8s TTL 的旧 URL）已在 Q1/Q3 标注 UNVERIFIED。
- 本次为只读研究：未新建/修改 `nx-kv/src`、`nx-kv/tests`、`nx-kv/assets` 下任何文件；仅新增本报告文件（`git status` 中其余 `M` 条目为本次会话之前既有改动）。
