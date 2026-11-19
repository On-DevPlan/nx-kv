# ACP 协议设计细节、跨协议兼容与开源生态（2026-11-19）

> 版本快照：2026-11-19。ACP 官方**稳定协议版本是 v1**；v2 仍是 draft/preview。本文把「官方规范」与「具体实现扩展」分开标注，避免把某一家客户端的预览行为当成协议标准。

## 0. 先给结论

1. **ACP 是「编辑器/宿主 ↔ 编码 Agent」的会话协议**，不是 Agent 与 Agent 之间的协议，也不是 Agent 调工具的协议。
2. 它的骨架非常窄：`initialize → session/new → session/prompt → session/update → session/request_permission → stopReason`，底层是 **JSON-RPC 2.0 over stdio**。窄骨架 + 能力协商 + `_meta` 扩展，是它能快速统一 Claude Code、Codex、Gemini CLI 等不同引擎的根本原因。
3. **兼容不同协议的正确姿势不是「写一个万能协议」**，而是「边界分层 + 适配器 + 能力矩阵 + 未知字段保留 + 代理链」。ACP、MCP、A2A、AG-UI 各自负责一条边界，宿主在中间做归一化。
4. 开源生态已经形成完整链条：**规范 + 多语言 SDK + Registry + TCK + 参考 Agent 包装器 + 生产客户端**。Claude Code 与 Codex 都已经有官方 ACP 包装器，Registry 里已有几十个可直接安装的 Agent。
5. 对 nx-kv 的迁移顺序应当是：**先做 ACP 客户端（宿主侧），把 `session/update` 投影成统一 RuntimeEvent；不要先做 Agent 侧，也不要用 ACP 去替代 MCP。**

---

## 1. 三个「ACP」必须先分清

搜「ACP」会同时命中三个完全不同的东西。名字混淆是这一轮调研里最高频的假信号。

| 名称 | 谁和谁通信 | 传输 | 现状 | 是否本文对象 |
| --- | --- | --- | --- | --- |
| **Agent Client Protocol（ACP）** | 编辑器/CLI 宿主 ↔ 编码 Agent | JSON-RPC 2.0 over stdio；Rust SDK 另提供 HTTP/SSE、WebSocket | 官方稳定 v1；v2 draft | **是** |
| **Agent Communication Protocol（IBM ACP）** | Agent ↔ Agent | REST/HTTP | 2025-08 并入 A2A，原仓库归档（2025-08-27） | 否 |
| **Agentic Commerce Protocol（ACP）** | 商家/支付 ↔ AI 前端 | HTTP | OpenAI 与 Stripe 推动的电商结账协议 | 否 |

所以看到「ACP 用 REST」「ACP 是 Agent 之间互相发现」这类描述时，先确认它说的是 IBM 那个已被 A2A 吸收的协议，而不是 Zed 发起的 Agent Client Protocol。

**Agent Client Protocol 的定位可以类比 LSP**：LSP 把「编辑器」和「语言服务」解耦，ACP 把「宿主」和「编码 Agent」解耦。宿主负责工作区、文件系统、终端、权限 UI、会话列表；Agent 负责模型循环、工具调用、上下文管理、自己的登录与会话持久化。协议只交换**会话状态与事件**，不规定 Agent 内部怎么实现。

由此产生几个重要边界，很多文章会忽略：

- ACP **不标准化子 Agent 的血缘关系**。T3 Code 的文档明确写：ACP 没有可移植的原生子 Agent lineage 契约， richer delegation views 仍是 Agent 特定的。
- ACP **不标准化账号隔离**。T3 Code 文档明确写：ACP 不描述 account isolation，增加一个实例并不保证独立账号，需要靠 Agent 自己的配置或 `HOME` 隔离。
- ACP **不标准化 checkpoint / 对话回滚**。T3 Code 的做法是：文件可以回滚，但 ACP Agent 不能回滚自己的对话；回滚后的下一轮要开新 Agent session，再把保留的对话重放进去。
- ACP **不负责工具发现**。工具发现与调用是 MCP 的边界；ACP 只负责把 MCP server 配置传给 Agent，并在需要时把 MCP 消息桥接过去。

---

## 2. 线格式：JSON-RPC 2.0 的 ACP profile

### 2.1 基本约束

- UTF-8，**一行一个 JSON 对象**，换行分隔；stdout 只跑协议，日志一律走 stderr。
- **不使用 JSON-RPC batch**。请求 ID 必须是 string 或 integer，**不能是 null**。
- 双向请求：Client 可以调 Agent，Agent 也可以调 Client。两个方向各自独立分配 ID；同一 ID 可以同时在两个方向使用，但**同一发送方在等待回复期间不得复用该 ID**。
- 通知（notification）永远不回复。ACP v2 用 `$/cancel_request` 取消一条尚未完成的请求。
- 路径必须是**绝对路径**，用宿主操作系统的原生写法；v2 draft 的文件位置行号是 **1-based**。
- 错误走 JSON-RPC 标准 `error { code, message, data? }`。常见语义：`-32601` method not found、`-32602` invalid params、`-32000` authentication required、`-32002` unknown session（会话不在 active 状态）、`-32800` request cancelled（v2）。

### 2.2 一次最小握手

```json
--> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{
      "protocolVersion":1,
      "clientCapabilities":{
        "fs":{"readTextFile":true,"writeTextFile":true},
        "terminal":true
      },
      "clientInfo":{"name":"nx-kv","title":"nx-kv","version":"0.64.0"}
    }}

<-- {"jsonrpc":"2.0","id":1,"result":{
      "protocolVersion":1,
      "agentCapabilities":{
        "loadSession":true,
        "promptCapabilities":{"image":true,"embeddedContext":true},
        "mcpCapabilities":{"stdio":true,"http":true},
        "sessionCapabilities":{"list":true,"resume":true,"close":true}
      },
      "authMethods":[
        {"type":"agent","id":"login","name":"Login","description":"浏览器或设备码登录"}
      ],
      "agentInfo":{"name":"claude-agent-acp","title":"Claude Agent","version":"..."}
    }}
```

`authMethods` 的 `type` 只有三类：`agent`（Agent 自己跑登录流程）、`terminal`（宿主开终端让用户输入）、`env_var`（宿主设置环境变量，`vars` 列出变量名）。

### 2.3 会话与一轮 prompt

```json
--> {"jsonrpc":"2.0","id":2,"method":"session/new","params":{
      "cwd":"/absolute/workspace",
      "mcpServers":[
        {"type":"stdio","name":"fs","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/absolute/workspace"],"env":[]}
      ]
    }}

<-- {"jsonrpc":"2.0","id":2,"result":{
      "sessionId":"sess_01",
      "configOptions":[...],
      "modes":{"currentModeId":"default","availableModes":[...]},
      "availableCommands":[...]
    }}

--> {"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{
      "sessionId":"sess_01",
      "prompt":[{"type":"text","text":"读一下这个仓库的入口，告诉我启动链路"}]
    }}
```

v1 的 `session/prompt` 在**整轮结束时**返回 `stopReason`：

```json
<-- {"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}
```

流式过程通过 `session/update` 通知推进：

```json
<-- {"jsonrpc":"2.0","method":"session/update","params":{
      "sessionId":"sess_01",
      "update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"先看 "}}
    }}

<-- {"jsonrpc":"2.0","method":"session/update","params":{
      "sessionId":"sess_01",
      "update":{
        "sessionUpdate":"tool_call",
        "toolCallId":"tc_01",
        "title":"Read package.json",
        "kind":"read",
        "status":"pending",
        "locations":[{"path":"/absolute/workspace/package.json","line":1}]
      }
    }}
```

注意：`session/update` 是**通知**，没有 `id`，也不回复；`session/request_permission` 才是 Agent 发给 Client 的**请求**，Client 必须回复。

### 2.4 权限请求

```json
<-- {"jsonrpc":"2.0","id":10,"method":"session/request_permission","params":{
      "sessionId":"sess_01",
      "toolCall":{"toolCallId":"tc_01","title":"Run tests","kind":"execute","status":"pending"},
      "options":[
        {"optionId":"allow_once","name":"Allow once","kind":"allow_once"},
        {"optionId":"allow_always","name":"Always allow","kind":"allow_always"},
        {"optionId":"reject_once","name":"Reject","kind":"reject_once"}
      ]
    }}

--> {"jsonrpc":"2.0","id":10,"result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}
```

