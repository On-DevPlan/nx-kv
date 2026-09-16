# nx-kv

KV 清单（todo）管理中枢。一个 `npx` 命令起一个 Web 面板，同时提供同构 CLI——
**面板上的每个按钮，底层都是同一条 CLI 命令**，输出 `--json` 即可被任何 agent 直接消费。

对接 GoFrame KV 后端（默认 `http://47.110.80.47:8988`），
数据落在**四把 key** 上：`todo:open` / `todo:done` / `todo:freeze` / `todo:topics`。

## 快速开始

```bash
pnpm install

# 开发模式（需要两个终端）
pnpm run dev:serve    # 终端 1：后端 :7820
pnpm run dev          # 终端 2：Vite :5181，/api 代理到 7820

# 生产模式
pnpm start            # 构建 + 起面板

# 校验：lint + 构建 + 71 项端到端冒烟 + 31 项单元/一致性测试
pnpm test
```

冒烟测试**对着假后端跑**（`tests/fake-backend.mjs`），不会碰生产服务器上的真实数据。

## 登录

```bash
nx-kv auth login <email>          # 交互式隐藏输入密码
nx-kv auth status                 # 看登录态（离线可读）
```

token 存 `~/.nx-kv/config.json`，**密码不落盘**。配置文件路径可用 `NX_KV_CONFIG`
环境变量或 `--config` 覆盖。

## 常用命令

```bash
# 取某个主题的全部待办（agent 首选）
nx-kv todo list --status open --topic go --json
nx-kv prompt get go --json                    # 顺带拿该主题的上下文提示词

# 增删改查
nx-kv todo add --topic go "把 watchkv 的告警接进来"
nx-kv todo get 29 --topic go
nx-kv todo update 29 --text "改过的内容"
nx-kv todo remove 29 --topic go

# 状态流转
nx-kv todo done 29 --result "已接入，commit abc123"
nx-kv todo freeze 29        # 次级需求停放，id 保留
nx-kv todo unfreeze 29      # 解冻回待办（id 撞车时自动换新 id）
nx-kv todo archive          # 完成记录归档到冷 key（默认 30 天前）

# 主题 / 工作空间
nx-kv topic list
nx-kv group list
nx-kv group use shared      # 切换工作空间（只改本机配置）
nx-kv group add 新空间 --description "..."   # 建
nx-kv group update 507 --name 改个名          # 改
nx-kv group remove 507                        # 解散（组内须无 KV）
nx-kv group members 24                        # 成员
```

完整命令表由 action 声明自动生成：`nx-kv help`。
命令与 HTTP 端点互相可查：`nx-kv routes`，反查用 `nx-kv routes --http "POST /api/todo"`。

## ⚠️ id 不是唯一键

id 分配只扫「待办 + 冻结」，所以任务完成、待办清空后 **id 会被复用**——
`todo:done` 里因此会积累同 id 的多条（实测 68 条里有 7 条 id=29）。

按 id 变更时工具**拒绝猜**，而是列出候选项让你选：

```
$ nx-kv todo get 29
错误: id=29 命中 7 条，无法确定是哪一条。用 --pick <n> 选择：
  [0] done   qus   2026-08-15T15:09:00.097123  k8s的slb是什么
  [1] done   qus   2026-08-22T10:40:12.469526  专业远控软件...
  ...

$ nx-kv todo get 29 --pick 2      # 按编号选
$ nx-kv todo get 29 --topic fr    # 或按主题收窄
```

## 架构：action 三端同源

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Web 面板     │   │   agent CLI  │   │  HTTP API    │
└───────┬──────┘   └───────┬──────┘   └───────┬──────┘
        └──────────────────┼──────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  action 声明（每个功能域的 index.js）      │
        │  { cli: [...], http: [...], run, render } │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  service 层（唯一业务真相源）              │
        └──────────────────┬───────────────────────┘
                           ▼
        ┌──────────────────────────────────────────┐
        │  core：KV 客户端 / 配置 / 错误 / 存储      │
        └──────────────────────────────────────────┘
```

**一条 action 同时声明 CLI 命令路径与 HTTP 路由**，二者写在同一处，
所以「Web 上能做的，CLI 都能做」是结构保证而非口头约定。

```
src/core/          零业务语义：kvapi(后端客户端) / config(本机配置) / errors / fstree
src/modules/       功能域：system / auth / group / todo / bundled
src/runtime/       装配层：registry / spec / cli / api / server
src/web/frontend/  React 壳
assets/nx-kv/      内置 skill（agent 操作手册）
```

分层由 `eslint.config.js` 的 `no-restricted-imports` 强制；
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐。

## 给 agent 用

```bash
nx-kv skill install      # 装到 ~/.claude/skills/nx-kv
```

装好后 agent 就能按 skill 里的 SOP 领任务、读主题上下文、完成后回填结果。

## License

MIT
