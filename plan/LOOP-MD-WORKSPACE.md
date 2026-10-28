# Ralph loop · 原型落地到项目（仅轮次 × 3）

> `nx-rp` 0.4.1 无 `loop` CLI；本会话手工 Ralph × 3。产物在 `src/`，纪要落本文件。

## 任务

把 `plan/agent-md-workspace.html` 的 MD 式工作台落到 nx-kv Web 面板：

1. 目录详情改为 **MD 编辑提交**（无 talk 输入框）+ 导入 MD + 附件位
2. 右侧可折叠 **并发任务进程**面板
3. 侧栏展示目录下 MD/任务子行；保留既有三段拖拽与右键菜单
4. 侧栏 **宽度可拖**（对齐 nx-ft shell-resizer）
5. 数据尽量走现有 `/api/localtasks`（任务正文 = Markdown）

## 结束模式

仅轮次 · max 3 · 无 promise

## 第 1 轮目标

- 新建 `src/modules/md-workspace/` 骨架（view + progress + editor 壳）
- registry / App 路由：`#/dir/<key>` 主区改为 MD 工作台（保留 overview/cloud 等）
- 侧栏宽度分隔条接入 App

## 第 2 轮目标

- MD 编辑/预览/分栏；提交/保存走 localtasks API
- 导入 `.md`；附件条（本机 blob/localStorage）
- 右栏并发进程：按目录 tasks 状态映射阶段

## 第 3 轮目标

- 侧栏子行 = 该目录任务；点开进对应 MD
- 预览划选 → 追加新 MD 任务
- 修接线/样式死角，冒烟验证

---

## 第 1 轮纪要 ✅

- 新建 `src/modules/md-workspace/`（view / progress-panel / md-parse / style）
- `#/dir` 与 `#/global` 主区改为 MD 工作台；经典看板保留 `#/localtask`（及 registry `dir-board`）
- App 接入侧栏宽度分隔条（160–480、方向键、双击重置、localStorage）

## 第 2 轮纪要 ✅

- MD 编辑 / 预览 / 分栏；提交与保存走 `/api/localtasks`（正文即 Markdown）
- 导入 `.md`；附件条（dataURL + localStorage 按 task id）
- 右栏并发进程：按 task 状态映射阶段与计时

## 第 3 轮纪要 ✅

- 侧栏当前目录下展开任务子行；`?task=` 深链打开对应 MD
- 预览划选 → 新 MD 草稿追加（非 talk）
- `pnpm run build` 通过