**权限必须 fail closed**。OpenMausBot 的 ACP 驱动在文件头写得很清楚：只有 `allow` 类型的选项才算批准，**选项顺序永远不能当安全契约**。这条不是风格建议，是安全边界：不同 Agent 给选项排序的理由完全不同，把 `options[0]` 当「允许」会在某个引擎上直接变成默认放行。

---

## 3. 生命周期细节

### 3.1 `initialize`

v1 只在连接开头调用一次。v2 草案允许在协议版本允许时重复初始化，用于重新协商能力。请求字段：

- `protocolVersion`：整数，只有 **MAJOR**，不是 semver。
- `clientCapabilities`：客户端能提供什么。
- `clientInfo`：`name` / `title` / `version`。
- `_meta`：实现扩展。

响应字段：

- `protocolVersion`：Agent 支持的版本。
- `agentCapabilities`：Agent 能做什么。
- `authMethods`：非空表示需要认证。
- `agentInfo`：Agent 元数据。

**版本协商规则**：客户端发自己支持的最新版本；Agent 回同一个版本，或回自己支持的最新版本；客户端如果不支持 Agent 返回的版本，必须关闭连接。不能从 SDK、crate、npm 包的版本反推 wire 兼容性。

**能力协商规则**：字段省略 = 不支持；新增能力是向后兼容的；客户端不能假设「对方一定支持」。ACP 官方明确说，Agent 不支持的能力必须省略，而不是填 `false` 再假装能用。

核心能力字段：

| 方向 | 字段 | 含义 |
| --- | --- | --- |
| Client | `fs.readTextFile` / `fs.writeTextFile` | 宿主能否代读/代写文件 |
| Client | `terminal` | 宿主能否提供终端 |
| Client | `session.list` / `session.notices` / `session.compaction` | 客户端侧会话列表、通知、压缩能力 |
| Agent | `loadSession` | 能否 `session/load` 恢复并重放历史 |
| Agent | `promptCapabilities.image` / `audio` / `embeddedContext` | prompt 里能否接图片、音频、嵌入资源 |
| Agent | `mcpCapabilities.stdio` / `http` / `sse` / `acp` | 支持哪些 MCP 传输 |
| Agent | `sessionCapabilities.list` / `fork` / `resume` / `close` / `delete` / `additionalDirectories` | 会话管理能力 |
| Agent | `auth.logout` | 是否支持登出 |
| Agent | `providers` | 是否支持模型 provider 管理（v2/实现扩展） |

### 3.2 认证

- v1 用 `authenticate`（methodId）+ `logout`。
- v2 用 `auth/login`（methodId）+ `auth/logout`。如果 `authMethods` 非空，v2 Agent 必须同时实现 login 与 logout。
- 三种认证方式：
  - `agent`：Agent 自己完成（浏览器、设备码、OAuth 回调等）。
  - `terminal`：宿主开一个终端，用户在终端里输入。
  - `env_var`：宿主设置环境变量；`vars` 列出需要的变量名。
- **凭据留在 Agent 自己的 store**。宿主可以传环境变量，但不应该把 provider key、workspace token、控制面 token 透传给 Agent。OpenMausBot 的 `custom-acp` 文档明确：从子进程环境中移除三类变量——自身 provider key、workspace 凭据（如 `BOX_TOKEN` / `OMB_*`）、控制面变量（`OMB_CLOUD_*` 与 license key）。
- `PATH` 不能由实例设置；需要完整路径时写进 `config.cli`。一个 CLI 多实例可以共存，靠 `HOME` 区分账号。

### 3.3 会话建立

- `session/new`：`cwd` 必须是绝对路径；`mcpServers` 是数组；返回 `sessionId`，可选 `configOptions`、`modes`、`availableCommands`。
- `session/load`（v1）：恢复已有会话，并把历史以普通 `session/update` **重放**。重放期间不能发任何新东西；`_meta.isReplay` 的更新要丢弃，否则 UI 会把历史当新消息。
- `session/resume`（v2）：恢复会话，可选 `replayFrom`；重放结束发 `replay_complete`；客户端必须**重建**状态，而不是把重放事件按 ID 合并进旧状态。
- `session/list`：游标分页，返回 `sessionId`、`cwd`、`title`、`updatedAt`。这是「原生会话导入」的基础：T3 Code 支持把 Agent 的原生 session 导入成确定性 thread，同一个 session 重复导入返回同一个 thread。
- `session/close`：取消前台与后台工作、释放终端与资源；**幂等**；对已关闭会话返回 `-32002` 时按成功处理。
- `session/delete` / `session/fork`：可选能力；不是所有 Agent 都支持。
- **active session** 是显式状态。v1 规定：prompt 以及其他 session-scoped 请求只能在会话 active 时发；会话关闭后变为 inactive；用 `session/load` / `session/resume` 重新激活。否则返回 `-32002`。

### 3.4 一轮 prompt（v1）

- `session/prompt` 接收 `ContentBlock[]`；v2 要求非空。
- Agent 在整轮中流式发 `session/update`；最后 `session/prompt` 的响应返回 `stopReason`。
- `stopReason`：`end_turn`、`max_tokens`、`max_turn_requests`、`refusal`、`cancelled`。
- Agent 可以在轮中发 `plan`、`tool_call`、`tool_call_update`、`session/request_permission`、`current_mode_update`、`config_option_update`、`available_commands_update`。
- **ACP 没有 `turn/completed` 这种方法**。OpenMausBot 的驱动注释写得很直接：ACP has no `turn/completed`: the `session/prompt` result (`stopReason` + usage) is the completion。很多人第一次接 ACP 会等一个不存在的完成事件，然后超时。
- 取消：Client 发 `session/cancel` **通知**；Agent 中止本轮，返回 `stopReason: "cancelled"`。Client 要把所有未终态 tool call 标成 cancelled；如果此时有挂起的 `session/request_permission`，必须用 `outcome: "cancelled"` 回复。
- 权限请求可以在轮中任何时刻 arrival；Client 可以拒绝、允许一次、始终允许。拒绝不是错误，是正常业务结果。

### 3.5 一轮 prompt（v2 draft）

v2 把「请求被接受」和「工作完成」拆成两个时点：

1. `session/prompt` 先把用户消息插入会话，立刻返回 `messageId`（表示 accepted）。
2. 工作可以在这之前或之后开始；`session/update` 可能在响应之前、也可能在响应之后到达。**不能把响应当成最终结果，也不能用响应时序推断事件顺序。**
3. 前台结束由 `state_update` 的 `idle` 表示，里面带 `stopReason`；`running` 表示正在跑；`requires_action` 表示等待权限或 elicitation。
4. `background` 列表表示前台 idle 后仍在跑的子任务；客户端要能展示「主轮已结束，但后台还在跑」。
5. `replay_complete` 表示 `session/resume` 的重放结束；客户端必须先重建快照，再处理后续事件。
6. `idempotencyKey` 用于重试：同一个 key 重发 `session/prompt`，Agent 应返回同一个 `messageId`，不重复插入用户消息。

v2 还加了 `session/list`、`session/resume`、`session/close`、`session/delete`、`session/fork`、`auth/login`、`auth/logout`、`providers/*`、`mcp/message`、`proxy/*`、`prompt_suggestions_update`、`cursor_update` 等。**其中一部分是官方 v2 草案，一部分是具体客户端的扩展**，下面会分开讲。

---

## 4. 数据模型

### 4.1 ContentBlock

ACP 复用 MCP 的内容块模型：

| 类型 | 字段 | 基线要求 |
| --- | --- | --- |
| `text` | `text` | 必须支持 |
| `resource_link` | `uri`、`name`、`mimeType?`、`size?`、`description?` | 必须支持 |
| `image` | `data`（base64）、`mimeType`、`uri?` | 由 `promptCapabilities.image` 决定 |
| `audio` | `data`、`mimeType` | 由 `promptCapabilities.audio` 决定 |
| `resource` | `resource`：`text` 或 `blob`，带 `uri`、`mimeType` | 由 `promptCapabilities.embeddedContext` 决定 |

`resource_link` 只是一个指针，不携带内容；`resource` 才是嵌入内容。**能力不足时的正确降级**：图片/音频降成文本占位，嵌入资源降成 `resource_link`，而不是直接丢消息。

### 4.2 `session/update` 的变体

v1 的核心变体：

- 消息：`user_message_chunk`、`agent_message_chunk`、`agent_thought_chunk`
- 工具：`tool_call`、`tool_call_update`
- 计划：`plan`
- 配置：`current_mode_update`、`config_option_update`、`available_commands_update`
- 会话信息：`session_info_update`

v2 草案/实现扩展里还能见到：

