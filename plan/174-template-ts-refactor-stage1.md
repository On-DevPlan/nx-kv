# #174 · 按 server-cli-web 模板形态 TS 重构 nx-kv

## 任务

领取自 nx 项目组 #174：先按 sl-git-standard 做快照，再按 `nx-nx/templates/server-cli-web`
模板形态用 TS 完全重构；后续用户补充要求：**action 注册也完全重构**（不留 legacy 通道做主体）。

## 总量与分期

现状（迁移前）：src 33k 行 JS（core 7.9k + modules 24.1k + runtime 1k + shared 1.2k）+
web 前端 26.5k 行 JSX + 测试 17.8k 行；166 条 action / 351 个 flag / 12 个模块。

一次性大爆炸（含服务层与前端逐行类型化）超出单轮可承受，但**用户明确要求全量**，
故按「骨架 → action 注册 → 服务层/前端」的顺序把可交付的做满，逐轮推进。

## 已完成（本轮）

1. **快照**：`.claude/repo/project/2026-11-11-2f56316/`（sl-git-standard D01；
   脚本自带的 `git clone <sha>` 在本机 git 上不可用，改为等价的手工浅克隆 + 同构元数据）。
2. **模板骨架（runtime / codegen / 工具链）**：`src/runtime/` 全套 strict TS——
   `@action` 装饰器 + zod 契约、IoC 容器（`Container` + `DependencyMap`）、`Registry` 类、
   `CliApp` / `ApiRouter` / `PanelServer`、`zod-bridge`（CLI/HTTP 共用的归一化 + 校验）、
   `codegen`（前端 typed client + CLI 树快照）；三份 tsconfig、`vite.config.ts`、
   `pnpm gen / typecheck / dev`。
3. **action 注册完全重构**：12 个模块全部改成模板形态——`index.ts`（ModuleBase 子类）
   + `schemas.ts`（zod 契约）+ `actions/<名>.ts`（一条 action 一个文件）
   + `actions/_manifest.generated.ts`（codegen 产物，模块 index 零手工列举）。
   154 条业务 action 全部迁完，legacy flags 表通道只剩平台命令（serve / help / version）。
   迁移由一次性 codemod（`.tool/migrate-module.mjs`，TS AST 精确抽取）执行，
   流水线带**产物校验**（曾经出现过 codemod 崩了但后续门禁在 legacy 树上跑出假绿）。
4. **行为零回归**：typecheck 0 错误 / lint 0 错误 / 单测 903 / 冒烟 194 全绿。

## 剩余（后续阶段）

- **服务层类型化**：modules/core 下仍是 .js（allowJs 过渡，类型不检查）。
  迁移体里的 `any` 集中在「服务层绑定」与「局部变量」两类，随服务层毕业逐文件收紧。
- **前端 TS 化 + routes/pages 形态**：前端 26.5k 行仍是 .jsx（FlexLayout 工作台范式）。
  是否改造成模板的 react-router 页面树是**产品决策**（会改变面板交互范式），需用户裁决。
- **serve / help / version 迁入 platform 模块**：help/version 要看注册表全集（模块 import
  runtime 会成环），serve 要挂 localtask 面板占位——迁完即可删除 legacy 通道。
- **CLI 别名**：legacy 的 `cli: [[a,b],[c,d]]`（多路径别名）已保留（`CliPaths` 类型），
  但模板原始类型只写单路径——这是为兼容既有行为做的扩展。

## 偏离模板之处（含理由）

| 偏离 | 理由 |
| --- | --- |
| bin `bin/cli.mjs` → `bin/kv.mjs`，且直跑 TS 源码（tsx 注册） | 全局 `nx-kv` 是活工作流；跑 dist 会出现「改了忘 build → 静默跑旧代码」 |
| 跨域不做「Origin 主机名必须是本机」的拒绝 | 任务 #57 的明确裁决；模板自带的跨站拒绝会把内网穿透的真实用户挡在门外 |
| 错误类沿用 `AppError`（非模板的 `NxError`） | 家族内既有约定与错误文本契约 |
| zod kind 用 `raw`（非模板的 `json`） | 继承 legacy flags 的既有语义（原样透传，不 JSON.parse 字符串） |
| flag 的 hint 迁进 `.describe()`，用法串读它 | 模板的类型只留 kind，help 会退化成 `--x <string>`；迁移不该丢 help 的可读性 |
| 迁移体的入参用 `any` | 契约由入口的 zod schema 把关；服务层类型化后再逐条收紧 |

## 验收门禁

`pnpm test` 全绿：lint + typecheck（tsc -b，strict）+ build + smoke 194/194 + unit 903/903。
