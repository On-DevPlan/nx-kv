# pretask 插件：生命周期与扩展指南

> 读者：要在 nx-kv 里**新增一个插件**或**给现有插件加入口 / 页面 / 设置 / 表**的开发者。
> 开发动作用 SOP 见 `dev-nxkv` skill 的 `A13-开发或扩展插件.md`；契约速查见 `B09-插件架构与契约.md`。
> 本文是两者的**完整合并版**：把生命周期每一步「谁做什么、代码在哪、失败怎么查」讲全。
>
> 一句话边界：**插件包自注册（server 清单 + client `registerPlugin` + 自有表），
> nx-kv 只负责生命周期控制与调用。**

---

## 1. 生命周期总览

> 新增插件的标准十步、gettask 专项检查清单与登记点见 §16。

```
packages/*/package.json(nxkv)
        │  ① 发现：gen-plugins 生成 { name, dir }
        ▼
src/modules/plugin/plugins.generated.ts
        │  ② 构建：build-plugins（server 单文件 + client IIFE）
        ▼
packages/*/dist/{server,client}
        │  ③ 加载：registry 按包根相对目录 import server
        ▼
loadPlugins() → NxkvPlugin
        │  ④ 激活：全局开关 → migrateStorage → migrateLegacy
        ▼
entries(ctx) → 入口聚合（可见性 / 排序 / 默认项）
        │  ⑤ 配置：设置页全局开关 / 主题级「新建页行为」
        ▼
用户触发（＋ 新建页 / 新任务 / 下拉选择 / 侧栏条目）
        │  ⑥ 调用：buildDraft / RPC / 插件页面挂载
        ▼
插件执行（api.ctx / host.get / createDraft / 自有表）
        │  ⑦ 落库：草稿 → 任务；插件表；宿主任务队列
        ▼
发布：随 nx-kv 包分发（packages/ 内），npx nx-kv 直接可用
```