- `user_message`、`agent_message`、`agent_thought`（完整消息，与 chunk 并存）
- `session_message`、`session_message_chunk`
- `state_update`、`replay_complete`
- `tool_call_content_chunk`、`terminal_update`、`terminal_output_chunk`
- `plan_update`、`plan_removed`（draft）
- `usage_update`
- `notice`
- `compaction_update`、`compaction_summary_chunk`
- `subagent_update`
- `prompt_suggestions_update`（draft）
- `cursor_update`（draft）

**不要假设变体集合是封闭的**。未知变体必须保留原始 payload，交给上层决定是否展示；直接丢弃会让新 Agent 的新能力在你的客户端里静默消失。

### 4.3 实体 ID 与顺序

- 实体类型 + ID 才是主键：`messageId`、`toolCallId`、`terminalId`、`planId`、`compactionId`。同一个字符串可以同时是 message ID 和 tool call ID，**不能只按字符串去重**。
- 某个 ID 的**第一条 update 决定它在时间线上的位置**；后续 chunk 追加；`tool_call_update` 是完整替换，不是增量。
- chunk 可能先于完整对象到达；客户端要先建占位，再填充。
- v2 的事件可能先于 `session/prompt` 响应到达；不能因为「还没拿到响应」就丢弃 update。
- `session/load`/`session/resume` 的重放是**权威快照**，不是增量补丁；先清空再重建。

### 4.4 Tool call

```ts
type ToolCall = {
  toolCallId: string;
  title: string;
  kind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other";
  status: "pending" | "in_progress" | "completed" | "failed";
  content?: Array<
    | { type: "content"; content: ContentBlock }
    | { type: "diff"; path: string; oldText?: string; newText: string }
    | { type: "terminal"; terminalId: string }
  >;
  locations?: Array<{ path: string; line?: number }>;
  rawInput?: unknown;
  rawOutput?: unknown;
};
```

`rawInput` / `rawOutput` 是 Agent 原生工具的原始输入输出，客户端不要把它当稳定 schema；它适合做「查看原始参数」的逃生口，不适合做业务逻辑。

### 4.5 Config options 与 modes

- `configOptions` 是 v2 的主模型：`id`、`name`、`description`、`category`、`type: "select"`、`currentValue`、`options`。
- `category` 常见：`mode`、`model`、`thought_level`。
- `session/set_config_option` 设置后，Agent 返回**完整的新 configOptions 列表**；不是只回一个 diff。
- `modes` 是旧模型：`currentModeId` + `availableModes`，配 `session/set_mode`。
- 过渡期 Agent 可能同时发 `modes` 和 `configOptions`；客户端应优先 `configOptions`，但保留对 `modes` 的兼容。
- 不要在客户端硬编码 option id。不同 Agent 的 `model`、`mode`、`thought_level` 取值完全不同。

### 4.6 终端与文件系统

Agent 可以调 Client 的这些方法（需要 Client 在 `initialize` 里声明能力）：

- `fs/read_text_file`：读文件，支持 `line` / `limit`。
- `fs/write_text_file`：写文件。
- `terminal/create`：创建终端，返回 `terminalId`。
- `terminal/output`：读输出，支持 `outputByteLimit`，超出会截断。
- `terminal/wait_for_exit`：等退出，返回退出码与信号。
- `terminal/kill` / `terminal/release`：杀进程 / 释放资源。

tool call 的 `content` 可以嵌入 `terminal`，让客户端把命令输出直接挂在工具卡片上。T3 Code 的做法是：Devin 的命令走 T3 自己的终端，遵循 thread 的 permission mode；其他 Agent 只展示 Agent 上报的命令、输出和退出码，不替它运行或停止终端。

### 4.7 usage、compaction、notice

- `usage_update`：上下文窗口用量、累计成本。OpenMausBot 的 capability 里用 `contextReading: "meter"` 表达「能读上下文表」。
- `compaction_update` / `compaction_summary_chunk`：Agent 压缩历史时的进度与摘要；客户端应展示「正在压缩」，而不是把摘要当普通消息。
- `notice`：实时提示，**不会被重放**。适合「网络不稳」「已切换到备用模型」这类一次性信息。
- `state_update`：v2 的会话状态机；`running` / `requires_action` / `idle` / `unknown`。`requires_action` 是等待权限或 elicitation 的显式信号，比「等一个 permission 请求」更可靠。

---

## 5. 版本与扩展机制

### 5.1 `protocolVersion` 是唯一 wire 判据

- 它是整数 MAJOR，不是 `1.2.3`。
- 官方稳定版是 **1**；v2 是 **draft**。
- Rust crate 版本、JSON Schema 版本、TypeScript SDK 版本、Python 包版本，都**不能**推断 wire 兼容性。
- 唯一判据是 `initialize` 返回的 `protocolVersion`。
- 如果 Agent 返回的版本客户端不支持，关闭连接；不要「尽力解析」。
- v2 允许在版本允许时重复 `initialize` 来重新协商；v1 只在开头一次。

### 5.2 v1 与 v2 的关键差异

| 维度 | v1（stable） | v2（draft/preview） |
| --- | --- | --- |
| 认证 | `authenticate` / `logout` | `auth/login` / `auth/logout`；`authMethods` 非空必须两者都实现 |
| 恢复会话 | `session/load` 重放历史 | `session/resume` + `replayFrom` + `replay_complete`；重建快照 |
| 会话管理 | 基本只有 new/load | `session/list`、`session/close`、`session/delete`、`session/fork` |
| prompt 响应 | 整轮结束返回 `stopReason` | 先返回 `messageId`（accepted），前台结束由 `state_update.idle` 表示 |
| 状态机 | 隐式（靠请求-响应推断） | 显式 `state_update`：`running` / `requires_action` / `idle` / `unknown` |
| 取消 | `session/cancel` | 同左，另有 `$/cancel_request` 取消未完成请求 |
| 扩展 | `_meta` | `_meta` + `_` 前缀方法 + proxy 链 + 更丰富的 update 变体 |
| 子任务 | 无标准表达 | `background` 列表；`subagent_update` |
| 压缩/用量 | 实现自定义 | `compaction_update`、`usage_update` 等标准变体 |

**最容易踩的差异**：v1 的 `session/prompt` 响应是「整轮完成」，v2 的响应是「已接受」。把 v2 的响应当最终结果，会在 Agent 还在跑的时候就结束 UI 的 loading。

### 5.3 `_meta`、`_` 方法与未知变体

ACP 的扩展机制有三层：

1. **`_meta`**：可以挂在请求、响应、通知上。根级保留键是 `traceparent`、`tracestate`、`baggage`（W3C Trace Context）；其他自定义数据放在 `_meta` 里，Agent 必须原样保留。
2. **`_` 前缀方法**：自定义方法名以 `_` 开头，避免与标准方法冲突；未知通知忽略，未知请求返回 `-32601`。
3. **未知变体**：`SessionUpdate`、`ContentBlock` 这类可扩展联合接受未知成员；自定义变体的 tag 必须以 `_` 开头，并且只能出现在**收到的值**里，不能由客户端主动构造。

TypeScript SDK v2 的 `UnknownVariant`、T3 `effect-acp` 的 `_t3_unknown`、Rust 的 exact-version raw params，都是同一件事的不同实现：**先保留，再决定**。

### 5.4 T3 的 v2 preview 是「实现扩展」，不是官方标准

T3 Code 的 `effect-acp` 把 `PROTOCOL_VERSION` 设为 `2`，方法表里除了标准方法，还有：

- `providers/list`、`providers/set`、`providers/disable`
- `session/list`、`session/delete`、`session/fork`、`session/resume`、`session/close`
- `auth/login`、`auth/logout`
- `nes/start`、`nes/suggest`、`nes/accept`、`nes/reject`、`nes/close`
- `document/didOpen`、`document/didChange`、`document/didClose`、`document/didSave`、`document/didFocus`

这些不全是官方 ACP v2 的保证。T3 文档的准确说法是：它**偏好当前 ACP v2 preview**，用更丰富的消息、用量、计划、配置、压缩、Agent 终端更新；对还没迁移的 Registry Agent 会**协商回 v1**，所以同一个通用集成能继续工作。Claude Agent 默认用 v2 preview，出问题时用 `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` 回退 v1。

**结论**：看到某个客户端的方法表，不要把它当协议标准；以 `initialize` 协商出的版本 + 对方实际声明的方法/能力为准。

---

## 6. 如何兼容不同协议的通信

### 6.1 先画边界，不要找一个「万能协议」

