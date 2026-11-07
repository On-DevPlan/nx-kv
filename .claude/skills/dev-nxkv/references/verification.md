# 验证规则

本项目只认「跑出来的证据」，不认「应该没问题」。按下面顺序做，汇报时附命令与关键输出。

## 1. 固定检查项（交付前全跑）

```powershell
pnpm lint        # eslint . && node scripts/check-tdz.mjs --all
pnpm test:unit   # node --test tests/unit/*.test.mjs
pnpm test:smoke  # node tests/smoke.mjs（假后端 + 临时配置）
pnpm build       # vite build && node scripts/link-local.mjs --auto
pnpm test        # lint + build + smoke + unit 全量（最终以它为准）
```

- `lint` 自带 TDZ 全量扫描；`check-tdz` 失败等同 lint 失败。
- 只改数据库/schema/migration 时额外跑 `pnpm test:db`。
- 改前端时还要实际打开面板验证（`pnpm dev:serve` 后访问本地端口），必要时用浏览器检查布局与交互。

## 2. 渲染层两层策略

提示词/模板改动必须同时验证两层：

| 层 | 做法 | 证据 |
|---|---|---|
| 保存时 | `validateTemplate()`（`HB.precompile`）在 `setLtSettings` 内执行 | 故意提交坏语法应被拒绝，报错含模板名 + 区块名 |
| 运行期 | 坏模板回落该块内置模板并写 `renderWarnings`，不阻断领取 | 预览/领取载荷里出现 `renderWarnings`，且该块仍有内容 |

不要为了「让测试过」把保存校验绕过；也不要让运行期异常静默吞掉。正常入口保存不了坏模板，运行期回落只服务旧数据/手改库。

## 3. 「真实 localtask get」作为渲染证据

### 先做只读预览

```powershell
node bin/cli.mjs localtask preview --id <id> --cwd <dir>
```

看返回里的 `instruction`、`segments`、`switches`、`renderWarnings`：

- 五个区块按 `context → attachment → timecheck → ack → getloop` 顺序出现；每个区块用的是它自己的当前生效模板；
- 该有的项目/组/附件/目标内容都在，且 `<nx-kv>` 根标签正确；
- `task.text` 没有被模板二次解析；
- 无 `renderWarnings`（或告警是你预期并已解释的）。

`--text` 只适合草稿预览：它不读库存任务，绕开附件同步/任务级目标等真实路径，**不能作为最终交付证据**。

### 再做一次真实领取

```powershell
node bin/cli.mjs localtask get --cwd <dir>
```

- 在**可安全领取**的队列/任务上做；不要在用户正在跑的生产队列里制造假领取。
- 没有安全任务时，用临时库（见下）建一个队列 + 任务再 `get`，照样能证明同一条渲染链。
- 证据看返回载荷：`instruction` 完整、区块顺序正确、`coversBody` 合理、`renderWarnings` 不存在、`task.text` 逐字保留。
- 如果确实无法真实领取，明确说明「只做了 preview」，不要把 preview 冒充 get 证据。

## 4. 测试隔离（硬要求）

- 单测统一用 `tests/support/test-store.mjs` 造临时目录/库；它带有「必须位于 tmp 下」的断言，禁止指向 `C:\Users\<user>\.nx-kv\nxkv.db`。
- 需要手跑 CLI 验证时，显式设置临时库路径，例如：

```powershell
$env:NX_KV_DB = Join-Path $env:TEMP ('nxkv-verify-' + [guid]::NewGuid() + '.db')
node bin/cli.mjs db migrate
node bin/cli.mjs ...
```

- 历史事故：测试代码把模板字面量写进真实库，导致用户领取时只看到 `DLV-<id>`。任何「单元测试」都不允许打开默认库。

## 5. 数据库改动验证

1. 改 schema：新增 `src/core/db/schema/00N_*.sql`，在 `migrator.js` 登记版本，**不改 `001.sql` 的已发布语义**。
2. 先演练：

```powershell
node bin/cli.mjs db backup
node bin/cli.mjs db migrate --dry-run
node bin/cli.mjs db status
```

3. 正式迁移后：

```powershell
node bin/cli.mjs db verify
```

`verify` 覆盖版本、行数、状态分布、正文哈希、`seq` 对应、外键与 `PRAGMA integrity_check`；失败必须定位到具体表/行，不能只看「退出码 0」。

4. 迁移兼容真实历史数据：旧 JSON、旧 key、软删行、跨队列依赖都要有回归用例（参考 `tests/unit/db-migrate-from-json.test.mjs`、`db-review-regressions.test.mjs`）。

## 6. 汇报格式

汇报至少包含：

- 改了哪些文件（路径 + 一句话作用）；
- 跑了哪些命令、实际结果（lint/unit/smoke/build 的具体通过数或失败项）；
- 渲染证据：preview 或真实 get 的关键片段 / `renderWarnings` 状态；
- 数据库：是否备份、是否迁移、`db verify` 结果；
- 未做/做不了的事项与风险，不要用「应该可以」带过。
