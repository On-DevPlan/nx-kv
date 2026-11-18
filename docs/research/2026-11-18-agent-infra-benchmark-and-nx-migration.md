# AI 组参考仓库基础设施调研：协议层、多端、特殊技术栈，以及 nx 的迁移融合方案

> 调研时间：2026-11-18
> 范围：`D:\a_other\nxkvrepo\` 下 16 个参考仓库 + 独立 `codex` 目录（OpenAI Codex CLI 源码）
> 方法：直接读 README、`docs/` 架构文档与驱动源码。本文只写仓库里能找到出处的事实；推断部分标「判断」。
> 目标：回答三个问题——**① 通过什么协议调用 Claude Code / Codex；② 多端怎么设计；③ 有哪些特殊技术栈实战**——并落到 nx-kv 的迁移路径。

---

## 0. 结论先行

1. **这些仓库的差距不在「功能多少」，而在「是否把 agent 的执行当成一个可远程控制的进程」。** 同样是「AI 工具」，大致分四层：L1 协议封装（MCP / CLI）、L2 控制平面（RPC / 事件 / 配对）、L3 执行编排（会话 / 权限 / 恢复）、L4 设备与环境网络（多机 / 路由 / 能力出借）。记分卡见 §1。

2. **调用 Claude Code / Codex 没有唯一标准，但有一条正在收敛的路径：ACP。** T3 Code 已用 ACP v2 preview + v1 回退统管 Claude、Codex、Cursor、Grok、OpenCode、Pi、Antigravity 以及任意 Registry agent；DeepSeek Harness 直接以 `dsh --profile acp` 接入。Claude Code 自己的原生协议是**双向 stream-json**，Codex 是 **app-server JSON-RPC（NDJSON over stdio）**，两者都能被 ACP 包一层。

3. **多端的主流答案不是「同步状态」，而是「一个宿主 + 多个瘦客户端」。** T3 Code：执行留在拥有 workspace 的机器；OpenMausBot：一台机器是 home，其他设备只是开它的窗口；OpenClaw：一个 Gateway，客户端与 node 都连它。**没有任何一家在客户端复制一份业务状态。**

4. **nx 已经具备最好的起点，但缺三块：契约覆盖、远程身份与事件流、执行适配层。** 实测：135 个 action 文件，只有 11 条 action 进入 `contract/contract.json`；`serve` 默认且只能绑 `127.0.0.1`，没有 token、没有 SSE/WS；没有 agent 会话。把这三块补上，nx 就能从「本机工具」升级为「自己的设备网络」。

---

## 1. 成熟度记分卡

| 层级 | 判据 | 代表仓库 | 关键证据 |
| --- | --- | --- | --- |
| **L0 单机工具** | 只有本地命令/面板，无对外协议 | — | — |
| **L1 协议封装** | 把能力包成 agent 可调用的 CLI/MCP/skill，但无状态编排 | astryx、cli-anything、anthropics/skills、firecrawl | `astryx docs ...` 给 agent 查文档；cli-anything 每个软件一个 CLI + SKILL.md；skills 仓库是 Agent Skills 规范与插件市场 |
| **L2 本地服务/设备桥** | 有常驻进程、快照/引用、错误契约，但仍以单机为主 | agent-desktop、agent-browser、code-review-graph、mem0、skillevaluator | agent-desktop 61 命令 / 57 可操作，stdio MCP；agent-browser daemon + CDP；CRG 一文件 SQLite + MCP；SkillEvaluator 500+ 静态规则 |
| **L2.5 分发层** | 能把 harness/skill 批量装进别人的 agent | ecc、ruflo | ECC：72 agents / 327 skills / 98 legacy shims，`ecc@ecc` 插件；ruflo：`npx ruflo init`、Claude 插件、MCP-only 三条安装路 |
| **L3 执行编排** | 有会话、权限、事务、恢复，能替人跑完整任务 | dsh-superagent、codex CLI | dsh：Engine 单写者 + Outbox + Passes；codex：`app-server` + app/IDE/cloud 多表面 |
| **L4 设备/环境网络** | 多机多端、身份、路由、断线恢复、执行环境归属 | t3code、openmausbot、openclaw | t3：认证 RPC + 路由 + scopes + 事件溯源 + 隐藏 git ref checkpoint；openmausbot：home 模型 + 引擎矩阵；openclaw：Gateway + nodes + WS 协议 |

**一句话读法**：L1 解决「agent 会不会用」，L2 解决「本机能不能被精确操作」，L3 解决「任务能不能可靠跑完」，L4 解决「换设备/换机器还成不成立」。nx 目前是 **L1.5**：action 三端同源、skill 可分发包内自带，但没有 L2 的远程身份与事件，也没有 L3 的执行层。

---

## 2. 协议层：怎么调用 Claude Code / Codex

### 2.1 五种调用形态

| 形态 | 传输 | 代表 | 适合 nx 吗 |
| --- | --- | --- | --- |
| 一次性进程 + 结构化 stdout | `spawn` → JSON lines | `claude -p --output-format stream-json`、`codex exec --output-schema` | 适合「一次性任务」，不适合长会话 |
| 常驻进程 + 双向流 | stdin/stdout 双向 JSON | Claude `--input-format stream-json`；Codex `app-server` NDJSON | 适合「一个线程一个进程」的长会话 |
| ACP | JSON-RPC 2.0 over stdio | T3 Code、OpenMausBot、`dsh --profile acp` | **最适合做统一适配层** |
| MCP | stdio / HTTP | agent-desktop、agent-browser、CRG、ruflo | 适合把 nx 的能力暴露给别的 agent |
| 控制平面 WS/RPC | WebSocket / HTTP RPC | OpenClaw Gateway、T3 RPC | 适合「客户端 ↔ 宿主」，不是模型协议 |

### 2.2 Claude Code：两种粒度，别混用

- **一次性**：`claude -p --resume --output-format stream-json`；要 typed 结果时用 `--output-format json --json-schema`，从 `structured_output` 取对象。OpenMausBot 的 `drivers/claude.ts` 就是这么做的（`server/drivers/claude.ts` 1012–1014 行是常驻形态的 flag）。
- **常驻（推荐给 nx）**：`--input-format stream-json --output-format stream-json --verbose`，prompt 走 stdin，一个线程保留一个 CLI 进程，turn 以 `result` 结束。这样才支持「中途 steer / 追问 / 取消」。
- **hooks 是加速器，不是设计基线**：`--settings` 文件里可声明 `PreToolUse`、`PostToolUse`、`PreCompact`、`SessionStart`、`Stop`；但其他引擎没有等价 hook，所以 OpenMausBot 明确规定「hooks 只做加速，基线是每个 driver 都发的 `RuntimeEvent` 流」（`docs/plans/2026-09-14-phase-0-foundation.md` 46–52 行）。
- **ACP 包装**：`claude-agent-acp` 默认走 ACP v2 preview；出问题用 `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` 退回 v1（`t3code/docs/user/providers-acp.md` 17–19 行）。

### 2.3 Codex：app-server 才是主协议

- `codex app-server` 是 **JSON-RPC over NDJSON on stdio**，completion 是 `turn/completed`；`turn/steer` 复用同一个 turn/session 折叠新输入；审批走 `execCommandApproval` / `applyPatchApproval`（OpenMausBot `server/drivers/codex.ts` 第 10、818、835 行）。
- 一次性场景用 `codex exec --output-schema`。**坑：MCP 启用时 Codex 会忽略 schema**（`docs/plans/2026-09-14-phase-0-foundation.md`）。所以「要结构化输出」和「要 MCP 工具」在 Codex 上不能同时假设成立。
- `codex` 报告的 token usage 是 **app-server 进程的 running total**（`codex.ts` 680 行注释），不是全局累计；重启/换进程要按 baseline 归零，否则成本账会越算越多。

### 2.4 ACP：目前最像「通用插座」的东西

OpenMausBot 的 ACP 驱动注释把关键语义写得很清楚（`server/drivers/acp/core.ts` 2–6 行）：

- **JSON-RPC 2.0 over stdio**；
- **没有 `turn/completed`**：`session/prompt` 的返回（`stopReason` + usage）就是完成；
- `session/load` 会把历史以普通 `session/update` 重放，所以发 prompt 之前不能发任何东西，且 `_meta.isReplay` 的更新要丢弃；
- **权限 fail closed**：只有 `allow` 类型的选项才算批准，**选项顺序永远不能当安全契约**。

T3 Code 在此之上做了工程化（`docs/user/providers-acp.md`）：

- v2 preview 为主，v1 为 Registry 里未迁移的 agent 回退；
- Registry 安装到 `tools/<agent-id>/<version>/`，有 SHA-256 校验；
- **agent 永远跑在 T3 server 所在机器**，即使你从手机经 relay 连过来；
- 登录凭据留在 agent 自己的 store，T3 不接管；
- 本地命令可以完全绕过 Registry，DeepSeek Harness 就是 `dsh --profile acp`（33–35 行）。

**AC P 的能力矩阵值得直接抄**（`server/drivers/acp/capabilities.ts`）：`sessionModelSwitch`、`agentsMcp`、`images`、`effortLevels`、`modelVariants`、`steering`、`strictResume`……并且有一条硬规则：**绝不向 bot 宣告它的 driver 挂不上的能力**（phase-0 文档 24–26 行）。nx 的 provider 表也应该长这样，而不是一个布尔 `supportsTools`。

### 2.5 MCP：工具面的通用插座，但不是 CLI 的替代

- **agent-desktop**：61 个命令 / 57 个可操作命令，`agent-desktop mcp` 全部暴露为 stdio MCP 工具（`desktop_snapshot`、`desktop_click`…）；返回统一 JSON envelope，错误带 `STALE_REF` / `AMBIGUOUS_TARGET`，只有 `error.disposition.retry === "safe"` 才允许重试（README 60–70、116–128 行）。
- **agent-browser**：Rust CLI + 后台 daemon + Chrome DevTools Protocol；`snapshot` 返回 `@e1` 引用；每个 `--session` 独立 daemon；一小时无命令自动退出；`agent-browser mcp` 起 stdio MCP；`skills get` 把与版本匹配的说明内嵌在二进制里（README 50–80 行）。
- **code-review-graph**：`install` 自动探测本机 AI 工具，写 MCP entry + hooks + skills + rules；对 Codex 还会在 `$CODEX_HOME/skills/` 放一个 Skill；**优先 MCP，MCP 不可用才退化到只读 CLI**（README 91–105 行）。
- **ruflo**：MCP-only 客户端直接 `npx -y ruflo@latest mcp start`；meta-harness 另有 9 个 MCP 工具（`docs/metaharness-user-guide.md` 3 行）。

**结论**：MCP 是「给别的 agent 用」的第二个表面，不是替代自己的 CLI。两者共享同一份 action/service 才是对的；否则就是两份清单，必然分叉。

### 2.6 不该走的路

- **OpenAI-compatible HTTP family 不能当执行引擎**：OpenMausBot 的 `drivers/openai-chat.ts` 是 chat-only，没有工具；phase-0 文档明确写「HTTP family has no tools at all」。模型端点 ≠ agent 运行时。
- **AG-UI 不是 agent 控制协议**：它是「agent ↔ 用户界面」的事件协议，1.0 已冻结 spec + JSON Schema，TS/Python/.NET SDK 由 schema 生成；它自己说与 MCP（工具）、A2A（agent 间）并列分工（`ag-ui/README.md` 23–30 行）。
- **OpenClaw 的 WS 不是模型 API**：它是会话、频道、节点的控制平面；模型是可插拔 provider。
- **不要自研第六种 agent 协议**：ACP 已经能包住 Claude/Codex/Cursor/DeepSeek Harness，MCP 已经能包住工具面。

---

## 3. 多端设计：四种拓扑

### 3.1 单 home + 瘦客户端（OpenMausBot）

- **home 拥有全部状态**：会话、记忆、skill、routine、连接器、key 都在 home 上，routine 也在 home 跑（`docs/multi-device.md` 9–18 行）。
- **三种统一方式**：My Cloud / 自己的 VPS / 同一 Tailscale 上的另一台电脑（22–28 行）。
- **配对是设备级的**：手机六位码、电脑 12 位码，一次性；host 能列出并登出每个 session；迁移 home 后原机器停止跑副本，避免 routine 跑两次；但原机器仍可**出借文件夹、屏幕、Chrome**（30–35 行；`docs/desktop-companion.md` 9–12、24–25 行）。
- **安全边界写在实现里**：从不监听所有网卡；拒绝「请求里写了另一个 host」或「从外部访问 loopback」；在 Tailscale 网内也不够，每个客户端都要配对并拿到自己的 session（`desktop-companion.md` 57–63 行）。

### 3.2 控制平面 + 执行环境（T3 Code）

- **执行归属**：`T3 Code keeps execution in the environment that owns the workspace. Web, desktop, and mobile clients control it over authenticated RPC. A remote client must never substitute its own filesystem, provider credentials, or machine state for the environment's.`（`docs/internals/overview.md` 1–6 行）。
- **一处 server，所有端同一批线程**（README 26–35 行）。
- **远程四条路**：T3 Connect 中继、LAN、Tailscale、SSH；新设备审批码形如 `K7QM-2XFD`，10 分钟过期；`t3 auth connect-device approve/revoke`；一台设备批准一次（`docs/user/remote-access.md` 41–64 行）。
- **路由是一等公民**：LAN / Tailscale / 公网 / SSH / T3 Connect 可并存；按速度排序并自动回切；经 T3 Connect 配对一次后可学习到 LAN 地址；每条路由有独立权限（134–176 行）。
- **权限按 scope 给**：`orchestration:read`、`relay:read`、`filesystem:read`、`filesystem:write`、`terminal:operate`…；配对 token 默认全给，`--scope` 可收窄（416–457 行）。
- **跨机编排**：auto balance 给新 thread 选机器；linked environments + `delegate_task` 跨机派活；已有 thread 不迁移（178–194 行）。
- **持久意图**：`EventSink` 在一个数据库事务里提交「事件 + 投影 + 命令 receipt + outbox」；`EffectWorker` 在 commit 之后才做副作用；**命令 ack 只代表 intent 已提交，不代表副作用完成**；事件日志只留约一天，游标太旧就发 snapshot；checkpoint 用**隐藏 Git ref**，不污染用户分支；agent 不能回滚对话时，revert 必须在改文件系统之前拒绝（`docs/internals/overview.md` 45–103 行）。