| 边界 | 协议 | 解决什么 | 不解决什么 |
| --- | --- | --- | --- |
| 宿主 ↔ Agent | **ACP** | 会话、prompt、流式事件、权限、终端/文件回调 | Agent 之间协作、工具发现、UI 渲染 |
| Agent ↔ 工具/数据 | **MCP** | 工具发现、调用、资源、prompt、采样 | 会话生命周期、权限 UI |
| Agent ↔ Agent | **A2A** | 能力发现（Agent Card）、任务生命周期、长任务、推送通知 | 编辑器会话、工具调用 |
| Agent ↔ UI | **AG-UI** | 事件流、生成式 UI、共享状态、human-in-the-loop | Agent 控制、工具发现 |
| 支付 | AP2 | 结账、支付授权 | Agent 会话 |

这五个协议不是互斥关系，而是**不同边界上的语言**。一个宿主可以同时说四种：对本地 Agent 说 ACP，对工具说 MCP，对远端 Agent 说 A2A，对前端说 AG-UI。

### 6.2 分层适配器模型

```
┌─────────────────────────────────────────────┐
│ UI / CLI / Mobile / IDE                     │
│   ↕ AG-UI 事件流 / HTTP / SSE / WS           │
├─────────────────────────────────────────────┤
│ Host（nx-kv）：会话路由、任务、审计、权限 UI   │
│   ├─ ACP adapter   ── 本地 Agent 子进程       │
│   ├─ MCP adapter   ── 工具/资源               │
│   ├─ A2A adapter   ── 远端 Agent              │
│   └─ RuntimeEvent bus（统一事件模型）          │
└─────────────────────────────────────────────┘
```

七层职责：

1. **Transport**：stdio / HTTP / SSE / WebSocket；一行一个 JSON，或 HTTP 流。
2. **Codec/Schema**：v1/v2 类型、生成代码、未知字段保留。
3. **Session**：new/load/resume/close/list；会话映射到宿主自己的 task/thread。
4. **Capability**：能力矩阵、降级、禁止宣告不支持的能力。
5. **Semantic**：把 ACP `session/update`、MCP notification、A2A task update、AG-UI event 归一化成 RuntimeEvent。
6. **Policy**：权限、认证、环境隔离、审计、重试、幂等。
7. **Host**：任务队列、UI 投影、持久化、多端分发。

**关键原则**：上层只消费 RuntimeEvent，不直接解析任何协议的原始 JSON。这样换 Agent、换协议、加扩展，都不会污染 UI 和业务逻辑。

### 6.3 统一事件模型（RuntimeEvent）

```ts
type RuntimeEvent =
  | { kind: "message"; role: "user" | "agent"; messageId: string; text?: string; content?: ContentBlock[]; chunk: boolean }
  | { kind: "thought"; messageId: string; text: string; chunk: boolean }
  | { kind: "tool"; toolCallId: string; title: string; toolKind: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      content?: ToolContent[]; locations?: Location[]; rawInput?: unknown; rawOutput?: unknown }
  | { kind: "plan"; planId: string; entries: PlanEntry[] }
  | { kind: "permission"; requestId: string; sessionId: string;
      toolCall?: ToolCall; options: PermissionOption[] }
  | { kind: "state"; sessionId: string;
      state: "running" | "requires_action" | "idle" | "unknown";
      stopReason?: StopReason; background?: BackgroundTask[] }
  | { kind: "usage"; sessionId: string; used: number; size: number; cost?: number }
  | { kind: "notice"; sessionId?: string; level: "info" | "warning" | "error"; message: string }
  | { kind: "replay_complete"; sessionId: string }
  | { kind: "unknown"; method?: string; payload: unknown };
```

映射表：

| 协议事件 | RuntimeEvent |
| --- | --- |
| ACP `agent_message_chunk` | `message`（role=agent，chunk=true） |
| ACP `agent_thought_chunk` | `thought` |
| ACP `tool_call` / `tool_call_update` | `tool` |
| ACP `plan` / `plan_update` | `plan` |
| ACP `session/request_permission` | `permission` |
| ACP `state_update` | `state` |
| ACP `usage_update` | `usage` |
| ACP `notice` | `notice` |
| ACP `replay_complete` | `replay_complete` |
| MCP notification | `tool` / `notice` / `unknown`，按 method 映射 |
| A2A task update | `state` / `message`，按 task state 映射 |
| AG-UI event | `message` / `tool` / `state`，按 event type 映射 |

未知事件统一进 `unknown`，不要丢。UI 可以折叠展示「未知事件」，但日志里必须保留原始 payload。

### 6.4 能力协商与降级

五条硬规则：

1. **省略 = 不支持**。不要假设对方有 `loadSession`、`resume`、`image`。
2. **绝不宣告自己挂不上的能力**。OpenMausBot 的 `capabilities.ts` 把这条写成了实现原则：能力矩阵是 driver 对外的承诺，不是愿望清单。
3. **按能力裁剪内容**：图片/音频/嵌入资源不支持时降级为文本或 `resource_link`。
4. **按能力裁剪会话操作**：不支持 `resume` 就新会话 + 重发保留上下文；不支持 `fork` 就不提供分叉按钮。
5. **按能力裁剪 UI**：不支持 `session/list` 就不显示「原生会话」；不支持 `logout` 就不显示登出。

```ts
function pickPrompt(blocks: ContentBlock[], caps: AgentCapabilities): ContentBlock[] {
  return blocks.flatMap((b) => {
    if (b.type === "image" && !caps.promptCapabilities?.image) {
      return [{ type: "text", text: "[image omitted: capability not advertised]" }];
    }
    if (b.type === "audio" && !caps.promptCapabilities?.audio) {
      return [{ type: "text", text: "[audio omitted: capability not advertised]" }];
    }
    if (b.type === "resource" && !caps.promptCapabilities?.embeddedContext) {
      return [{ type: "resource_link", uri: b.resource.uri, name: b.resource.uri }];
    }
    return [b];
  });
}
```

### 6.5 跨协议的版本协商

| 协议 | 版本形态 | 协商点 | 失败策略 |
| --- | --- | --- | --- |
| ACP | 整数 MAJOR | `initialize.protocolVersion` | 不支持就关闭 |
| MCP | 日期版本（如 2025-11-25） | `initialize` 的 `protocolVersion` | 服务端回同一版本或自己最新版本；客户端不支持就断开 |
| A2A | `AgentCard` 里的 `protocolVersion` + 多 binding | Agent Card 拉取 + 请求 | 版本协商错误；按 binding 能力选择 |
| AG-UI | 1.0 冻结 spec + JSON Schema | SDK/事件 schema | 未知事件保留 |
| T3 ACP | v2 preview + v1 fallback | `initialize` + 环境开关 | 回退 v1 |

通用规则：**连接时协商、失败快、不要从包版本推断**。

### 6.6 未知字段与未知变体保留

四层保留：

1. **协议层**：`_meta` 原样透传；`_` 方法不拦；未知通知忽略但记录。
2. **Schema 层**：可扩展联合保留 `UnknownVariant`；T3 的 `ContentBlock` 有 `_t3_unknown`，TS SDK v2 有 `UnknownVariant`，Rust exact-version 保留 raw params。
3. **存储层**：事件表存 `raw` JSON；归一化字段只做索引，不替代原文。
4. **UI 层**：未知事件折叠展示，不静默丢弃。

为什么必须这样做：Agent 生态的演进速度快于你的发版速度。今天丢掉一个未知字段，明天就丢失一个 Agent 的新能力；而且这种丢失通常没有报错，只是「看起来没反应」。

### 6.7 代理链（proxy / conductor）

ACP 有一个非常适合做兼容层的机制：**proxy chain**。

- Conductor 负责拉起一串 proxy 和最终 Agent。
- 每个 proxy 先收 `proxy/initialize`，再收 `proxy/successor`，然后与后继建立连接。
- Proxy 可以**增加或移除能力**；不能改变 `protocolVersion`。
- Proxy 必须原样转发未知方法；不能改 sessionId；不能无限缓冲；必须逐跳传播取消。
- 最后一个 Agent 不知道前面有 proxy。
- 任何一跳失败，整条链失败；错误要带上是哪一跳。

示意命令（具体参数以 crate 文档为准）：

```bash
agent-client-protocol-conductor \
  --proxy ./proxy-policy \
  --proxy ./proxy-mcp \
  --agent "npx -y @zed-industries/claude-agent-acp"
```

典型用途：

