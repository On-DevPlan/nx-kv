# nx-kv 命令参考

> 归属主文档 [[nx-kv]]。当且仅当要执行具体命令或校验输出时加载。

## 全局

| 命令 | 说明 |
| --- | --- |
| `nx-kv serve [--port 7820] [--no-open]` | 起 Web 面板（`--no-open` 给自动化） |
| `nx-kv help [模块]` | 命令表（由声明生成）；`help todo` / `help repo` 均可 |
| `nx-kv routes [--module M] [--http "METHOD /api/x"]` | 命令 ↔ 路由对照与反查 |
| `nx-kv bootstrap --json` | 一次拿齐：版本 / 登录态 / 工作空间 / 命令表 |
| `nx-kv health` | 本机配置 + 后端可达性 |
| `--config <path>` | 本次运行覆盖配置文件（默认 `~/.nx-kv/config.json`） |

## 认证

```bash
nx-kv auth login <email> [--password P] [--baseUrl URL]
nx-kv auth logout
nx-kv auth status          # 离线可读，不请求后端
nx-kv auth me              # 向后端确认 token 仍有效
```

`--password` 省略时进入**隐藏式交互输入**。token 存本机配置，**密码不落盘**。

## 清单

```bash
nx-kv todo list [--topic T] [--status open|done|freeze|all] [--group N] [--json]
nx-kv todo get <id> [--topic T] [--pick N] [--group N]
nx-kv todo add <text> --topic T [--group N]
nx-kv todo update <id> [--topic T] [--text T] [--note N] [--match-topic T] [--pick N]
nx-kv todo remove <id> [--topic T] [--pick N]
nx-kv todo done <id> [--result "完成结果"] [--topic T] [--pick N]
nx-kv todo freeze <id> [--topic T] [--pick N]
nx-kv todo unfreeze <id> [--topic T] [--pick N]
nx-kv todo archive [--before 2026-08-01] [--group N]
```

**CRUD 五操作齐备**（`list` / `get` / `add` / `update` / `remove`），
且每条都能从 CLI 与 HTTP 两端调用——`tests/unit/registry.test.mjs` 有断言。

## 主题与提示词

```bash
nx-kv topic list                      # 含各状态任务数
nx-kv topic add <name>
nx-kv topic remove <name>             # 移出候选；仍有任务在用时会提示条数

nx-kv prompt set <topic> "<上下文>"
nx-kv prompt get <topic> [--json]     # --json → {topic,prompt,hasPrompt}
nx-kv prompt remove <topic>
```

## 工作空间

```bash
nx-kv group list
nx-kv group current
nx-kv group use <id|name|default>     # 别名：group switch
```

## 退出码与错误码

| 情形 | exit | code |
| --- | --- | --- |
| 成功 | 0 | — |
| 参数缺失/非法 | 1 | `INVALID_INPUT` |
| 未登录 / token 失效 | 1 | `INVALID_INPUT`（文本含「未登录」） |
| 目标不存在 | 1 | `NOT_FOUND` |
| **同 id 多条需消歧** | 1 | `CONFLICT` |
| 状态已是目标（已完成/已冻结） | 1 | `CONFLICT` |
| 后端不可达 / 返回业务错误 | 1 | `EXTERNAL` |

**脚本里只看退出码判定成败**，不要去 parse 人类文案（错误码供需要分支时用）。

## 数据模型

```jsonc
// todo:open / todo:done / todo:freeze 里的一条
{
  "id": 23,
  "topic": "go",
  "text": "watchkv",
  "createdAt": "2026-08-14T19:04:56.028788",   // Dart 风格：本地时间、无时区
  "doneAt": "",                                 // 完成时写 RFC3339 带偏移
  "note": "",                                   // done --result 写这里
  "frozenAt": ""                                // 冻结时写 Dart 风格
}
```

两种时间格式在同一份数据里并存是**既成事实**，nx-kv 按字段各自的约定写，不做统一。

## 避坑

| 坑 | 后果 | 注意 |
| --- | --- | --- |
| 按 id 直接改 done 里的条目 | 报「命中 N 条」——这是保护，不是 bug | 用 `--topic` 或 `--pick` |
| `done <id>` 传非数字 | exit 1 | 从 `--json` 输出里取 `.id` |
| `add` 漏 `--topic` | exit 1，`--topic 必填` | 必带 |
| 未登录就调 todo | exit 1「未登录」 | 先 `auth login` |
| 以为切换 group 会改服务端 | 只改本机配置 | 数据一直在服务端，切换只是换个 groupId |