### 3.3 Gateway + nodes（OpenClaw）

- **一个 host 一个 Gateway**，拥有所有消息面（WhatsApp/Telegram/Slack/Discord/Signal/iMessage/WebChat…20+）；**唯一**开 WhatsApp session 的地方（`docs/concepts/architecture.md` 5–20 行）。
- **客户端与 node 走同一个 WS**：node 声明 `role: node` + caps/commands，提供 `camera.*`、`screen.record`、`location.get`、`canvas.*`（36–45 行）。
- **线协议**：首帧必须 `connect`；之后 `{type:"req",id,method,params}` → `{type:"res",id,ok,payload|error}`、`{type:"event",event,payload,seq?,stateVersion?}`；入站帧按 JSON Schema 校验；`hello-ok.features.methods/events` 是发现元数据（`docs/gateway/protocol/handshake.md` 15–70 行）。
- **握手细节**：`minProtocol`/`maxProtocol` 版本协商、`role` + `scopes`、设备公钥/签名/nonce、`connect.challenge` 防重放。
- **安全默认**：DM 频道对未知发送者配对，`openclaw pairing approve <channel> <code>`；工具默认跑宿主，可配 sandbox。

### 3.4 设备桥（agent-desktop / agent-browser）

- **同一套命令面覆盖三平台**：macOS AX API / Windows UI Automation / Linux AT-SPI（`agent-desktop/README.md` 143–149 行）；`snapshot` 给每个可操作元素分配 `@<snapshot_id>:<e8>` ref，ref 过期 `STALE_REF`，多窗口 `AMBIGUOUS_TARGET`（`details` 给候选 window id）；默认 headless，不动指针不抢焦点，`--headed` 才物理输入（60–70 行）。
- **浏览器侧**：CLI → 后台 daemon → CDP；`snapshot` 紧凑文本 + `@e1`；每 session 独立 daemon；可 attach 已有 Chrome；可换 Lightpanda/Obscura 引擎；MCP + 内嵌 skills（`agent-browser/README.md` 50–80 行）。