- 给任意 ACP Agent 注入公司 MCP server；
- 加审计/脱敏/配额；
- 把旧 CLI 包装成 ACP；
- 按租户切换模型或 provider；
- 在 Agent 前面加一层「工具白名单」；
- 给不支持某项能力的 Agent 临时补一个 proxy，而不是 fork 它。

**为什么这比「自己写第六种协议」好**：协议边界不变，组合在链上完成；每加一个能力只是加一个 proxy，不改变宿主与 Agent 的契约。

### 6.8 Registry / 安装器模式

ACP Registry 把「安装一个 Agent」变成数据问题，而不是代码问题：

- Registry 索引：`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
- JetBrains 专用索引：`registry-for-jetbrains.json`、`registry-for-jetbrains-preview.json`、`registry-for-jetbrains-air.json`
- Registry 只收录**支持用户认证**的 Agent；CI 会验证 Agent 在 ACP 握手时返回合法的 `authMethods`。
- 每个 Agent 一个目录：`<agent-id>/agent.json`，格式以仓库里的 `agent.schema.json` 为准；分发类型支持 npm、PyPI、GitHub Releases 等。
- 版本每小时自动更新；新增 Agent 通过 fork registry 仓库 + 加目录 + PR。
- 安装落点：`tools/<agent-id>/<version>/`；有 SHA-256 就校验，没有就依赖 HTTPS 分发保证。
- `npx` / `uvx` 包用宿主自己的 npm prefix / Python tool 目录，锁定 Registry 发布的精确版本。
- 认证留在 Agent 自己的 store；宿主只负责把登录流程呈现出来。
- 删除最后一个 provider 实例会删宿主管理的二进制，但保留包安装；要用本地已有二进制，显式设置 executable override。

这套模式可以直接搬到 nx-kv：**Registry 是数据，安装器是通用逻辑，Agent 是子进程**。不要为每个 Agent 写一套安装代码。

### 6.9 网关 / 多路复用

一个宿主接多个 Agent 时，需要一层网关：

- **会话路由表**：`hostSessionId ↔ agentId ↔ acpSessionId`；一个 host session 同时只能有一个前台 turn。
- **每 Agent 能力矩阵**：不要在 UI 上暴露该 Agent 不支持的操作。
- **崩溃隔离**：一个 Agent 子进程挂了，不能带崩宿主；stderr 单独收集，stdout 只跑协议。
- **背压**：`session/update` 可能很密集；按 session 做批量/节流，但不要丢最终状态。
- **幂等**：v2 `idempotencyKey`；v1 用宿主自己的 turn ID 做去重。
- **超时**：initialize、session/new、prompt 各自设置；prompt 没有响应不代表失败，可能只是慢。
- **重连/重放**：断线后用 `session/list` + `session/resume` 恢复；没有 resume 就新会话 + 重发保留上下文。
- **观测**：每次请求带 `_meta.traceparent`；stderr 按 agentId/sessionId 切分；错误带 agentId + method + JSON-RPC code。

### 6.10 安全与正确性清单

- 权限 **fail closed**：只有 `allow_once` / `allow_always` 算批准；拒绝和取消都算不批准。
- **绝不用选项顺序当安全契约**；只认 `kind`。
- **环境隔离**：移除 provider key、workspace token、控制面 token；不要透传宿主凭据。
- **stdout 只跑协议**：任何 print/日志/警告都走 stderr；一行一个 JSON，不能有嵌入式换行。
- **路径绝对化**：Agent 与宿主可能在不同 cwd；相对路径会静默错位。
- **重放处理**：`session/load` / `session/resume` 的历史是权威快照；先清空再重建；`_meta.isReplay` 的更新不要当新消息。
- **请求 ID**：不能 null；不能在同一发送方等待回复时复用；不能 batch。
- **取消**：取消是通知；Agent 必须返回 `cancelled`；挂起的权限请求必须用 `cancelled` 回复。
- **认证**：`authMethods` 非空就必须实现 login/logout；凭据留在 Agent store。
- **远程边界**：远程客户端不能替代宿主的文件系统、provider 凭据、机器状态；Agent 永远跑在宿主所在机器。
- **Registry 第三方代码**：安装前看来源与 license；有 SHA-256 必须校验；没有校验要明确告知。
- **网络暴露**：宿主默认只绑 `127.0.0.1`；要远程访问必须加 token/auth/TLS，不能裸奔。

### 6.11 一致性测试

ACP 官方已经有 **acp-tck**（Test Compatibility Kit，Python）。它适合做 CI 里的协议级验收：

- `initialize`：版本、能力、authMethods 合法性。
- 会话：new/load/resume/close/list；inactive session 的错误码。
- prompt：accepted、流式 update、stopReason、取消。
- 权限：allow/reject/cancel；fail closed。
- 错误：未知方法 `-32601`、非法参数 `-32602`、auth required `-32000`、unknown session `-32002`。
- 传输卫生：一行一个 JSON、无 batch、ID 不复用、stdout 无日志。

再加三类自测：

1. **黄金转录**：录制真实 Agent 的请求/响应，回放断言；换版本时对比 diff。
2. **恶意/畸形输入**：截断 JSON、重复 ID、未知变体、超长行、乱序 update、权限请求中途取消。
3. **跨版本矩阵**：v1 Agent + v2 Client、v2 Agent + v1 Client、T3 扩展 Agent、Registry Agent。

**不要用「SDK 版本相同」证明兼容**；只信实际握手与 TCK 结果。

### 6.12 反模式

| 反模式 | 为什么错 | 正确做法 |
| --- | --- | --- |
| 自研第六种 Agent 协议 | 生态已经收敛到 ACP + MCP；自研等于放弃所有现成 Agent | 用 ACP 做宿主边界，用 MCP 做工具边界 |
| 把 OpenAI-compatible HTTP 当 Agent 执行引擎 | 它通常是 chat-only，没有工具循环、权限、会话 | 用 ACP 接真正的编码 Agent |
| 把 AG-UI 当 Agent 控制协议 | AG-UI 是 Agent ↔ UI 的事件协议，不控制 Agent | 控制走 ACP/A2A，UI 走 AG-UI |
| 把 OpenClaw 的 WS 当模型协议 | 它是控制平面，不是模型 wire protocol | 控制面归控制面，模型调用归 Agent |
| 从 SDK 版本推断 wire 版本 | 包版本与协议版本无关 | 只信 `initialize.protocolVersion` |
| 用权限选项顺序判断允许 | 不同 Agent 排序理由不同 | 只认 `kind`，fail closed |
| 丢弃未知字段/变体 | 新能力静默消失，无报错 | 保留 raw，折叠展示 |
| 把日志打到 stdout | 破坏 JSON-RPC 行协议 | 日志一律 stderr |
| 宣告不支持的能力 | UI 会出现「点了没反应」 | 能力矩阵只写真实能做的 |
| 把 v2 prompt 响应当最终结果 | 工作可能刚开始 | 等 `state_update.idle` |
| 把 `session/load` 重放当新消息 | 历史会重复/错序 | 先清空重建，丢弃 replay 标记 |
| 复用请求 ID | 响应错配，随机挂起 | 每个发送方独立 ID，等待期间不复用 |

---

## 7. 开源项目地图

### 7.1 ACP 核心与 SDK

| 项目 | 链接 | 能学什么 |
| --- | --- | --- |
| **agent-client-protocol** | https://github.com/agentclientprotocol/agent-client-protocol | 官方规范 + Rust schema/runtime；4.7k stars；协议类型、JSON Schema、proxy/conductor 的源头 |
| **typescript-sdk** | https://github.com/agentclientprotocol/typescript-sdk | 官方 TS SDK；v2.6.0；stable v1 与 experimental v2 分入口；`UnknownVariant` 的保留策略 |
| **python-sdk** | https://github.com/agentclientprotocol/python-sdk | Pydantic 模型、async Agent/Client 基类、JSON-RPC 监督、`acp.contrib` 的 session accumulator / permission broker / tool call tracker |
| **rust-sdk** | https://github.com/agentclientprotocol/rust-sdk | v5；版本化 connection builder、`Channel`/`Lines`/`ByteStreams`/`Stdio`、conductor、rmcp 集成 |
| **kotlin-sdk / java-sdk** | https://github.com/agentclientprotocol（org 列表） | JVM 生态接入；适合 JetBrains 类宿主 |
| **registry** | https://github.com/agentclientprotocol/registry | `agent.json` schema、认证 CI、每小时版本更新、JetBrains 三套索引；464 stars |
| **acp-tck** | https://github.com/agentclientprotocol/acp-tck | 官方一致性测试套件；CI 里做协议级验收 |
| **claude-agent-acp** | https://github.com/agentclientprotocol/claude-agent-acp | Claude Agent SDK 的 ACP 包装器；2.8k stars；看「官方 Agent 怎么暴露成 ACP」 |
| **codex-acp** | https://github.com/agentclientprotocol/codex-acp | Codex CLI 的 ACP server；583 stars；看「CLI 怎么做 ACP 适配」 |
| **agent-client-protocol-http** | https://github.com/agentclientprotocol/agent-client-protocol-http | HTTP/SSE 与 WebSocket 传输；远程 ACP 的参考 |
| **agent-client-protocol-rmcp** | https://github.com/agentclientprotocol/agent-client-protocol-rmcp | MCP over ACP / rmcp 桥接 |
| **agent-client-protocol-conductor** | https://github.com/agentclientprotocol/agent-client-protocol-conductor | Proxy 链编排；兼容层的最佳落点 |

### 7.2 生产客户端与实现

| 项目 | 链接 | 特殊技术栈 / 可学点 |
| --- | --- | --- |
| **T3 Code** | https://github.com/pingdotgg/t3code | Effect + Effect Schema、生成协议类型、`compat.ts` 多版本联合、`AcpOutgoingQueued`、`provider-acp` 的 clientPolicy/terminals/elicitation/mcp bridge、`provider-acp-registry` 的安装与认证协调、一个宿主 + 瘦客户端 |
| **OpenMausBot** | https://github.com/milind-soni/OpenMausBot | 共享 ACP driver + 每 CLI 的 `AcpSupport`、能力矩阵、`RuntimeEvent`、`node:sqlite` 审计（assignments/events/inbox）、权限 fail closed、环境变量清洗、prompt split、quiet status |
| **Docker Agent** | Registry 收录（`docker-agent` 目录） | configOptions、持久化会话、安全模式、运行中拒绝修改配置 |
| **ZeroClaw** | ACP v1 生产实现（文档见 ZeroClaw docs） | JSON-RPC over stdio、SQLite 持久化、blob 上传到 `{session.workspaceDir}/uploads/`、10MB/base64 校验、`INVALID_PARAMS` |
| **Zed** | https://zed.dev | ACP 的发起方与主要客户端；编辑器侧会话/权限/终端 UX 的基准 |
| **JetBrains IDEs** | Registry 的 JetBrains 索引 | 用 Registry 数据驱动 IDE 插件；preview / air 两套索引 |

### 7.3 相邻协议

| 协议 | 项目 | 能学什么 |
| --- | --- | --- |
| **MCP** | https://github.com/modelcontextprotocol/modelcontextprotocol | 规范 + schema；9.7k stars；JSON-RPC、stdio/Streamable HTTP、生命周期版本协商、工具/资源/prompt |
| **MCP Servers** | https://github.com/modelcontextprotocol/servers | 官方参考 server；工具设计、资源暴露、安全边界 |
| **A2A** | https://github.com/a2aproject/A2A | Agent Card、任务生命周期、长任务、推送通知、JSON-RPC/gRPC/HTTP+JSON 多 binding；26.6k stars |
| **AG-UI** | https://github.com/ag-ui-protocol/ag-ui | 1.0 冻结 spec + JSON Schema、事件族、生成式 UI、共享状态、human-in-the-loop、middleware；20.3k stars |
| **CopilotKit** | https://github.com/CopilotKit/CopilotKit | AG-UI 的前端落地；React 组件与 agent 事件流的对接 |

### 7.4 已退役 / 不要误用

- **IBM Agent Communication Protocol**：2025-08 并入 A2A，原仓库归档（2025-08-27）。看到 REST + agent-to-agent 的「ACP」，基本就是它；不要在新项目里采用。
- **Agentic Commerce Protocol**：支付/结账协议，不是 Agent 会话协议。

---

## 8. 关键代码走读

### 8.1 最小 ACP 客户端骨架（TypeScript 示意）

```ts
import { ClientSideConnection, ndjsonStream } from "@agentclientprotocol/sdk";