| 阶段 | 宿主负责 | 插件负责 |
|---|---|---|
| ① 发现 | 按 `nxkv` 清单生成并加载 | 声明 `nxkv { api, server, client?, style? }` |
| ② 构建 | 提供通用脚本与产物路径 | 提供 `tsconfig.server.json` / `vite.config.ts` |
| ③ 加载 | 校验 id/api/entries/buildDraft | 导出 `definePlugin(...)` 默认对象 |
| ④ 激活 | 全局开关、版本账本、legacy 暂存 | `migrateStorage` / `migrateLegacy` |
| ⑤ 配置 | 入口聚合、可见性、默认项、页面挂载 | 声明入口与页面，读取 `ctx` 自适配 |
| ⑥ 调用 | 调 `buildDraft` / RPC、注入 `PluginClientApi` | 返回草稿、处理 RPC、渲染 UI |
| ⑥' gettask | 聚合 `gettask()` 声明、挂 dock tab、领取时取块 | 声明区块 + `data(taskCtx)` 按任务取数（见 §15） |
| ⑥'' candidates | 聚合 `candidates()`、面板列表 / 正文搜索引用 | 返回稳定 id / path / text 的候选条目（见 §15.6） |
| ⑥''' 任务创建 | 草稿提交后广播 `onTaskCreated` | 把 `draftKey` 数据迁到 `task.id`（见 §15.5） |
| ⑦ 落库 | 草稿写 doc-store、任务提交进队列 | 只写自己的 `plugin_<id>_*` 表 |

---

## 2. 插件包结构

```
packages/plugin-<id>/
  package.json            # 唯一自注册声明
  tsconfig.server.json    # server 类型检查（tsc）+ Vite 打包
  tsconfig.client.json    # client 类型检查（JSX）
  vite.config.ts          # client IIFE（React 走宿主全局）
  src/server/index.ts     # definePlugin(...) 默认导出
  src/server/*.ts         # 自有表 / 纯函数 / 迁移
  src/client/index.tsx    # registerPlugin('<id>', def)
  src/client/*.tsx        # 入口行 / 表单 / 面板页 / 设置页
  src/client/style.css    # 插件自有样式（前缀 .xx-）
```

`package.json` 最小形态（照抄 `packages/plugin-dir-annotate/package.json`）：

```json
{
  "name": "@nx-kv/plugin-<id>",
  "private": true,
  "type": "module",
  "nxkv": {
    "api": "^1",
    "server": "dist/server/index.js",
    "client": "dist/client/client.js",
    "style": "dist/client/style.css"
  },
  "dependencies": { "@nx-kv/plugin-sdk": "workspace:*" },
  "peerDependencies": { "react": "^19.3.0", "react-dom": "^19.3.0" }
}
```

规则（`scripts/check-plugin-isolation.mjs` 强制）：

| 规则 | 原因 |
|---|---|
| `private: true` | 内置插件不单独发 npm，随 nx-kv 包分发 |
| `dependencies` 只有 SDK | 发布后插件 server 已内联 SDK，运行时无外部依赖 |
| React 只做 peer | client bundle 由宿主注入共享 React |
| `nxkv.server` 必填；声明 client 必须有 `vite.config.ts` | 构建脚本按约定产物 |
| 插件源码只能 import 相对路径 / `node:` / SDK / react | 内部闭合 |
| 表名以 `plugin_<id>_` 开头 | 与宿主表隔离 |

---

## 3. 服务端契约（`definePlugin`）

```ts
export default definePlugin({
  id: 'demo',                 // 不含 : 和 .
  version: '0.1.0',
  api: '^1',
  name: '示例插件',
  description: '一句话说明',
  order: 30,                  // 设置页 / 下拉分组排序
  defaultEnabled: true,
  storageVersion: 1,
  migrateStorage(db, fromVersion) { /* 建/升插件表；返回目标版本 */ },
  migrateLegacy(ctx, kind, payload) { /* 一次性旧数据导入 */ },
  entries(ctx) { /* 返回当前 scope 的入口 */ },
  async buildDraft(ctx, entryId, values) { /* kind=draft 才有 */ },
  rpc: { /* 方法名 camelCase */ },
});
```

| 字段 | 语义 |
|---|---|
| `id` | 插件身份；入口 id 必须是 `<id>:<localId>` |
| `api` | 固定 `^1`；宿主拒绝不兼容版本 |
| `defaultEnabled` | `plugin_state` 缺行时的全局默认 |
| `entries(ctx)` | 入口声明；拿不到定位可返回 `[]` |
| `buildDraft` | 只服务 `kind='draft'`；`panel` 入口请抛错 |
| `gettask(ctx)` | 第二生命周期点：任务页 dock tab + 领取交付区块声明（见 §15） |
| `rpc` | `(ctx, params) => Promise<any>`；方法名 `[A-Za-z][\w]*` |
| `storageVersion` / `migrateStorage` | 插件自有表结构；宿主只记版本号 |
| `migrateLegacy` | 从 `plugin_legacy_data` 取旧数据；成功后宿主删暂存行 |

### 入口模型（`EntryView`）

| 字段 | 说明 |
|---|---|
| `id` | `<pluginId>:<localId>`，稳定不复用 |
| `label` / `description` / `icon` | 下拉与配置页展示 |
| `kind` | `draft`（生成正文）或 `panel`（打开插件页） |
| `order` | 初始排序；用户排序会覆盖 |
| `default` | 插件级默认（仅作主题未配置时的回落；下拉不标「默认」） |
| `builtin` | 内置入口徽标 |
| `slots` / `previewBody` / `values` | 无 form 的 draft 预览与槽位 |
| `ui.row` | 下拉行组件（插件自带）；否则用 `label/icon` |
| `ui.form` | draft 参数页（进插件页面） |
| `ui.panel` + `panel.title` | panel 入口打开的页面 |

**默认入口解析优先级**（宿主 `listEntries`）：

1. 本 scope 显式配置（`plugin_entry_visibility.is_default`）；
2. 插件声明的 `default`（且可见）；
3. 第一个可见草稿入口；
4. 第一个可见入口。

配置项被隐藏时**不生效但保留**，重新勾选可见即恢复。

---

## 4. 客户端契约（`registerPlugin`）

```ts
const definition: PluginUiDefinition = {
  api: '^1',
  components: { 'entry-row': Row, 'entry-form': Form, panel: Panel, settings: Settings },
  pages: {
    panel: { title: '插件页面' },
    'entry-form': { title: '填写参数' },
    settings: { title: '插件设置' },
  },
  sidebar: [{ id: 'settings', label: '插件设置', icon: 'gear', order: 30, page: 'settings' }],
};
window.NxkvPluginHost.registerPlugin('<id>', definition);
```

| 宿主注入能力（`PluginClientApi`） | 说明 |
|---|---|
| `ctx` | 当前 `PretaskContext`（topic / location / 扁平定位） |
| `entry` | 仅入口页面有 |
| `rpc(method, params)` | 调插件自己的 server RPC（自动带 ctx） |
| `host.get(path, params)` | 只允许 `/api/`：context / tree / file / repos… |
| `draft(entryId, values)` | 取插件草稿正文 |
| `createDraft({ body,title }, { submit?, project?, board? })` | 落草稿并打开任务页；组场景可覆盖归属 |
| `navigate` / `closePage` / `toast` | 宿主导航、关页、提示 |

页面路由：`#/plugin/<pluginId>/<pageId>[/<sessionId>]`。
宿主把入口上下文装进 session；插件页面刷新后 session 仍在（内存级）。

样式：插件自带 `style.css` 由宿主按 `nxkv.style` 注入；可复用宿主 CSS 变量（`--ink` / `--line` / `--paper` 等），
但不要依赖宿主具体组件类名（`.rp-page` / `.btn` 是共享外观约定，不是 API）。

---

## 5. 上下文与宿主 HTTP 能力

### `PretaskContext`

| 字段 | 来源 / 口径 |
|---|---|
| `topicKey` / `groupKey` / `repoKey` / `cwd` | 扁平定位；插件页 session 透传 |
| `topic` | 宿主按 DB 补全的 `{ key,name,kind,cwd,repoKey,groupKey,repoName,groupName,repoRoot }` |
| `location` | `{ dirKey, groupId, board, project, taskId }` |
| `kind` | 前端显式声明的页面性质优先（目录页=repo / 组页=group）；未声明才按 DB 推 |

### 宿主 HTTP

| 接口 | 关键参数 | 边界 |
|---|---|---|
| `GET /api/plugins/context` | `topicKey` / `groupKey` / `repoKey` / `cwd` | 只读；返回 topic/repo/group/组内 repos |
| `GET /api/plugins/tree` | `repoKey`、`path`、`showHidden` | 只认已登记 `type='repo'`；拒软链/重目录；最多 500 项 |
| `GET /api/plugins/file` | `repoKey`、`path`、`maxBytes` | realpath 必须留在 repo 根内；默认 256KB / 上限 1MB；二进制不回正文 |

插件缺信息时优先用这些接口自行构造，不要在插件里直接读宿主库或宿主 `src`。

---

## 6. 作用域、配置与触发点

### 6.1 全局生命周期

| 能力 | 入口 | 存储 |
|---|---|---|
| 启用 / 停用插件 | 设置 → 插件；`plugin set --id <id> --enabled false` | `plugin_state` |
| 插件版本 / 加载错误 | 设置页插件行、`plugin list --json` | `plugin_storage_migrations` + 内存 |

### 6.2 主题级「新建页行为」

| 能力 | 命令 | 存储 |
|---|---|---|
| 下拉显示哪些入口 | `plugin set-visibility --scopeKey topic:<key> --entries ...` | `plugin_entry_visibility.visible` |
| 排序 | 同上 `sortOrder` | `plugin_entry_visibility.sort_order` |
| 点「＋ 新建页」默认触发谁 | `plugin set-default --scopeKey topic:<key> [--entryId <id>]` | `plugin_entry_visibility.is_default` |
| 面板配置页 | 新建任务下拉 →「配置新建页行为…」 | 同上 |

scope 可以是 `topic:<key>` / `repo:<key>` / `group:<key>`；优先级 topic > repo > group。

### 6.3 所有「新建」触发点（同一口径）

| 触发点 | 行为 |
|---|---|
| 目录页 / 组页「＋ 新建页」主按钮 | 执行默认入口（面板→插件页；草稿→正文/参数页） |
| 同一按钮的 ▾ 下拉 | 列出可见入口；「配置新建页行为…」进配置页 |
| 左侧栏仓库行「新建页」 | 先确保队列，再执行默认入口 |
| **任务编辑页「新任务」** | 同样执行默认入口（面板入口直接进插件页） |

没有可用入口时统一回落：空白草稿（目录/组 scope）或旧模板预览正文（任务页）。

---

## 7. 存储与迁移

### 7.1 插件自有表

- 表名 `plugin_<id>_*`；列、索引、数据生命周期全由插件负责；
- 只在 `migrateStorage(db, fromVersion)` 里建/升；返回目标版本；
- 宿主在 `plugin_storage_migrations` 记 `(plugin_id, version)`，**不认识插件列**。

```ts
export const STORAGE_VERSION = 1;
export function migrateStorage(db: PluginDb, fromVersion: number): number {
  if (fromVersion < 1) {
    db.exec(`CREATE TABLE IF NOT EXISTS plugin_demo_items (...)`);
  }
  return STORAGE_VERSION;
}
```

### 7.2 旧数据交接

宿主先用 `plugin_legacy_data` 暂存旧内置数据（按 `plugin_id, kind`），插件实现：

```ts
async migrateLegacy(ctx, kind, payload) {
  if (kind === 'templates') importOldRows(ctx.storage, payload);
}
```

导入必须**按业务 id 幂等**（重复激活不重复插入）；成功后宿主删除暂存行。

### 7.3 宿主 schema 版本（只与宿主表变化有关）

| 版本 | 内容 |
|---|---|
| v19 | 建 `plugin_state` / `plugin_entry_visibility` / `plugin_legacy_data` / `plugin_storage_migrations`；旧 `templates` 暂存 |
| v20 | 删 `templates`（内置任务模板迁到插件） |
| v21 | `plugin_entry_visibility.is_default`（scope 级默认入口） |

插件自己的表**不要**写进宿主迁移；只提 `storageVersion`。

---

## 8. 构建、发布与升级

### 8.1 构建

```powershell
pnpm gen:plugins          # 扫描 nxkv 清单 → plugins.generated.ts
pnpm run build:packages   # SDK + 所有插件（自动发现）
```

- server：先 tsc 类型检查，再由 Vite 打成**单文件 ESM**；`@nx-kv/plugin-sdk` 内联，`node:` 外置；
- client：IIFE，`react` / `react-dom` / `jsx-runtime` external → 宿主全局；
- 构建脚本按清单自动发现，**不要**在根 `package.json` 为单个插件写 build 脚本。

### 8.2 内置发布（`npx nx-kv` 直接可用）

| 要求 | 位置 |
|---|---|
| 插件包 `private: true` | 插件 `package.json` |
| 根 `files` 包含 `packages/` | 根 `package.json` |
| 根 `dependencies` 不含任何 `@nx-kv/*` | 根 `package.json` |
| SDK 只在 `devDependencies: workspace:*` | 根 `package.json` |
| `tsx` 在 `dependencies` | `bin/kv.mjs` 运行时执行 TS 源码 |
| 宿主按 `{ name, dir }` 相对目录加载 | `src/modules/plugin/registry.ts` |

安装包后，`plugins.generated.ts` 里的 `dir`（`packages/plugin-<id>`）随 tarball 一起存在，
宿主无需 node_modules 包链接即可加载。

### 8.3 升级

- 插件 `version` 与 `api` 声明在包内；
- 表结构变化：提升 `storageVersion` 并在 `migrateStorage` 里按 `fromVersion` 逐级升级；
- 入口 id 变化视为新入口（旧入口的可见性/默认配置不会自动迁移，需插件自行处理或避免改 id）；
- 宿主 API 不兼容时提升 `api`（当前只支持 `^1`）。

---

## 9. 扩展指南（按需求选）

| 想加什么 | 动哪里 | 参考实现 |
|---|---|---|
| 新 draft 入口（模板 / 槽位） | server `entries()` 追加；`buildDraft` 返回正文 | `packages/plugin-task-template/src/server/index.ts` |
| 新 panel 入口 | `entries()` 返回 `kind:'panel'` + `ui.panel`；client 注册组件 | `packages/plugin-dir-annotate/src/server/index.ts` |
| 插件页面（不进下拉） | client `components` + `pages`；由侧栏或代码跳转 | 目录批注设置页 |
| 左下角设置页 | client `sidebar: [{ ..., page }]` | `packages/plugin-dir-annotate/src/client/SettingsPage.tsx` |
| 插件自有 RPC | server `rpc: { method(ctx, raw) }`；client `api.rpc('method', params)` | task-template 模板 CRUD |
| 插件自有表 | `migrateStorage` + 提 `storageVersion` | `packages/plugin-task-template/src/server/storage.ts` |
| 用宿主目录 / 文件 | client `api.host.get('/api/plugins/tree'|'/file')` | `packages/plugin-dir-annotate/src/client/AnnotatePage.tsx` |
| 组主题先选仓库 | `/api/plugins/context` 返回 `repos`；插件内部选择 | 同上 |
| 生成任务草稿并覆盖归属 | `api.createDraft(draft, { project, board })` | 同上 `generate()` |
| 任务页底部插件 tab | server `gettask()` 返回条目 + `ui.panel`；client 注册同名组件 | skill-ref「技能引用」（§15） |
| 领取交付追加插件区块 | 同一条 `gettask()` 的 `template` + `data(taskCtx)` | 同上 |
| 候选条目（面板 / 正文搜索） | server `candidates()` 返回 `PluginCandidate[]`；宿主聚合 | skill-ref 的技能扫描（§15.6） |
| 草稿态绑定 + 提交迁移 | dock 用 `draft-N` 暂存；`onTaskCreated` 迁到真实任务号 | skill-ref 的 `task_drafts` 表（§15.5） |
| 旧内置数据迁移 | server `migrateLegacy` | task-template v19/v20 流程 |

### 9.1 给现有插件加一个入口（最短路径）

1. server `entries()` 里追加一项（id 前缀正确、kind 正确）；
2. 若是 panel：client 注册 `components[ui.panel]` + `pages[ui.panel]`；
3. 若是 draft：实现/复用 `buildDraft`；需要槽位就写 `{{槽位}}`；
4. `pnpm run build:packages`；
5. 开面板：下拉里应出现新入口；「配置新建页行为…」里可设默认；
6. 真机点一次「＋ 新建页」和任务页「新任务」，确认两条路都按默认入口走。

### 9.2 新增一个插件（0 → 可用清单）

- [ ] 复制 `packages/plugin-dir-annotate/` 或 `packages/plugin-skill-ref/` 的骨架，改包名 / id / nxkv
- [ ] `packages/plugin-<id>/src/server/index.ts`：`definePlugin` + 生命周期（先最小可用）
- [ ] `packages/plugin-<id>/src/client/index.tsx`：`registerPlugin`（先一个页面组件）
- [ ] 需要存储：`storage.ts` + `storageVersion` + `migrateStorage`
- [ ] 需要 gettask / candidates / 草稿迁移：按 §16.3 / §16.4 补 `gettask()` / `candidates()` / `onTaskCreated()`
- [ ] `pnpm gen:plugins && pnpm run build:packages`
- [ ] `node bin/kv.mjs plugin list --json`（error 为空）
- [ ] `node bin/kv.mjs plugin entries --topic <key> --json`（有 pretask 入口时）
- [ ] `node bin/kv.mjs plugin gettask --json`（有 gettask 时）
- [ ] `node bin/kv.mjs plugin candidates --pluginId <id> --cwd <repoRoot> --json`（有候选时）
- [ ] 面板：默认项设为新入口 → 「＋ 新建页」/「新任务」/侧栏「新建页」三条路验证
- [ ] gettask 真机：真实任务 tab / 草稿页 tab / 提交迁移 / 设置页模板 / preview 五条路验证
- [ ] `pnpm lint && pnpm typecheck && pnpm build && pnpm run test:unit && pnpm run test:smoke`
- [ ] 补 `tests/unit/plugin-<id>.test.mjs`（照抄 `tests/unit/plugin-task-template.test.mjs` 或 `plugin-gettask.test.mjs`）

---

## 10. 测试与门禁

| 层 | 做法 |
|---|---|
| 单元（宿主 + 插件） | `createTestStore()` 临时库；host `listPlugins/listEntries/buildDraft/callRpc/visibility`；见 `tests/unit/plugin-task-template.test.mjs` |
| CLI | `plugin list` / `entries` / `context` / `tree` / `file` / `visibility` / `set-default` / `rpc` |
| 浏览器 | 真机点入口、面板页、设置页、新建页三条触发点；注意旧 chunk 缓存（带 `?cb=1` 或硬刷新） |
| 打包 | `npm pack --dry-run` 确认 `packages/*/dist` 在包内；安装 tarball 后跑 `plugin list` |
| 边界门禁 | `pnpm lint` 里的 `check-plugin-isolation`（清单一致 / 双向 import 闭合 / 发布面） |

---

## 11. 故障排查

| 症状 | 原因 | 处置 |
|---|---|---|
| 插件不出现 / `plugin list` error | 清单没生成、server 产物不存在、发布包没带 `packages/` | `pnpm gen:plugins` → `pnpm run build:packages`；检查根 `files` |
| 下拉里没有入口 | `entries()` 返回空（ctx 没定位）、scope 隐藏、插件全局关闭 | `plugin entries --all --json` → `plugin visibility` → `plugin list` |
| 点开插件页空白「插件 UI 未注册」 | client 没 build / `registerPlugin` 的 id 与 server id 不一致 | 重跑 `build:packages`、核对 id、硬刷新 |
| 「＋ 新建页」没走默认入口 | 默认项被隐藏 / scopeKey 写错 / 前端缓存旧清单 | `plugin visibility --scopeKey ...` 看 `defaultEntryId` 与 `visible` |
| 两个插件页切不过去 | 路由判等漏了 `pluginId/pageId/sessionId` | 检查 `src/web/frontend/routes/route-eq.ts` 与 `App.tsx` 的 `routeSig` |
| 插件读目录报越界 | repoKey 未登记 / 路径含 `..` / 软链 | `plugin tree --repoKey <key>` 先验；不要绕开 host API 直接读盘 |
| 任务页 dock 没有插件 tab | `gettask()` 返回空 / 没给 `ui.panel` / client 没注册同名组件 / 草稿任务 | `plugin gettask --json` 看声明；重跑 `build:packages`；核对 `ui.panel` 与 `components` key |
| 领取交付没有插件区块 | `data(taskCtx)` 返回 null / 插件表没数据 / 插件被禁用 | 先用 `plugin rpc` 读插件表；`localtask preview --id <任务号>` 看 instruction 与 warnings |
| 任务页「新任务」没按默认入口 | 旧前端 / 默认入口为空 / `usePretaskEntries` 作用域不对 | 确认 `task.tsx` 传入 `topic/repo/group`，且 `pretaskScopeOf` 有组上下文 |
| lint 报「宿主硬编码插件包名」 | 宿主代码写死包名 | 用生成清单；插件专属逻辑回插件包 |
| lint 报「插件 import 了 xxx」 | 插件引用了宿主 src / 第三方 | 只允许 SDK / React / node: / 包内相对路径 |

---

## 12. 反模式

- 在宿主里给某个插件写特判（包名、入口 id、专属 UI）——宿主只认清单与 SDK。
- 插件直接读写宿主表（`tasks/topics/repos/docs/settings`）。
- 插件 import 宿主 `src` 或除 SDK 外的第三方包。
- 把插件表塞进宿主迁移；插件表只归 `migrateStorage`。
- 在根 `package.json` 为每个插件写 build 脚本或把插件加进 `dependencies`。
- 让宿主运行时 import `@nx-kv/plugin-sdk`（SDK 只在构建期与插件 server 打包时使用）。
- 在下拉行里标「默认」——默认是主题级配置，插件声明只是回落。
- 新增插件页面时去改宿主路由——`#/plugin/<id>/<page>` 是通用路由。

---

## 13. 关键文件地图

| 责任 | 文件 |
|---|---|
| 插件清单生成 | `scripts/gen-plugins.mjs` → `src/modules/plugin/plugins.generated.ts` |
| 插件构建 | `scripts/build-plugins.mjs` |
| 加载 / 资产 | `src/modules/plugin/registry.ts`、`src/modules/plugin/assets.ts` |
| 生命周期 / 入口 / 默认项 | `src/modules/plugin/host.ts` |
| gettask 声明聚合 / 按任务取块 | `src/modules/plugin/gettask.ts`、`src/modules/plugin/actions/plugin-gettask.ts` |
| 草稿提交后插件通知 | `src/modules/plugin/task-created.ts`、`actions/plugin-task-created.ts` |
| gettask 外部段注册（设置页/模板校验） | `src/modules/promptplug/external.ts` |
| 候选条目标准接口 | `src/modules/plugin/candidates.ts`、`actions/plugin-candidates.ts` |
| 任务页 dock 插件 tab | `src/web/frontend/page/dir/task-dock-panel.tsx`、`task-plugin-dock.tsx` |
| 交付插件区块适配 | `src/modules/claim/assemble.ts`（`gettaskPluginOf`） |
| scope 解析 / topic 快照 | `src/modules/plugin/context.ts` |
| 目录/文件安全边界 | `src/modules/plugin/fs.ts` |
| 插件自有可见性存储 | `src/modules/plugin/repo/visibility.ts` |
| 插件页面挂载 | `src/web/frontend/plugin-host/plugin-page.tsx` |
| 入口打开（草稿/面板/session） | `src/web/frontend/modules/pretask/open-entry.ts` |
| 新建页默认行为配置页 | `src/web/frontend/plugin-host/visibility-panel.tsx` |
| 任务页「新任务」触发 | `src/web/frontend/page/dir/task-actions.ts`、`task-derived-ctx.ts` |
| 插件页路由 | `src/web/frontend/routes/plugin.ts` |
| 边界门禁 | `scripts/check-plugin-isolation.mjs` |
| 示例插件 | `packages/plugin-task-template/`、`packages/plugin-dir-annotate/`、`packages/plugin-skill-ref/` |

---

## 14. CLI 速查

```powershell
node bin/kv.mjs plugin list --json
node bin/kv.mjs plugin entries --topic <topicKey> --json
node bin/kv.mjs plugin entries --topic <topicKey> --all --json
node bin/kv.mjs plugin gettask --topic <topicKey> --json
node bin/kv.mjs plugin task-created --draftKey draft-1 --taskId <任务号>
node bin/kv.mjs plugin candidates --pluginId skill-ref --cwd <repoRoot> --json
node bin/kv.mjs plugin context --topicKey <topicKey> --json
node bin/kv.mjs plugin tree --repoKey <repoKey> [--path src] [--showHidden]
node bin/kv.mjs plugin file --repoKey <repoKey> --path README.md
node bin/kv.mjs plugin visibility --scopeKey topic:<topicKey> --json
node bin/kv.mjs plugin set-visibility --scopeKey topic:<topicKey> --entries '<JSON>'
node bin/kv.mjs plugin set-default --scopeKey topic:<topicKey> --entryId <id>:<entry>
node bin/kv.mjs plugin rpc --pluginId <id> --method <method>
pnpm gen:plugins
pnpm run build:packages
```

---

## 15. gettask（第二生命周期点：任务页 dock + 交付插件区块）

pretask 管「新任务从哪来」；gettask 管两件与**已有任务**绑定的事：

1. 任务编辑页底部抽屉（附件 / md / check / 反馈）后面追加插件 tab；
2. `localtask get` 领取这条任务时，把插件数据展开成 `nxkv.plugin.<pluginId>.<tag>` 区块。

同一份声明同时服务两处。声明与具体任务无关，按任务取数走 `data(taskCtx)`。

### 15.1 服务端声明

```ts
gettask?(ctx: PluginContext): PluginGetTaskEntry[] | Promise<PluginGetTaskEntry[]>

interface PluginGetTaskEntry {
  id: string;                 // localId（字母/数字/下划线/短横线）
  label: string;
  description?: string;
  tag?: string;               // 最终 tag = nxkv.plugin.<pluginId>.<tag || localId>
  order?: number;
  template: string;           // 出厂模板（Handlebars 子集）
  fields?: PluginGetTaskField[]; // 模板变量声明；宿主自动补 task.id / task.text
  ui?: { panel: string; title?: string }; // dock tab 的 client 组件 key
  data(taskCtx: PluginGetTaskContext): Record<string, unknown> | null | Promise<...>;
}
```

| 约定 | 说明 |
|---|---|
| 全局 id | `<pluginId>:<localId>`（与 pretask 入口同形） |
| 段 id | `plugin:<pluginId>:<localId>`（设置页模板存储键 `prompt.tpl.<段 id>`） |
| 区块标签 | `nxkv.plugin.<pluginId>.<tag>`；tag 只允许字母/数字/点/下划线/短横线 |
| `data()` 返回 null | 本条任务不出这段（没有内容就别塞空段） |
| 模板变量 | 只能引用 seed（task/cwd/...）与 `fields` 声明的变量；`{{#each skills}}` 内部是相对名 |
| 失败语义 | 单个插件声明/取数失败只记 warning，不阻断领取 |

### 15.2 宿主做了什么

| 环节 | 位置 | 行为 |
|---|---|---|
| 声明聚合 | `src/modules/plugin/gettask.ts` `listGetTaskEntries` | 只列已启用且激活成功的插件；校验 id/tag/模板；全局排序 |
| 按任务取块 | 同上 `collectGetTaskBlocks` | 逐条调 `data({...ctx, task})`；null 跳过；异常降级 warning |
| 任务页 dock | `task-dock-panel.tsx` + `task-plugin-dock.tsx` | 「反馈」之后追加 tab；内容用 `PluginComponent` 挂载 `ui.panel`，注入 `PluginClientApi`（`ctx.location.taskId`） |
| 领取交付 | `claim/host.ts` → `claim/assemble.ts` | 区块套模板（用户模板优先，坏模板回退出厂）→ 包进 `<nxkv.plugin...>`，排在 get 链末尾 |
| 设置页 | `prompt-registry` + `external.ts` | 外部段归入「插件区块（gettask）」；可复制/编辑/启用；保存走同一套变量白名单 |
| 草稿提交迁移 | `claim` 组装前的 `onTaskCreated` 广播 | 任务落库后把 `draftKey` 交给插件，插件把暂存数据迁到 `task.id` |
| CLI / HTTP | `plugin gettask` / `GET /api/plugins/gettask` | 巡检声明（不含任务数据）；`taskId` 参数接受任务号或草稿键 |

### 15.3 插件实现要点

1. `gettask()` 只声明，ctx 可能为空（设置页会空 ctx 调一次）——不要依赖 topic 才返回条目；
2. 数据落**插件自有表**，用 `ctx.task.id` 绑定；不要读写宿主任务表；
3. `ui.panel` 与 client `components` 的 key 必须一致；dock 通过 `api.rpc` 读写数据；
4. 出厂模板的变量必须在 `fields` 里声明（`task.id` / `task.text` 自动补）；
5. 需要「没有数据就不出段」时，`data()` 返回 `null`，不要返回空对象；
6. 要支持草稿页时，RPC 的键用 `taskKey`（任务号或 `draft-N`），并实现 `onTaskCreated` 迁移（见 §15.5）。

最小示例（`packages/plugin-skill-ref`）：

- server：`gettask()` 声明 `skills`；`data()` 按 `task.id` 读 `plugin_skill_ref_task_skills`，再把选中技能解析成 `{ name,path,dir,description }`；
- client：`SkillPickerPanel` 组件 + `registerPlugin` 注册 `components['skill-picker']`；
- 存储：`storageVersion: 1`，`migrateStorage` 里建设置表 + 任务绑定表；
- RPC：`taskSkillsGet` / `taskSkillsSave` / `getSettings` / `setSettings`；
- 候选：`candidates()` 扫描 `.claude/skills`，面板通过宿主 `/api/plugins/candidates` 读取。

### 15.4 验证

```powershell
node bin/kv.mjs plugin gettask --json
node bin/kv.mjs plugin candidates --pluginId skill-ref --cwd <repoRoot> --json
node bin/kv.mjs localtask preview --id <任务号>   # instruction 里应出现插件区块
pnpm run test:unit                               # tests/unit/plugin-gettask.test.mjs
```

真机：编辑页底部出现插件 tab → 选中技能并保存 → 预览/领取的 instruction 里出现对应 `nxkv.plugin.*` 区块。

### 15.5 草稿态与任务创建迁移（`onTaskCreated`）

草稿页没有真实 task.id（路由是 `task=draft-N`）。dock 插件 tab 照常挂载，插件用
`ctx.location.taskId` 作为**任务键**（`draft-N` 或真实任务号）：

1. 读写在插件内部按任务键分表：真实任务号走任务表，草稿键走临时表；
2. 草稿提交成功后，宿主调用 `POST /api/plugins/task-created`：
   ```ts
   onTaskCreated?(ctx: PluginContext, event: { draftKey?: string; task: PluginTaskInfo }): void | Promise<void>
   ```
3. 插件把 `draftKey` 下的数据迁到 `event.task.id`，并清掉草稿行；
4. 单体插件迁移失败只记 warning，**不影响任务创建**；前端在跳转新任务页前等待广播完成。

skill-ref 的做法：`plugin_skill_ref_task_drafts(task_key TEXT, ...)` 存草稿选中项，
`onTaskCreated` 调 `moveDraftSkills(draftKey, taskId)` 迁到 `plugin_skill_ref_task_skills`。

### 15.6 候选条目标准接口（`candidates`）

面板列表与**后期正文内搜索/引用**共用同一份数据契约：

```ts
candidates?(ctx: PluginContext): PluginCandidate[] | Promise<PluginCandidate[]>

interface PluginCandidate {
  id: string;          // 插件内稳定 id（推荐带业务前缀，如 skill:<绝对路径>）
  label: string;       // 展示名
  description?: string;
  kind?: string;       // 业务类别（如 'skill'）
  path?: string;       // 可加载/引用的物理位置
  text?: string;       // 搜索文本（名称 + 描述 + 路径 + 关键词）
  meta?: Record<string, unknown>; // 插件自定义结构化数据
}
```

| 项 | 口径 |
|---|---|
| 宿主聚合 | `plugin candidates` / `GET /api/plugins/candidates`；只列已启用且激活成功的插件 |
| 参数 | `pluginId`（只看某个插件）、`q`（大小写不敏感）、`limit`（默认 200 / 上限 1000）、`topic/group/repo/cwd` |
| 去重 / 排序 | 按插件内 id 去重；按插件 order + label 排序 |
| 失败语义 | 单插件抛错只记 warning，不阻断其他插件 |
| 未来正文引用 | 用 `pluginId + candidate.id` 或 `candidate.path` 生成引用；宿主不再新增第二套候选数据源 |

---

## 16. 标准插件开发流程（SOP）

这一节把 pretask / gettask / candidates / onTaskCreated 串成一条标准流程。
纯 pretask 插件可跳过 gettask 相关步骤；只做 gettask 的插件可把 `entries()` 返回空数组。

### 16.1 先选能力组合

| 你要的能力 | 必须实现 | 宿主自动接线 | 参考 |
|---|---|---|---|
| 新建任务入口 | `entries()` + `buildDraft()` | 下拉、新建页、可见性、默认项 | `plugin-task-template` |
| 任务编辑页 dock tab | `gettask()` + `ui.panel` | 声明聚合、dock tab、`PluginClientApi` 注入 | `plugin-skill-ref` |
| 领取追加提示词区块 | `gettask()` 的 `template` + `data(taskCtx)` | 取块、套模板、包 `nxkv.plugin.*` | 同上 |
| 设置页改插件模板 | 不需要写宿主 | 外部段注册、变量白名单、保存/启用/删除 | 设置 → 提示词模板 |
| 候选条目（面板 / 正文搜索） | `candidates(ctx)` | `/api/plugins/candidates` 聚合/过滤/截断 | `skill-ref` 技能扫描 |
| 草稿态也能配置 | `taskKey` RPC + 草稿表 | dock 用 `draft-N`、提交后广播 `onTaskCreated` | `skill-ref` 的 `task_drafts` |
| 插件面板 / 设置页 | client `components`/`pages`/`sidebar` + `rpc` | 插件页路由、左下角侧栏 | `plugin-dir-annotate` |
| 自有数据 | `storageVersion` + `migrateStorage` + 自有表 | 版本账本、激活 | 所有插件 |

**生命周期是同一个插件对象上的可选方法，不是插件类型**：一个插件可以同时实现 `entries()/buildDraft()`（pretask）
和 `gettask()`，也可以只实现其中一边；左下角设置页是插件自己的 client `sidebar`，与生命周期无关。
现有三个内置插件只注册了业务需要的点：

| 内置插件 | 注册的生命周期 / 注册点 |
|---|---|
| `task-template` | pretask（entries/buildDraft）+ 模板管理页 / 侧栏 |
| `dir-annotate` | pretask（entries/buildDraft）+ panel 入口 + 目录批注设置页 |
| `skill-ref` | gettask + candidates + onTaskCreated + 技能引用设置页（没有 pretask 入口） |

### 16.2 0→1 十步

**1. 建包** `packages/plugin-<id>/`

| 文件 | 作用 |
|---|---|
| `package.json` | `name`、`private: true`、`type: module`、**`nxkv` 清单**、`dependencies` 只有 SDK、React 只做 peer |
| `tsconfig.server.json` | server 类型检查 + 产物目录 `dist/server` |
| `tsconfig.client.json` | client JSX 类型检查 |
| `vite.config.ts` | client IIFE + 共享 React 全局 |
| `src/server/index.ts` | `definePlugin(...)` 默认导出 |
| `src/client/index.tsx` | `registerPlugin('<id>', def)` |
| `src/client/style.css` | 插件自有样式（前缀 `.<id>-`） |

**2. server 入口** `src/server/index.ts`

```ts
export default definePlugin({
  id: '<id>', version: '0.1.0', api: '^1', name: '插件名',
  description: '一句话', order: 30, defaultEnabled: true,
  storageVersion: 1,
  migrateStorage(db, from) { /* 建/升自有表 */ return 1; },
  entries(ctx) { /* 没有 pretask 入口就 return [] */ },
  async buildDraft(ctx, entryId, values) { /* 没有 draft 入口就 throw */ },
});
```

**3. 存储**：表名 `plugin_<id>_*`；只在 `migrateStorage` 建；只写自己的表；版本由宿主记进 `plugin_storage_migrations`。
需要草稿迁移就再加一张草稿键表（如 `plugin_skill_ref_task_drafts(task_key TEXT PRIMARY KEY, ...)`）。

**4. 按需实现生命周期**

| 钩子 | 用途 | 关键约束 |
|---|---|---|
| `entries` / `buildDraft` | pretask 入口 | 入口 id `<id>:<localId>`；panel 入口 `buildDraft` 抛错 |
| `gettask` | dock tab + 领取区块 | 声明与任务无关；`data(taskCtx)` 才按任务取数 |
| `candidates` | 可搜索/可引用候选 | 稳定 id；不绑定任务 |
| `onTaskCreated` | 草稿提交迁移 | `draftKey` → `task.id`；幂等；失败不回滚 |
| `rpc` | 面板/设置页读写 | 方法名 camelCase；参数自己校验 |

**5. client 注册** `src/client/index.tsx`

```ts
window.NxkvPluginHost.registerPlugin('<id>', {
  api: '^1',
  components: { 'skill-picker': Panel, settings: Settings },
  pages: { 'skill-picker': { title: '技能引用' }, settings: { title: '设置' } },
  sidebar: [{ id: 'settings', label: '插件设置', icon: 'gear', order: 30, page: 'settings' }],
});
```

**6. dock 面板**：`gettask().ui.panel` 的 key 必须与 `components` 同名；
插件组件通过 `api.rpc` 读写数据，`api.ctx.location.taskId` 是真实任务号或 `draft-N`。

**7. 设置页**：client `sidebar` 自注册；server `rpc` 提供 `getSettings` / `setSettings`；
设置落插件自有表，不碰宿主 `settings`。

**8. 注册与构建**

```powershell
pnpm gen:plugins          # 扫描 nxkv 清单 → plugins.generated.ts
pnpm run build:packages   # SDK + 所有插件（自动发现）
pnpm run gen              # action / api client 清单
```

**9. 测试**

```powershell
node bin/kv.mjs plugin list --json
node bin/kv.mjs plugin entries --topic <topicKey> --json
node bin/kv.mjs plugin gettask --json
node bin/kv.mjs plugin candidates --pluginId <id> --cwd <repoRoot> --json
node bin/kv.mjs plugin rpc --pluginId <id> --method <method> --params '...'
pnpm run test:unit
```

**10. 文档与收尾**：更新 `README.md` 内置插件表、本文件、A13/B09；跑完整门禁。

### 16.3 gettask 专项检查清单

- [ ] `gettask()` 只声明，不读具体任务；设置页空 ctx 调用也能返回条目。
- [ ] `data(taskCtx)` 用 `ctx.task.id` 查插件表；没有数据返回 `null`，不要返回 `{}`。
- [ ] `fields` 覆盖模板里出现的所有路径；`task.id` / `task.text` 宿主自动补。
- [ ] 模板正文非空；`tag` 最终是 `nxkv.plugin.<pluginId>.<tag>`。
- [ ] `ui.panel` 与 client `components` 的 key 一致；dock 打开时不白屏。
- [ ] RPC 用 `taskKey`（字符串）：真实任务号与 `draft-N` 都能读写。
- [ ] 草稿提交后实现 `onTaskCreated`，先写新任务、成功后再删草稿行。
- [ ] 组任务：用 `ctx.repoKey` / `ctx.task.projectKey` 定位仓库；宿主已在 claim 与 dock 透传。
- [ ] 单插件失败只记 warning；`plugin gettask` / `localtask preview` 仍能工作。
- [ ] 候选条目走 `candidates()`，不要把候选和任务选中混在一张表里。
- [ ] 设置页模板：保存前变量白名单校验；坏模板回退出厂模板。

**已有 pretask 插件升级为 gettask 插件（最短路径）**

1. `storageVersion + 1`：新增任务表与草稿键表（如 `plugin_<id>_task_items` / `plugin_<id>_task_drafts`）；
2. server 增加 `gettask()` 声明（id/label/tag/template/fields/ui/data）；
3. server 增加 `data(taskCtx)`：按 `ctx.task.id` 读自己的表，无数据返回 `null`；
4. server 增加 `rpc`：`taskItemsGet` / `taskItemsSave`，参数统一用 `taskKey`（任务号或 `draft-N`）；
5. server 增加 `onTaskCreated`：把 `draftKey` 行迁到 `task.id`（先写后删）；
6. client 注册 `components[ui.panel]` + `pages`；需要设置页再补 `sidebar` + `getSettings/setSettings`；
7. 需要候选搜索/引用再加 `candidates(ctx)`；
8. `pnpm gen && pnpm run build:packages`，按 §16.5 / §16.6 验证。

### 16.4 登记点清单（新增插件到底要动哪些地方）

| 登记点 | 类型 | 位置 | 新插件要动吗 |
|---|---|---|---|
| 插件包清单 | 插件 | `packages/plugin-<id>/package.json` 的 `nxkv` | 是 |
| 生成清单 | 自动 | `scripts/gen-plugins.mjs` → `src/modules/plugin/plugins.generated.ts` | 跑 `pnpm gen:plugins` |
| 构建 | 自动 | `scripts/build-plugins.mjs` | 跑 `pnpm run build:packages` |
| SDK 契约 | 宿主 | `packages/plugin-sdk/src/index.ts` | 只在新增生命周期点 / 字段形状时 |
| server 入口 | 插件 | `src/server/index.ts` | 是 |
| client 注册 | 插件 | `src/client/index.tsx` | 是 |
| 自有表 / 迁移 | 插件 | `src/server/storage.ts` + `migrateStorage` | 有持久化就要 |
| gettask 声明 / 取数 | 插件 | `gettask()` + `data(taskCtx)` | 按需 |
| 候选条目 | 插件 | `candidates(ctx)` | 按需 |
| 草稿迁移 | 插件 | `onTaskCreated(ctx, event)` | 草稿页要保存时 |
| 外部段注册 | 宿主通用 | `promptplug/external.ts` + `plugin/gettask.ts` | 否（自动） |
| 设置页模板 | 宿主通用 | `prompt-registry` / `template-save|activate|delete` | 否（自动） |
| dock 挂载 | 宿主通用 | `task-dock-panel.tsx` + `task-plugin-dock.tsx` | 否（自动） |
| 领取取块 | 宿主通用 | `claim/host.ts` + `plugin/gettask.ts` + `claim/assemble.ts` | 否（自动） |
| 候选聚合 | 宿主通用 | `plugin/candidates.ts` + action | 否（自动） |
| 草稿提交通知 | 宿主通用 | `plugin/task-created.ts` + `task-actions.ts` | 否（自动） |
| 测试 | 插件 + 宿主 | `tests/unit/plugin-<id>.test.mjs` | 是 |
| 文档 | 文档 | `README.md` / 本文件 / A13 / B09 | 是 |

### 16.5 SOP 命令

```powershell
# 1) 新包 → 生成清单 → 构建
pnpm gen:plugins
pnpm run build:packages

# 2) 插件是否真的被加载
node bin/kv.mjs plugin list --json

# 3) pretask 入口
node bin/kv.mjs plugin entries --topic <topicKey> --json
node bin/kv.mjs plugin entries --topic <topicKey> --all --json

# 4) gettask 声明 / 候选 / RPC
node bin/kv.mjs plugin gettask --json
node bin/kv.mjs plugin candidates --pluginId <id> --cwd <repoRoot> --json
node bin/kv.mjs plugin rpc --pluginId <id> --method <method> --params '...'

# 5) 交付预览（含插件区块）
node bin/kv.mjs localtask preview --id <任务号> --key <topicKey> --json

# 6) 门禁
pnpm lint
pnpm typecheck
pnpm build
pnpm run test:unit
pnpm run test:smoke
```

### 16.6 真机验收清单

- [ ] 真实任务：底部出现插件 tab，能选中/保存，刷新后仍在。
- [ ] 草稿页：底部出现插件 tab；保存后提示草稿迁移；提交后新任务仍保留。
- [ ] 领取交付：`localtask preview` 出现 `<nxkv.plugin.<id>.<tag>>` 与选中数据。
- [ ] 设置页：提示词模板出现「插件区块（gettask）」；自定义模板保存后 preview 生效。
- [ ] 组任务：按任务落库的 repo 解析技能/候选目录，不是组目录。
- [ ] 禁用插件：tab 消失、交付无区块，但领取与页面不报错。
- [ ] 坏数据 / 坏模板：警告可见，领取继续（fail-open）。
- [ ] 真机页面带 `?cb=1` 或硬刷新，避免旧 chunk / 旧插件 bundle。

### 16.7 失败分支

| 症状 | 原因 | 处置 |
|---|---|---|
| dock 没有插件 tab | `gettask()` 返回空 / 没给 `ui.panel` / client 未注册组件 | `plugin gettask --json`；重跑 `build:packages`；核对组件 key |
| 草稿页报「taskId 必须是数字」 | 声明接口把 `taskId` 写成 `z.number()` | 改成字符串（任务号或 `draft-N`） |
| 交付没有插件区块 | `data(taskCtx)` 返回 null / 插件表没数据 / 插件被禁用 | `plugin rpc` 读表；`localtask preview` 看 instruction/warnings |
| 草稿提交后选中项丢失 | 没实现 `onTaskCreated` / RPC 仍用数字 taskId / 先删草稿再写新任务 | 按 `taskKey` 分表；先写新任务再删草稿行 |
| 设置页看不见插件段 | 插件未启用 / `gettask()` 抛错 / 外部段注册未加载 | `plugin gettask --json`；`plugin list` 看 error；重跑 gen/build |
| `plugin candidates` 为空 | `candidates()` 返回空 / ctx 没定位仓库 / 配置目录不存在 | 带 `--cwd <repoRoot>` 先验；检查扫描根与配置 |
| lint 报宿主硬编码插件名 | 宿主写死插件包名/入口 id | 改用生成清单；插件逻辑回插件包 |
| lint 报插件 import 宿主 | 插件引用了 `src/` 或第三方 | 只允许 SDK / React / node: / 包内相对路径 |

### 16.8 最小文件清单与反模式

```
packages/plugin-<id>/
  package.json
  tsconfig.server.json
  tsconfig.client.json
  vite.config.ts
  src/server/index.ts        # definePlugin + 生命周期
  src/server/storage.ts      # 自有表 / 迁移（有持久化时）
  src/client/index.tsx       # registerPlugin
  src/client/Panel.tsx       # dock / 页面组件（按需）
  src/client/Settings.tsx    # 设置页（按需）
  src/client/style.css
  src/server/skills.ts       # 业务扫描 / 取数（按需）
tests/unit/plugin-<id>.test.mjs
```

反模式：

- 宿主里给某个插件写特判（包名 / 入口 id / 专属 UI）。
- 插件读写宿主 `tasks/topics/repos/docs/settings` 表。
- `gettask()` 里按具体任务取数；或 `data()` 返回空对象而不是 `null`。
- 草稿页用数字 `taskId`，或存了草稿数据不迁移。
- 把候选条目和任务选中混成一套数据。
- 把插件表写进宿主迁移；插件表只归 `migrateStorage`。
- 在根 `package.json` 给单个插件写 build 脚本或加进 `dependencies`。