### 3.5 四种拓扑对比（以及 nx 的落点）

| 维度 | OpenMausBot | T3 Code | OpenClaw | agent-desktop/browser | nx 今天 |
| --- | --- | --- | --- | --- | --- |
| 状态归属 | home | workspace 所在 environment | Gateway | 本机 daemon | 本机 SQLite |
| 执行归属 | home（可出借能力） | 拥有 workspace 的机器 | Gateway / node | 本机 | 本机进程 |
| 认证单位 | 设备配对 | 设备 + 路由 + scope | 设备（role node）+ token | 无（本机） | 无 |
| 断线恢复 | 重连 + 会话归属 | seq + 事件回放 + snapshot | seq + stateVersion | 快照重取 | 无 |
| 能力扩展 | 连接器 + 出借 | ACP provider + 插件 | channel + node caps | 平台适配器 | action 模块 |
| 客户端形态 | Electron / 手机 | 桌面 / Web / iOS / Android | 桌面 / CLI / Web / TUI / node | CLI / MCP | Web / CLI |
| nx 迁移成本 | 中（home 概念可借） | 中高（事件/路由复杂） | 中（WS 协议可裁剪） | 低（当 sidecar） | — |

### 3.6 三条法则

1. **执行跟着数据走**：workspace / DB / 仓库在哪，agent 就在哪跑；客户端只发意图。
2. **客户端永不替代宿主的文件系统、凭据、机器状态**（T3 的原话，值得刻在 nx 的架构文档里）。
3. **配对是设备级，授权是路由/scope 级；断线恢复靠 seq + snapshot，不靠客户端本地推导。**