// 1. spawn agent 子进程，stdin/stdout 接入 ndjsonStream
const connection = new ClientSideConnection(clientImpl, ndjsonStream(agent.stdout, agent.stdin));

// 2. 只协商一次；protocolVersion 是整数 MAJOR
const init = await connection.initialize({
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  },
  clientInfo: { name: "nx-kv", title: "nx-kv", version: "0.64.0" },
});

// 3. 新会话：cwd 必须绝对路径
const session = await connection.newSession({
  cwd: workspaceAbsPath,
  mcpServers: [],
});

// 4. 一轮 prompt：v1 的返回值是整轮结束
const result = await connection.prompt({
  sessionId: session.sessionId,
  prompt: [{ type: "text", text: "读一下入口文件" }],
});
console.log(result.stopReason); // end_turn / cancelled / ...
```

> 具体导出名以官方 SDK 为准；这里只表达调用顺序。不要把示例里的 `protocolVersion: 1` 写死成「永远 1」——应当从宿主支持的版本列表里取最新，并在响应不匹配时关闭。

### 8.2 更新投影

```ts
function project(sessionId: string, u: SessionUpdate): RuntimeEvent[] {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return [{ kind: "message", role: "agent", messageId: u.messageId, text: u.content.text, chunk: true }];
    case "agent_thought_chunk":
      return [{ kind: "thought", messageId: u.messageId, text: u.content.text, chunk: true }];
    case "tool_call":
    case "tool_call_update":
      return [{ kind: "tool", toolCallId: u.toolCallId, title: u.title, toolKind: u.kind,
                status: u.status, content: u.content, locations: u.locations,
                rawInput: u.rawInput, rawOutput: u.rawOutput }];
    case "plan":
    case "plan_update":
      return [{ kind: "plan", planId: u.planId, entries: u.entries }];
    case "state_update":
      return [{ kind: "state", sessionId, state: u.state, stopReason: u.stopReason, background: u.background }];
    case "usage_update":
      return [{ kind: "usage", sessionId, used: u.used, size: u.size, cost: u.cost }];
    case "notice":
      return [{ kind: "notice", sessionId, level: u.level, message: u.message }];
    case "replay_complete":
      return [{ kind: "replay_complete", sessionId }];
    default:
      return [{ kind: "unknown", method: u.sessionUpdate, payload: u }];
  }
}
```

### 8.3 权限 fail closed

```ts
function decide(options: PermissionOption[], policy: Policy): PermissionOutcome {
  const allow = options.find(
    (o) => o.kind === "allow_once" || o.kind === "allow_always",
  );
  if (policy.autoApprove && allow) {
    return { outcome: "selected", optionId: allow.optionId };
  }
  return { outcome: "cancelled" }; // 不确定就不批准
}
```

**不要写 `options[0]`**。也不要把「没有 allow 选项」当成「默认允许」；没有 allow 就是拒绝。

### 8.4 统一 AgentAdapter 接口

```ts
interface AgentAdapter {
  readonly id: string;
  capabilities(): AgentCapabilities;
  start(opts: StartOptions): Promise<SessionHandle>;
  prompt(sessionId: string, blocks: ContentBlock[], opts?: PromptOptions): Promise<PromptResult>;
  cancel(sessionId: string): Promise<void>;
  approve(requestId: string, decision: PermissionOutcome): Promise<void>;
  onEvent(cb: (e: RuntimeEvent) => void): () => void;
}
```

ACP Agent、旧 CLI 包装器、远端 A2A Agent 都可以实现这个接口。宿主只依赖 `AgentAdapter`，不依赖任何协议细节。

### 8.5 Proxy 链

```text
Host ── ACP ── proxy-policy ── ACP ── proxy-mcp ── ACP ── Agent
                   │                  │
                   ├─ 加审计/配额      ├─ 注入 MCP server
                   └─ 移除危险能力      └─ 工具白名单
