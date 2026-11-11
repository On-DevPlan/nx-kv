# #174 · 按 server-cli-web 模板形态 TS 重构 nx-kv（阶段一：骨架落地）

## 任务

领取自 nx 项目组 #174：先按 sl-git-standard 做快照，再按 `nx-nx/templates/server-cli-web` 模板形态用 TS 完全重构。

## 总量与分期

现状：src 33k 行 JS（core 7.9k + modules 24.1k + runtime 1k + shared 1.2k）+ web 前端 26.5k 行 JSX + 测试 17.8k 行；166 条 action / 351 个 flag / 12 个模块。模板要求：@action+zod 单通道、一条 action 一个文件、IoC 容器、codegen（manifest / typed client / cli-tree）、routes/pages 自动发现、strict TS。

**一次性大爆炸重构不可行也不负责**（60k+ 行、活跃在用的工具）。按模板自身的迁移先例（「两条通道并存」）分期：

- **本阶段（本次交付）**：骨架完全到位——模板全部 runtime/codegen/工具链 strict TS 落地；双通道兼容（legacy flags-table 与新 @action+zod 并存，CliApp/ApiRouter/Registry/CLI help 全部双通道）；`system` 模块整体迁移为模板形态参考实现；全部门禁绿、166 条 action 行为零回归。
- **后续阶段**（每模块一个任务）：其余 11 模块逐个迁移；服务层逐文件类型化；前端 routes/pages/shells 形态重构（工作台范式是否按模板改，需用户裁决——当前前端是 FlexLayout 工作台，与模板页面树是不同 UX 范式）。

## 本阶段改动清单

1. 工具链：`tsconfig.{base,node,web}.json`、`vite.config.ts`、package.json（zod / typescript / tsx / typescript-eslint；gen·typecheck·dev·build·test 脚本）、`bin/nx-kv.mjs`（tsx 直跑源码，保住「改码即生效」）
2. core：errors / paths / command-table / config / serve-port / open → strict TS
3. runtime 全新模板形态（TS）：types/module + action-base + action-decorator（@action）+ zod-bridge + registry（Registry 类双通道）+ spec（legacy 语义逐字保留 + zod usage）+ cli（CliApp 双通道）+ api（ApiRouter：字面量优先排序、stream 透传、CORS 放行策略保留——模板的跨站拒绝会复活 #57 的坑）+ server + cors + help + codegen
4. `modules/system` 参考迁移：index.ts（ModuleBase）+ schemas.ts + actions/*.ts（bootstrap / health / routes）+ routes.ts（纯逻辑）+ _manifest.generated.ts
5. scripts：gen-actions.mjs / gen-api-client.mjs / dev.mjs（vite+serve 一键）
6. eslint：typescript-eslint 接入 TS 文件，分层规则扩展到 .ts
7. tests：registry.test.mjs 兼容 index.ts；新增 api-client 新鲜度对账；全套门禁跑绿
8. CHANGELOG + 版本 0.47.0 + commit + push origin

## 关键决策（偏离模板处，均有理由）

| 偏离 | 理由 |
| --- | --- |
| bin 直跑源码（tsx 注册）而非 dist | 用户全局 `nx-kv wait` 是活工作流，dist 陈旧=静默跑旧代码 |
| serve/help/version 暂留 runtime 内建 | help/version 需要注册表与命令表（模块 import runtime 会成环）；serve 需 localtask 面板挂载。迁入 platform 模块列入后续阶段 |
| ApiRouter 不做跨站 Origin 拒绝 | nx-kv #57 的明确决策：内网穿透场景同源请求带隧道 Origin，拒绝即断真实用户 |
| 错误类沿用 AppError（非 NxError） | 家族内已约定错误文本契约；改名零收益 |
| z.unknown → 'raw'（透传，不 JSON.parse） | legacy 'raw' flag 的既有语义（scope 可见域靠它），与模板 'json' 有别 |

## 验收门禁

`pnpm lint && pnpm typecheck && pnpm build && pnpm test:smoke && pnpm test:unit` 全绿；smoke 覆盖 CLI 全链路 + HTTP API + 静态页（既有 7 组用例）；registry.test.mjs 的结构对账全部通过。