---

## 4. 特殊技术栈实战

按「对 nx 的可迁移度」排序，不按仓库名气。

### 4.1 Rust + 平台无障碍：agent-desktop

- 61 个命令 / 57 个可操作，四类命令（`key-down`/`key-up`/`mouse-down`/`mouse-up`）在 daemon 不能释放按键时拒绝执行（README 128 行）。
- 同一套命令面覆盖 macOS AX、Windows UIA、Linux AT-SPI（143–149 行）。
- **可迁移的不是 Rust，而是「引用 + 快照 + 错误处置」三件套**：ref 属于某次 snapshot；过期/歧义是显式错误码；重试只允许 `safe`。nx 的 action 结果也应该有 `error.code` 与 `error.disposition`，而不是一句 `Error: failed`。

### 4.2 Rust + CDP daemon：agent-browser

- daemon 首命令启动，`--session` 隔离；一小时空闲自动退出并保存状态；可 attach 正在运行的 Chrome；可换引擎；MCP + 版本化内嵌 skill（README 50–80 行）。
- **可迁移的**：把「重资源」放 daemon，CLI 只做短命令；每个 session 独立状态；**skill 文本随二进制版本走**（`skills get`），安装的 skill 只是薄 stub。nx 的 `skill get` 已经是对的方向，但还应加「版本一致性检查」。

### 4.3 Tree-sitter + 增量代码图：code-review-graph

- AST → 图（函数/类/import/call/test），hooks + watch 只重解析改动文件；一个 SQLite 文件，无云；MCP 提供紧凑上下文（README 52–64、170–172 行）。
- 冷构建 ~3,000 文件约 40 秒；解析失败进入 `partial` 并列文件名；安装覆盖 18 个平台，配置原子写、`uninstall --dry-run`（README 117、149、132 行）。
- 宣称 flask 全库 143,594 tokens → 图回答 2,196 tokens（65x）（README 55 行）。
- **可迁移的**：nx 的 `repos`/`docs` 现在靠全文与人工 desc；如果要做「仓库理解」，图比全文检索更省 token。但这是独立产品，不要塞进任务队列。

### 4.4 事件溯源 + Outbox：T3 Code

- 事件是决策，投影是应用事件后的真相；`Orchestrator` 只决定事件、不做 I/O；`EventSink` 同事务写事件/投影/receipt/outbox；`EffectWorker` 在 commit 后做副作用；事件日志约一天，游标落后就 snapshot（`docs/internals/overview.md` 45–73 行）。
- checkpoint 用隐藏 Git ref；provider 不能回滚对话时，revert 必须在改文件系统之前拒绝（88–91 行）。
- **可迁移的**：nx 现在「写库 + 发通知」是两步，断电会丢通知；至少要做「命令 receipt + 事件同事务」。但不建议一上来就全量事件溯源，见 §6.6。

### 4.5 领域引擎单写者 + Passes：dsh-superagent

- `Runtime` 是组合根；`Engine` 是 Triggers/Threads/Decisions/Tickets/Assignments 的**唯一写者**；所有方法同步，每个命令一个事务；端口在事务内入队外部工作，适配器在 commit 后执行（`docs/007-architecture.md` 27–50 行）。
- 五个部件各有单向依赖：`Intake` / `Evals` 写 `Tickets`，`Tickets` / `Assignments` 写 `Replies`（`Assignments` 还会回报到 `Tickets`），`Evals` 只读 `Tickets`；调用方只拿到自己角色的 `Pick`（`EngineForSources` / `EngineForMainSession` / `EngineForPeople` / `EngineForSettings` / `EngineForExecutor`）（52–64 行）。
- `Passes` 每 2 秒跑一次 due effects + `evaluateDue`；`Outbox` 是 receipt 的唯一写者，消息与 reply effect 同事务；Eval 有 deadline，连续第三次过期记 `unavailable`（40–41、93 行）。
- **可迁移的**：nx 的 `service` 层也应该有「唯一写者 + 每命令一个事务」的纪律；`Passes` 可以对应 nx 的 `localtask wait`/事件轮询，但 nx 目前是请求驱动，暂时不需要后台 tick。

### 4.6 home + Runtime Contract：OpenMausBot

- 统一 job runtime：`Assignment` 树（rootId/parentId/depth）、origin（person/routine/outside）、mode（work/consult/notify）、reply（resume/poll/none）、level（ask < edits < auto < full，`max(own, inherited)`）；SQLite `runtime.db` 存 assignments / assignment_events（追加审计）/ inbox 唤醒队列（`docs/runtime-contract.md`）。
- 生命周期 `queued→running→completed/failed/cancelled` + `waiting`/`resume`/`needs_input`；同一请求去重（同 mode/level/doneWhen 且 40 字符以上规范化后相同则共享答案）；envelope 语法 `[From <who> · <what> · <authority>]`：assignment 且有 person/routine 血统时 authority 是「on their behalf at your level」，其余（外部血统、咨询、报告、问题）是「information only」；`escapeNotes` 防模型伪造 envelope。
- 决策模型层只做选择不做活（`POST /systemone` 或 `POST /decisions`），失败 open（`docs/decision-model.md`）。
- **可迁移的**：nx 的任务也有「谁请求、替谁做、做到什么权限」的问题。`level = max(own, inherited)` 这个规则非常适合「组内任务继承仓库权限」；`escapeNotes` 则适合 nx 的 prompt 模板防注入。

### 4.7 分发与学习：ECC / ruflo / Agent Skills