```

每个 proxy 都是一个小 ACP 端点：对前驱像 Agent，对后继像 Client。它可以改能力，但不能改 `protocolVersion`；可以转发未知方法，但不能解释业务语义。

---

## 9. 特殊技术栈实战观察

| 项目 | 栈 | 特殊做法 | 可迁移点 |
| --- | --- | --- | --- |
| **T3 Code** | TypeScript + Effect + Effect Schema | 生成协议类型；`compat.ts` 用 v2 为底、v1 兼容；`AcpOutgoingQueued` 在「已入写队列」时结算；`provider-acp` 拆出 clientPolicy / terminals / elicitation / mcp bridge / runtimeModel / sessionConfig / stderr | 协议适配层要独立于 UI；多版本联合类型是兼容核心；出站写队列要可观测 |
| **OpenMausBot** | TypeScript + Node | 共享 ACP driver + 每 CLI `AcpSupport`；能力矩阵只写真实能力；`node:sqlite` 的 assignments/events/inbox；`level = max(own, inherited)`；权限 fail closed；env 清洗；prompt split | 一个 driver 不要按 CLI 复制；能力矩阵是契约；审计表要 append-only；权限策略要显式继承 |
| **ACP Rust SDK** | Rust | 版本化 connection builder；`Channel`/`Lines`/`ByteStreams`/`Stdio`；`unstable_mcp_over_acp`；conductor 跑 proxy 链 | 传输抽象要可替换；协议版本要进类型；proxy 链是组合而不是 fork |
| **ACP Python SDK** | Python + Pydantic | `acp.schema` 模型；`acp.agent`/`acp.client` async 基类；JSON-RPC 监督；`acp.contrib` 的 session accumulator / permission broker / tool call tracker | Pydantic 适合快速做 schema 对齐；contrib 里都是生产级边角料 |
| **Docker Agent** | Go/容器 | configOptions、持久化会话、安全模式、运行中拒绝修改 | 运行中不可变的配置要显式拒绝，不要静默忽略 |
| **ZeroClaw** | Rust/Node | ACP v1；SQLite；blob 上传到 workspace；10MB/base64 校验；`INVALID_PARAMS` | 大附件要有硬上限；错误码要可区分 |
| **A2A** | Protobuf 为 canonical，多 binding | Agent Card、task state、push notification；JSON-RPC/gRPC/HTTP+JSON | 多传输时 canonical schema 只能有一个；binding 是投影 |
| **AG-UI** | TypeScript/Python | 1.0 冻结 spec；事件族；schema 生成 SDK；middleware | UI 事件要按族分组；冻结 spec 才能做长期兼容 |

---

## 10. 对 nx-kv 的迁移建议

### 10.1 顺序

| 阶段 | 做什么 | 验收 |
| --- | --- | --- |
| **P0** | ACP 客户端 + `RuntimeEvent` + 只读事件投影 | 能连一个 Registry Agent，完成 initialize/session/new/prompt，事件能落到日志/面板 |
| **P1** | 权限 inbox + cancel + session 映射 | 权限 fail closed；取消能返回 `cancelled`；挂起权限能正确回复 |
| **P2** | Registry 安装 + `session/list`/`resume` + 能力矩阵 | 能安装/列出 Agent；不支持的操作不显示；断线能恢复 |
| **P3** | 多 Agent 网关 + SSE/WS + token/auth | 一个宿主多 Agent；远程访问有鉴权；stdout 只跑协议 |
| **P4** | acp-tck + 黄金转录 + 多端瘦客户端 | CI 过 TCK；v1/v2 矩阵通过；移动/桌面只渲染事件 |

### 10.2 Action 契约建议

```text
agent list
agent install <registry-id>
agent session new --agent <id> --cwd <abs>
agent prompt --session <id> --file <prompt.md>
agent cancel --session <id>
agent approve --request <id> --decision allow_once|allow_always|reject_once|reject_always
agent session list --agent <id>
agent session resume --session <id>
agent session close --session <id>
```

每条 action 同时声明 CLI 与 HTTP，沿用 nx-kv 的「一条 action 三端同源」不变量。不要把 ACP 方法直接暴露成 CLI；先做领域动作，再映射到 ACP。

### 10.3 状态与事件

- 新表 `agent_sessions`：hostSessionId、agentId、acpSessionId、cwd、title、status、lastUpdate。
- 新表 `agent_events`：append-only，存 `RuntimeEvent` + `raw`；按 sessionId 索引。
- 新表 `agent_permissions`：requestId、sessionId、toolCallId、options、decision、decidedAt；未决状态可查。
- 新表 `agent_installs`：agentId、version、distribution、sha256、installedAt、source。
- 幂等：v2 用 `idempotencyKey`；v1 用 hostTurnId 去重；重试不重复插入用户消息。

### 10.4 安全

- 宿主默认只绑 `127.0.0.1`；`serve` 目前没有 `--host`，也没有 token/SSE。要远程访问，先补 token + TLS + 显式 host 开关，再谈多端。
- Agent 子进程环境要清洗：provider key、workspace token、控制面 token 一律移除；只传 Agent 自己需要的变量。
- 权限只认 `kind`，不认顺序；未决权限要有超时与取消；取消时回复 `cancelled`。
- Registry 安装校验 SHA-256；没有校验要在 UI 上明示。
- Agent 永远跑在宿主机器；远程客户端不拿文件系统、不拿 provider 凭据、不拿机器状态。

### 10.5 不要做的事

- 不要先做 ACP Agent 侧。nx-kv 的当下价值是「宿主/编排」，不是「再做一个编码 Agent」。
- 不要用 ACP 替代 MCP。工具发现、资源、prompt 模板仍归 MCP。
- 不要自研第六种协议。ACP + MCP + A2A + AG-UI 已经覆盖四个边界。
- 不要把 `session/update` 原样透传给前端。先投影成 RuntimeEvent，否则前端会被协议版本绑死。
- 不要在没有 TCK/黄金转录的情况下宣布「兼容 ACP」。

---

## 11. 常见坑（带时间/版本）

| 时间 / 版本 | 坑 | 后果 | 正确做法 |
| --- | --- | --- | --- |
| 2025-08-27 | 把 IBM ACP 当成 Agent Client Protocol | 按 REST/agent-to-agent 去设计，完全不兼容 Zed ACP | 先确认是 Agent Client Protocol；IBM 那个已并入 A2A |
| 2026-11 | 把 ACP v2 当稳定版 | 按 draft 行为写死，Agent 一升级就断 | v1 是 stable；v2 是 draft/preview；只信 `initialize` |
| 2026-11 | 从 SDK/crate 版本推断 wire 版本 | TS SDK 2.6.0、Rust v5 与 wire 版本无关 | 只看 `initialize.protocolVersion` |
| 2026-11 | 等 `turn/completed` | ACP 没有这个方法，永远等不到 | `session/prompt` 的 `stopReason` 是完成；v2 等 `state_update.idle` |
| 2026-11 | 把 v2 `session/prompt` 响应当最终结果 | 工作可能刚开始，UI 提前结束 | 响应只是 accepted；等 idle |
| 2026-11 | 把 `session/load` 重放当新消息 | 历史重复/错序 | 先清空重建；丢弃 `_meta.isReplay` |
| 2026-11 | 权限用 `options[0]` | 某引擎默认放行 | 只认 `allow_*` kind；fail closed |
| 2026-11 | `session/close` 返回 `-32002` 当失败 | 幂等关闭被误报 | 已关闭按成功处理 |
| 2026-11 | `session/cancel` 后不回复挂起权限 | Agent 侧一直等 | 用 `outcome: "cancelled"` 回复 |
| 2026-11 | 把日志打到 stdout | JSON-RPC 行解析失败 | 日志一律 stderr |
| 2026-11 | 用 JSON-RPC batch | ACP 不支持 batch | 一行一个请求 |
| 2026-11 | 请求 ID 用 null / 等待期间复用 | 响应错配、随机挂起 | string/int；每发送方独立；等待期间不复用 |
| 2026-11 | 对 text-only Agent 发图片 | 协议错误或静默丢弃 | 按 `promptCapabilities` 降级 |
| 2026-11 | 宣告不支持的能力 | UI 点了没反应 | 能力矩阵只写真实能力 |
| 2026-11 | 硬编码 config option id | 换 Agent 就失效 | 从 `configOptions` 读；保留未知 id |
| 2026-11 | 以为 ACP 有账号隔离 | 多实例共用同一个账号 | 用 Agent 自己的配置或 `HOME` 隔离 |
| 2026-11 | 以为 ACP 能回滚对话 | checkpoint 回滚后对话错位 | 新 session + 重发保留上下文 |
| 2026-11 | 以为 ACP 有子 Agent lineage | 多 Agent 委派无法通用展示 | 接受 Agent-specific；不要伪造标准 |
| 2026-11 | 远程客户端想替代宿主 FS/凭据 | 文件读不到、登录态丢失 | Agent 永远跑宿主；远程只做瘦客户端 |
| 2026-11 | 安装 Registry Agent 不看 license/SHA | 供应链风险 | 审来源；有 SHA-256 必校验 |
| 2026-11 | Codex 开 MCP 后仍指望 `--output-schema` | 输出结构不生效 | 这是引擎特定行为；用 Agent 自己的结构化输出能力 |
| 2026-11 | Docker Agent 运行中改配置 | 被拒绝或静默忽略 | 运行中不可变；先停再改 |
| 2026-11 | ZeroClaw 传 >10MB blob | `INVALID_PARAMS` | 分片/压缩/外链；遵守上限 |
| 2026-11 | T3 Claude 默认 v2 出问题 | 以为协议坏了 | `CLAUDE_AGENT_ACP_EXPERIMENTAL_V2=0` 回退 v1 |
| 2026-11 | 把 AG-UI 当 Agent 控制协议 | 控制不了 Agent | AG-UI 只做 UI 事件流 |
| 2026-11 | 把 A2A 当编辑器会话协议 | 没有 prompt/update 语义 | A2A 只做 Agent 间任务 |
| 2026-11 | 把 OpenClaw WS 当模型协议 | 控制面/模型面混淆 | 控制面归控制面 |

---

## 12. 参考资料

### 12.1 ACP 官方

- 协议 schema：https://agentclientprotocol.com/protocol/schema
- 初始化：https://agentclientprotocol.com/protocol/initialization
- 会话建立：https://agentclientprotocol.com/protocol/session-setup
- 一轮 prompt：https://agentclientprotocol.com/protocol/prompt-turn
- 内容块：https://agentclientprotocol.com/protocol/content
- 工具调用：https://agentclientprotocol.com/protocol/tool-calls
- 会话配置：https://agentclientprotocol.com/protocol/session-config-options
- 认证：https://agentclientprotocol.com/protocol/authentication
- 传输：https://agentclientprotocol.com/protocol/transports
- 扩展：https://agentclientprotocol.com/protocol/extensibility
- 终端：https://agentclientprotocol.com/protocol/terminals
- 会话列表：https://agentclientprotocol.com/protocol/session-list
- v2 草案总览：https://agentclientprotocol.com/protocol/v2/draft/overview
- v2 prompt 生命周期：https://agentclientprotocol.com/protocol/v2/draft/prompt-lifecycle
- v2 会话建立：https://agentclientprotocol.com/protocol/v2/draft/session-setup
- Registry：https://agentclientprotocol.com/registry
- Registry 索引：https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json

### 12.2 ACP SDK / 仓库

- GitHub org：https://github.com/agentclientprotocol
- Spec/Rust：https://github.com/agentclientprotocol/agent-client-protocol
- TypeScript SDK：https://github.com/agentclientprotocol/typescript-sdk
- Python SDK：https://github.com/agentclientprotocol/python-sdk
- Rust SDK：https://github.com/agentclientprotocol/rust-sdk
- Registry：https://github.com/agentclientprotocol/registry
- TCK：https://github.com/agentclientprotocol/acp-tck
- Claude 包装器：https://github.com/agentclientprotocol/claude-agent-acp
- Codex 包装器：https://github.com/agentclientprotocol/codex-acp
- HTTP 传输：https://github.com/agentclientprotocol/agent-client-protocol-http
- RMCP 桥：https://github.com/agentclientprotocol/agent-client-protocol-rmcp
- Conductor：https://github.com/agentclientprotocol/agent-client-protocol-conductor
- Rust schema crate：https://crates.io/crates/agent-client-protocol-schema/1.5.0
- TypeScript SDK 文档：https://agentclientprotocol.github.io/typescript-sdk/
- Python SDK 文档：https://agentclientprotocol.github.io/python-sdk/
- Rust SDK 文档：https://agentclientprotocol.github.io/rust-sdk/print.html

### 12.3 相邻协议

- MCP 规范：https://github.com/modelcontextprotocol/modelcontextprotocol
- MCP 生命周期：https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
- A2A：https://github.com/a2aproject/A2A
- A2A 规范：https://a2a-protocol.org/latest/specification/
- AG-UI：https://github.com/ag-ui-protocol/ag-ui
- AG-UI 文档：https://docs.ag-ui.com/introduction
- AG-UI 规范：https://docs.ag-ui.com/spec

### 12.4 本地实现证据

- T3 `effect-acp` 方法表：`D:\a_other\nxkvrepo\t3code\packages\effect-acp\src\_generated\meta.gen.ts`
- T3 兼容层：`D:\a_other\nxkvrepo\t3code\packages\effect-acp\src\compat.ts`
- T3 协议运行时：`D:\a_other\nxkvrepo\t3code\packages\effect-acp\src\protocol.ts`
- T3 provider 适配：`D:\a_other\nxkvrepo\t3code\packages\provider-acp\src\server\*.ts`
- T3 Registry 适配：`D:\a_other\nxkvrepo\t3code\packages\provider-acp-registry\src\*.ts`
- T3 ACP 文档：`D:\a_other\nxkvrepo\t3code\docs\user\providers-acp.md`
- OpenMausBot ACP 核心：`D:\a_other\nxkvrepo\openmausbot\server\drivers\acp\core.ts`
- OpenMausBot 能力矩阵：`D:\a_other\nxkvrepo\openmausbot\server\drivers\acp\capabilities.ts`
- OpenMausBot 自定义 ACP 文档：`D:\a_other\nxkvrepo\openmausbot\apps\docs\content\docs\providers\custom-acp.mdx`
- OpenMausBot runtime contract：`D:\a_other\nxkvrepo\openmausbot\docs\runtime-contract.md`

### 12.5 版本快照

- ACP 官方 stable：**v1**
- ACP v2：**draft/preview**
- TypeScript SDK：**v2.6.0**（stable v1 默认入口；v2 experimental）
- Rust SDK：**v5**
- Rust schema crate：**1.5.0**
- AG-UI：**1.0**（冻结 spec）
- A2A：**1.0.0**
- T3 `effect-acp`：`PROTOCOL_VERSION = 2`（preview，含实现扩展）
- OpenMausBot：ACP 驱动按 v1/v2 协商，含自定义 ACP 支持

---

## 13. 附录：ACP 方法表（按方向）

### 13.1 Client → Agent

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `initialize` | v1/v2 | 协商版本、能力、认证方式 |
| `authenticate` | v1 | 用 `methodId` 登录 |
| `logout` | v1 | 登出 |
| `auth/login` | v2 | 用 `methodId` 登录 |
| `auth/logout` | v2 | 登出 |
| `session/new` | v1/v2 | 新建会话，传 `cwd` + `mcpServers` |
| `session/load` | v1 | 恢复并重放历史 |
| `session/resume` | v2 | 恢复，可选 `replayFrom` |
| `session/list` | v2 | 游标分页列会话 |
| `session/close` | v2 | 关闭会话，幂等 |
| `session/delete` | v2 | 删除会话 |
| `session/fork` | v2 | 分叉会话 |
| `session/prompt` | v1/v2 | 发一轮 prompt |
| `session/cancel` | v1/v2 | 取消当前轮（通知） |
| `session/set_mode` | v1 | 旧模式切换 |
| `session/set_config_option` | v1/v2 | 设置 config option |
| `mcp/message` | v2 | MCP over ACP 消息 |
| `providers/list` / `providers/set` / `providers/disable` | v2/实现扩展 | 模型 provider 管理 |
| `proxy/initialize` / `proxy/successor` | proxy | 代理链初始化与后继连接 |
| `_` 前缀方法 | 扩展 | 自定义方法 |

### 13.2 Agent → Client

| 方法 | 版本 | 说明 |
| --- | --- | --- |
| `session/update` | v1/v2 | 流式事件（通知） |
| `session/request_permission` | v1/v2 | 权限请求（请求，必须回复） |
| `fs/read_text_file` | v1/v2 | 读文件 |
| `fs/write_text_file` | v1/v2 | 写文件 |
| `terminal/create` | v1/v2 | 建终端 |
| `terminal/output` | v1/v2 | 读终端输出 |
| `terminal/wait_for_exit` | v1/v2 | 等退出 |
| `terminal/kill` | v1/v2 | 杀进程 |
| `terminal/release` | v1/v2 | 释放终端 |
| `elicitation/create` | v2 | 表单式提问 |
| `elicitation/complete` | v2 | 表单完成 |
| `mcp/connect` / `mcp/message` / `mcp/disconnect` | v2 | MCP over ACP 连接管理 |
| `$/cancel_request` | v2 | 取消未完成请求 |

> 表中的「v2/实现扩展」表示：某些方法在官方 v2 草案里有，某些是具体客户端（如 T3）扩展出来的。落地前先看对方 `initialize` 的能力声明与实际方法表，不要按本文表格硬编码。
