# Changelog

本文件记录对外可见的变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-09-16

首个版本。KV 清单（todo）的 CLI + Web 面板，对接 GoFrame KV 后端（默认 `47.110.80.47:8988`）。

### Added

- **清单 CRUD**：`todo list / get / add / update / remove`，覆盖四把 key
  （`todo:open` / `todo:done` / `todo:freeze` / `todo:topics`）。
- **状态流转**：`todo done / freeze / unfreeze`，以及 `todo archive` 把旧完成记录归档到冷 key。
- **主题**：`topic list / add / remove`（带各状态任务数）。
- **主题提示词**：`prompt set / get / remove` —— 存 `todo:prompt:<topic>`，
  让 agent「拿任务即拿上下文」。
- **工作空间完整 CRUD**：`group list / get / add / update / remove`（声明为集合资源，
  五操作齐备且两端可达）+ `group current / use / members`。
  切换只改本机配置；解散有前置条件（组内须无 KV），且**不能解散当前使用中的空间**。
- **面板**：「已完成」列可一键**归档旧记录**（移到 `todo:done:cold:<日期>`）；
  任一列超过 15 条自动折叠，避免历史记录把待办挤出视野。
- **认证**：`auth login / logout / status / me`。token 存 `~/.nx-kv/config.json`，
  密码交互式隐藏输入、**不落盘**。
- **Web 面板**：`nx-kv serve`，三页（清单 / 工作空间 / 登录），无 emoji、单色、
  响应式、状态持久化、路径与标识点击即复制。
- **内置 skill**：`nx-kv skill install` 把 `assets/nx-kv/` 装到 `~/.claude/skills`，
  供 agent 学会用这个 CLI 领任务。
- **自省命令**：`routes`（命令 ↔ 路由对照 + `--http` 反查）、`bootstrap`（一次拿齐上下文）、
  `health`。

### 架构

沿用 server-cli-web 标准骨架：**一条 action 声明同时驱动 CLI、HTTP、面板**，
三端不可能分叉；分层由 eslint `no-restricted-imports` 强制；
`tests/unit/registry.test.mjs` 断言模块目录 ↔ 后端注册表 ↔ 前端视图注册表三方对齐。

### 安全

- 后端信封是 `{code,message,data}` 且 **HTTP 恒为 200**，成败看 `code` —— 判断收在一处。
- `remove` 等变更操作**按数组下标定位**，不按 id 批量过滤。
- 跨站写请求被 Origin 校验拒绝；静态服务做 resolve 后前缀校验。

### 已知问题

- **`id` 不是唯一键**：分配只扫「待办 + 冻结」，任务完成、待办清空后 id 会被复用，
  于是 `todo:done` 里会积累同 id 的多条（实测 68 条里有 7 条 id=29）。
  因此按 id 变更**必须消歧**：`--topic` 收窄、或 `--pick <n>` 按编号选，
  命中多条时工具**拒绝执行**而不是猜一条。