- **ECC**：`ecc@ecc` 插件 + npm 双通道；72 agents、327 skills、98 legacy command shims；核心是 `continuous-learning-v2`：hooks（PreToolUse/PostToolUse）观察会话 → 原子 instinct（trigger/action/confidence 0.3–0.9/domain/evidence）→ cluster → 演化成 skill/command/agent；v2.1 按项目隔离（`${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects/<hash>/`），同一模式在 2+ 项目出现才 promote 到 global（`skills/continuous-learning-v2/SKILL.md`）。
- **ruflo**：`npx ruflo init` / Claude 插件 / MCP-only 三条安装路；meta-harness 有 10 个 CLI 子命令、9 个 MCP 工具、3 条 CI workflow；可选依赖缺失时**优雅降级**返回 `degraded: true`，绝不崩（`docs/metaharness-user-guide.md` 3–15 行）。
- **anthropics/skills**：Agent Skills 规范 + `spec/` + `template/`；插件市场 `/plugin marketplace add anthropics/skills` 可整包装（README 26–45 行）。
- **可迁移的**：nx 的 `skill install` 已经是分发层；缺的是「版本/作用域/降级」三件事。把 `skill get` 做成「从二进制取当前版本」，再加 `skill doctor` 检查安装版本，是最低成本的对齐。

### 4.8 设计系统 for humans + agents：astryx

- Meta 内部八年、13,000+ apps；150+ 组件、React 19 + StyleX；主题 = CSS 自定义属性覆盖；`swizzle` 可把组件源码 eject 到项目里；CLI 支持全局装 + 项目装（推荐 both），项目内仍跑项目自己的版本（README 27–36、58–64 行）。
- 核心原则之一是 **「One system for humans and AI」**：API、文档、CLI 一起设计，「每一个让 AI 更好用的改动，也让人更好用」（95 行）。
- **可迁移的**：nx 的 Web 面板与 `A02` 视觉规范可以借用「同一套 token + 同一套文档 + 同一套 CLI」的思路；但 nx 不需要 StyleX，保持现有 CSS 即可。

### 4.9 质量门禁：SkillEvaluator

- Tier 1：11 项 CI 检查，背后 **500+ 静态规则**；含 Harness Check（agent 会不会加载这个 skill）、SkillSpector/Gitleaks/Bandit/Semgrep 扫描；Tier 2 去重/嵌入；Tier 3 真 agent A/B（有 skill vs 无 skill）。
- `quality-check` 不需要 key，输出 100 分制；但只是静态质量，发布证据仍是 `INCOMPLETE`（README 59–65、144–156 行）。
- **可迁移的**：nx-kv 的 `assets/nx-kv` 应该进 CI：`skillevaluator validate assets/nx-kv --tiers 1`；尤其 Harness Check 能提前发现「description 写得像文档、agent 不加载」这类问题。

### 4.10 协议 spec + 代码生成：AG-UI

- 1.0 已冻结 spec + JSON Schema；TS/Python/.NET SDK **由 schema 生成**；0.x 与 1.0 双向兼容；同一 agent 可驱动 web/mobile/terminal/Slack（README 23–30 行）。
- **可迁移的**：nx 已经有 `contract/contract.json` + `gen:dart`，这是同一思路的雏形。下一步不是再写客户端，而是**让契约覆盖率成为 CI 门禁**。

### 4.11 记忆：mem0

- 2026-04 新算法：**单次 ADD-only 抽取**（一次 LLM call，无 UPDATE/DELETE，记忆只累积）、agent 生成的事实一等公民、实体链接；LoCoMo 92.5 / LongMemEval 94.4 / BEAM(1M) 64.1，token 约 6.7–7.0K，p50 0.88–1.09s；开源 SDK 与托管平台有差距（README 56–70 行）。
- **可迁移的**：nx 的「操作教训」现在是覆盖式文档；如果要长期积累，ADD-only + 证据链比「改写总结」更抗漂移。但 nx 不是记忆产品，先做「教训追加 + 日期 + 复核期」就够了。

### 4.12 软件 → CLI harness：cli-anything

- 每个软件一个 Python CLI（Click），**JSON + Human 双输出**，配套 SKILL.md 统一放 `skills/`；`cli-hub` 公共 registry 支持 pip/npm/brew/bundled；preview / live-preview / trajectory 三种循环；2,461 个测试通过（README 22、37、63 行）。
- **可迁移的**：nx 的 `action` 已经是「CLI + JSON + 面板」同源；缺的是「给每个外部软件生成一个薄 CLI」的通用模板。这个可以做成 nx 的 `tasktool` 扩展，而不是新项目。

---

## 5. nx 现状盘点（全部来自本机实测）

### 5.1 结构

```
src/core      零业务基础设施（atomic-file / config / errors / paths / serve-port…）
src/modules   功能域（bundled / db / docs / file / localtask / promptplug / repos / setting / system / tasktool / templates）
src/runtime   action 机制（action-base / action-decorator / api / cli / contract / registry / server / zod-bridge…）
src/web       React 面板（React 19 + flexlayout）
contract/     contract.json + 生成的 Dart client
```

### 5.2 关键数字

| 项 | 实测值 | 出处 |
| --- | --- | --- |
| action 文件 | **135** 个（每个文件一条 action） | `src/modules/*/actions/*.ts`（排除 `_manifest.generated.ts`） |
| 进入契约的 action | **11** 条 | `contract/contract.json` 的 `actions.length` |
| 直接声明 `output:` 的文件 | **7** 个 | `localtask-add/claim/done/get/reopen/update` + `contract.ts` |
| HTTP 监听 | `http.createServer`，`start({host='127.0.0.1'})` | `src/runtime/server.ts` 82 行 |
| `serve` 的 host flag | **没有**（只有 `--port` / `--no-open` / `--allow-origin`） | `src/runtime/cli.ts` 44–60 行 |
| 鉴权 | **无** token / session | `server.ts` 无 auth 分支 |
| 事件流 | **无** SSE / WebSocket | `runtime` 无相关文件 |
| 存储 | 本机 SQLite `~/.nx-kv/nxkv.db`，schema v8 | `README.md` 6 行 |
| 测试 | 98 项冒烟 + 934 项单元/一致性 | `README.md` 44 行 |
| 依赖 | react / react-dom / flexlayout-react / zod / handlebars | `package.json` |
| 已有分发 | `skill get` / `skill install` / `skill list` / `skill groups` | `src/modules/bundled/actions/*` |
| 已有生成 | `gen:actions` / `gen:api` / `gen:dart` | `package.json` scripts |

### 5.3 结论

nx 是 **L1.5**：结构上已经满足「一条 action 三端同源」，但**只有 localtask 这一小簇有机器可读的输出契约**（11/135 ≈ 8%），所以 Dart 客户端与任何远程调用都只能覆盖任务队列，覆盖不了 docs / repos / board —— 而这三块恰恰是「仓库上下文」的核心。

另外，nx 的远程边界现在是**隧道**而不是应用：README 自己写了「面板只绑 127.0.0.1……经内网穿透暴露到公网后，真正的边界是隧道自身的访问控制」。这对个人短期可用，但对「多设备 + 多用户 + 可撤销」不够：隧道挂了就全挂，也没有设备级撤销与审计。

---

## 6. 迁移融合方案

### 6.1 五条设计原则

1. **不新增第二真相源**：action 仍是唯一声明；远程、MCP、Web 都只是 transport。禁止再写一份「远程命令表」。
2. **状态单写者**：写操作进 service/DB 事务；事件在事务提交后发出；不接受「先发通知再写库」。
3. **客户端可丢弃**：任何客户端都能从 snapshot + seq 重建；不在客户端做业务推导。
4. **执行跟数据走**：agent 在 home（有 DB/仓库的机器）上跑；客户端只发意图、看事件。
5. **默认关闭**：LAN、远程、写工具、agent 执行，全部要显式开启；默认回环、默认只读。

### 6.2 Phase 0：契约与 MCP（1–2 天，收益最高）

**目标**：让 nx 的能力第一次能被别的 agent 稳定调用，而不是靠 shell 猜。

1. **补 output 契约**（先补「远程面」20 条左右）：
   - `localtask`：`get/claim/add/done/list/show`（已有部分）
   - `docs`：`list/get/bindings/ref add`（读为主）
   - `repos`：`list/get/ref list`
   - `board`：`list/get`
   - `system`：`health/status`
   目标：契约覆盖 ≥ 60%，并加 CI 门禁：`pnpm gen:dart --check` + 覆盖率阈值。
2. **`nx-kv mcp`（stdio）**：
   - 复用 `registry` + `zod-bridge`，把 action 的 input 转成 JSON Schema；
   - 工具名用 `nx_<域>_<动作>`（如 `nx_localtask_claim`）；
   - 返回统一 envelope：`{ ok, data, error?: { code, message, retryable } }`；
   - **默认只读**：只暴露 `list/get/status`；`--allow-write` 才暴露写工具；
   - `--list` 输出工具清单 JSON，便于测试与文档生成。
3. **验收**：
   - Claude Code / Codex 的 MCP 配置里写 `command: "nx-kv", args: ["mcp"]` 能列出工具；
   - `nx-kv mcp --list --json` 与 `contract.json` 的 action 集合一致；
   - 写工具默认不可见（负向测试）。

### 6.3 Phase 1：远程会话（3–5 天）

**目标**：手机/笔记本能安全地看和操作同一份 nx 数据，且不复制状态。

1. **监听**：`serve --host <ip>` / `--lan`；默认仍 `127.0.0.1`；非回环启动时强制要求 token，未配置就生成一个并打印。
2. **设备表**（schema v9）：
   ```sql
   CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     platform TEXT NOT NULL,
     token_hash TEXT NOT NULL,      -- sha256(token)，不存明文
     scopes TEXT NOT NULL,          -- JSON: ["read","write","exec"]
     approved_at TEXT,
     last_seen_at TEXT,
     revoked_at TEXT
   );
   CREATE TABLE pair_requests (
     code TEXT PRIMARY KEY,         -- 8 位 Crockford base32，10 分钟过期
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     used_at TEXT
   );
   ```
3. **action**（全部走现有 action 机制，不写第二套路由）：
   - `remote.status` → `GET /api/remote/status`
   - `remote.pair.create` → `POST /api/remote/pair`（回 code + URL + 过期时间）
   - `remote.pair.approve` → `POST /api/remote/pair/:code/approve`（已连接设备或 loopback 才能调）
   - `remote.device.list` / `remote.device.revoke`
4. **SSE 事件流**：`GET /api/events`（`text/event-stream`）
   ```
   id: 1024
   event: change
   data: {"seq":1024,"type":"task.updated","entity":{"kind":"task","id":12},"stateVersion":8,"at":"2026-11-18T..."}
   ```
   - 心跳 15s；支持 `Last-Event-ID`；
   - 服务端只保留最近 N 条（内存 ring buffer，先 1000 条）；seq 断层就发 `resync`，客户端重新拉 snapshot；
   - 事件只做「失效通知」，不承载完整业务数据；客户端收到后重新 `get`。
5. **CLI 远程模式**：全局 `--remote <name>`；因为每条 action 都有 `http`，远程 CLI 只需把 ctx 编译成 HTTP 请求，**不复制 service 逻辑**。`nx-kv connect <url> <code>` 把 profile 存到 `~/.nx-kv/remotes.json`。
6. **验收**：
   - 手机配对后可只读浏览；撤销后 1 秒内 401；
   - 断网 30 秒重连，SSE 自动续传；
   - 人为制造 seq 断层，客户端触发 `resync`；
   - `--lan` 启动但未配对的设备一律 401；
   - `serve` 未显式 `--host` 时仍只监听回环。

### 6.4 Phase 2：agent 执行层（1–2 周）

**目标**：nx 不只是「任务队列 + 文档库」，而是能真正驱动 Claude Code / Codex / DeepSeek Harness 干活的宿主。

1. **模块**：`modules/agent` + `runtime/agent/`（provider 接口 + 事件归一化）。
2. **provider**：
   - `acp`：spawn 本地命令（默认 `dsh --profile acp`，也可配 `claude-agent-acp`）；JSON-RPC 2.0 over stdio；`session/prompt` 返回即完成；`session/update` 归一化为 `agent.output.delta` / `agent.tool` / `agent.plan`。
   - `claude`：常驻 `--input-format stream-json --output-format stream-json --verbose`，一个 thread 一个进程；`result` 结束 turn。
   - `codex`：`codex app-server` NDJSON JSON-RPC；`turn/steer` 折叠输入；`execCommandApproval` / `applyPatchApproval` 转成 nx 的审批事件（先只读展示，不做自动批准）。
3. **action**：
   - `agent.list`（provider + capability）
   - `agent.start`（`--provider acp --task 12 --prompt-file ...`）→ 返回 `runId`
   - `agent.cancel`、`agent.get`、`agent.events`（SSE channel `agent:<runId>`）
4. **事件**：`agent.run.started|output|tool|completed|failed|cancelled`；失败带 `retryable`；进程树必须整棵清理（Windows 用 job object / `taskkill /T`，别只 kill 父进程）。
5. **能力矩阵**：`streaming`、`tools`、`steer`、`resume`、`mcp`、`images`、`modelSwitch`；**绝不宣告挂不上的能力**（OpenMausBot 的硬规则）。
6. **凭据**：留在 agent 自己的 store（Claude/Codex 的登录态）；nx 只存「用哪个 provider、哪个 task、哪个 run」，不存 API key。
7. **验收**：
   - `dsh --profile acp` 能起一个 run 并回事件；
   - `claude` 能起一个 run，`--resume` 能续；
   - 取消后子进程树 0 残留；
   - provider 不支持 steer 时，API 明确返回 `unsupported`，不静默排队。

### 6.5 Phase 3：设备节点与能力出借（可选）

- `nx-kv node` 向 home 注册，声明 caps：`files` / `browser` / `desktop`；home 可以派 `node.exec`。
- 执行不要自己实现：`browser` 调 `agent-browser`，`desktop` 调 `agent-desktop`，`files` 用受限目录白名单。
- 这对应 OpenMausBot 的「出借文件夹、屏幕、Chrome」与 OpenClaw 的 `role: node`。
- 先做 `files`（只读目录）与 `browser`，`desktop` 最后；每类都要有「租约 + 超时 + 撤销」。

### 6.6 Phase 4：事件溯源升级（按需，不要提前做）

- 现在 SSE 只需要 ring buffer + resync，不需要 events 表。
- 只有出现「离线多天、要回放」「多副本投影」「审计合规」时，才升级为：
  - `events(seq, ts, type, entity, payload, state_version)`；
  - 投影表（tasks/docs/repos）；
  - 命令 receipt + outbox；
  - 同事务提交，副作用在 commit 后（照 T3 `EventSink` / `EffectWorker`）。
- 提前上事件溯源只会增加复杂度，不会让当前的三端更稳。

### 6.7 不做清单

- ❌ 不自研 agent 协议；ACP 足够，Claude/Codex 各做一个 adapter。
- ❌ 不做状态同步 / CRDT；home 单点，客户端可丢弃。
- ❌ 不做 Electron 桌面端；PWA + `npx` 优先，Dart 客户端按需生成。
- ❌ 不把 provider API key 放客户端；凭据留在 agent store。
- ❌ 不重写 action 机制；只扩展 transport（MCP / remote / SSE）。
- ❌ 不把 MCP 当 CLI 的替代；两者共存，共享同一 action。

---

## 7. 「设备快速分发」的落地路径

用户要的是「我自己的设备快速分发」，不是「做一个多租户 SaaS」。所以路径应该是：

```
包分发（npm / npx）
   ↓
入口（nx-kv up：起 serve + 打印配对二维码）
   ↓
配对（8 位一次性码 / 10 分钟）
   ↓
瘦客户端（手机 PWA、笔记本 CLI --remote、另一台 PC 的浏览器）
```

### 7.1 一台 home，其他都是客户端

- **home**：常开的机器或 VPS，跑 `nx-kv serve --lan`，持有 SQLite、任务、文档、仓库、agent 会话。
- **手机**：浏览器打开 `http://<home>:7877`，配对后拿到 HttpOnly cookie；只读默认，需要写再提权。
- **笔记本**：`npx nx-kv@latest connect <url> <code>`，之后 `nx-kv localtask get --remote home` 走 HTTP，不在本地建库。
- **另一台 PC**：同上；如果它有本地仓库要纳入，可以作为 `node` 出借 `files`，而不是复制一份 DB。

### 7.2 新设备三步

```bash
# 1. 安装/运行（无需 clone 仓库）
npx nx-kv@latest up

# 2. 扫码或输入 8 位码
# 3. 在已连接设备上批准（10 分钟内有效）
nx-kv remote approve K7QM-2XFD
```

### 7.3 Agent 侧

```bash
nx-kv skill install nx-kv          # 让本机 agent 学会 nx 的用法
nx-kv mcp                          # 让 Claude Code / Codex 直接调 nx 工具
```

MCP 配置示例（Claude Code / Codex 通用）：

```json
{
  "mcpServers": {
    "nx-kv": { "command": "nx-kv", "args": ["mcp", "--read-only"] }
  }
}
```

### 7.4 路由与断线

- 路由列表：LAN → Tailscale → 隧道 → 公网；按速度排序，失败自动回切。
- `nx-kv status --json` 输出当前路由、延迟、设备数、seq 水位。
- 断线恢复：`Last-Event-ID` → 若 seq 落后超过 ring buffer，返回 `resync`，客户端重新拉 snapshot。
- 不在客户端用本地时钟推导「任务是否过期」；一切以服务端 `stateVersion` 为准。

### 7.5 验收清单（上线前逐条过）

- [ ] 默认 `serve` 仍只绑 `127.0.0.1`；`--lan` 必须显式。
- [ ] 非回环启动时没有 token 就拒绝启动，并打印生成方式。
- [ ] 配对码一次性、10 分钟过期、错误码不泄露「是否存在」。
- [ ] 新设备默认只读；写权限要单独授予。
- [ ] 撤销设备后，现有 SSE 连接在下一次心跳被断开。
- [ ] `--remote` 与本地 CLI 的输出格式一致（同一 `render`）。
- [ ] 端口被占时仍走 reuse/shift 两分支（不要因为远程而破坏本机体验）。

---

## 8. 风险与边界

1. **远程执行 = RCE**。默认回环、显式 `--lan`、token、scope、审计五件套缺一不可；不要用 `--allow-origin` 当安全边界（非浏览器客户端根本不发 `Origin`）。
2. **事件日志会膨胀**。先 ring buffer + resync；要持久化就设保留期与清理任务，别让 `events` 表无限增长。
3. **版本偏差**。contract 有版本号；`gen --check` 进 CI；skill 文本随二进制版本走（agent-browser 的 `skills get` 就是范例）；再加 `nx-kv doctor` 检查「安装的 skill 版本 vs 二进制版本」。
4. **引擎差异**。用 capability flags + fake engine 测试（OpenMausBot 的 `fake-claude-cli` / `fake-codex-app-server` / `fake-acp-cli` 是现成范式），不要用「假装都支持」来省事。
5. **凭据**。nx 不存 provider key；设备 token 只存 hash；日志里不打 token 与配对码。
6. **跨平台**。Windows 的进程树、路径分隔符、端口占用与 Linux 不同；Phase 2 先在 Windows + Linux 各跑一遍，再谈 macOS。
7. **不要过度设计**。T3 的事件溯源 + 投影 + outbox 是「多客户端、多环境」逼出来的；nx 现在只有单 home，先 SSE 失效通知就够。

---

## 9. 三个可以立刻开的 PR

1. **`feat(contract): 补齐远程面 output schema`**
   目标 20 条 action；加 `gen:dart --check` 与覆盖率门禁；先把 `docs/repos/board` 的读接口补齐。
2. **`feat(mcp): nx-kv mcp --read-only`**
   复用 registry + zod-bridge；工具名 `nx_*`；统一 envelope；写工具默认关闭；`--list --json` 可测。
3. **`feat(remote): token + pair + SSE 最小闭环`**
   `serve --lan`、`devices`/`pair_requests` 表、5 条 remote action、`GET /api/events`、`nx-kv pair` 打印二维码；先不做移动端 UI，用现有 Web 面板验证。

---

## 附录 A：证据索引（仓库 → 关键文件）

| 仓库 | 关键文件 | 用来支撑 |
| --- | --- | --- |
| t3code | `README.md`、`docs/internals/overview.md`、`docs/user/remote-access.md`、`docs/user/providers-acp.md` | 控制平面、ACP、路由、scope、事件溯源、checkpoint |
| openmausbot | `README.md`、`docs/multi-device.md`、`docs/desktop-companion.md`、`docs/plans/2026-09-14-phase-0-foundation.md`、`server/drivers/{claude,codex,acp/core,acp/capabilities}.ts` | home 模型、引擎矩阵、Claude/Codex/ACP 协议、能力标记 |
| openclaw | `README.md`、`docs/concepts/architecture.md`、`docs/gateway/protocol/handshake.md` | Gateway + nodes、WS 帧、角色/scope、配对 |
| dsh-superagent | `README.md`、`docs/007-architecture.md` | Engine 单写者、事务、Outbox、Passes |
| agent-desktop | `README.md` | 61/57 命令、refs、错误码、三平台无障碍、MCP |
| agent-browser | `README.md` | daemon + CDP、session、MCP、内嵌 skills |
| code-review-graph | `README.md` | Tree-sitter 图、SQLite、增量、18 平台安装、65x |
| ecc | `README.md`、`skills/continuous-learning-v2/SKILL.md` | 插件分发、hooks、instinct、项目作用域 |
| ruflo | `README.md`、`docs/metaharness-user-guide.md` | 三条安装路、meta-harness、优雅降级 |
| astryx | `README.md` | 设计系统、StyleX、swizzle、CLI 文档 |
| ag-ui | `README.md` | 事件协议、1.0 冻结、SDK 生成 |
| mem0 | `README.md` | ADD-only、实体链接、benchmark |
| cli-anything | `README.md` | 每软件 CLI + SKILL、registry、双输出 |
| skillevaluator | `README.md` | 500+ 规则、11 检查、Tier 3 A/B |
| codex | `README.md` | Codex CLI 安装面、app/IDE/cloud |
| anthropics/skills | `README.md` | Agent Skills 规范、插件市场 |
| firecrawl | `README.md` | 知识基础设施（scrape/crawl/search） |

## 附录 B：nx action 分布（实测）

| 模块 | action 文件数 | 备注 |
| --- | --- | --- |
| bundled | 4 | `skill get/install/list/groups` |
| db | 4 | 备份/维护 |
| docs | 21 | ref、绑定、附件 |
| file | 5 | 上传/读取/清理 |
| localtask | 34 | 任务队列主体（已有 output 契约） |
| promptplug | 4 | 提示词插件 |
| repos | 43 | 仓库/参考仓库/绑定（最大的未契约区） |
| setting | 2 | 本机设置 |
| system | 4 | 健康检查等 |
| tasktool | 8 | 任务工具 |
| templates | 6 | 模板 |
| **合计** | **135** | 进入契约 11 条 |

**读法**：`repos`（43）与 `docs`（21）是「仓库上下文」的主战场，也是远程/MCP 最需要先补契约的地方；`localtask`（34）已经有 5 条 output，先把剩余读写补齐，就能让「手机领活/交活」跑通。
