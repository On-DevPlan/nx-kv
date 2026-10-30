# Ralph loop · MD 编辑器专业对齐（仅轮次 × 10）

> `npx nx-rp loop` · 仅轮次 · max 10 · 无 completion-promise  
> 产物：`src/web/frontend/modules/md-workspace/`（主）· 纪要落本文件

## 任务

持续优化 MD 工作台**编辑器**的使用功能：UX、格式工具、换行显示。  
横向对照专业编辑器（Obsidian / Typora / VS Code MD / Notion），缺口全部补齐。

## 横向对照（基线 → 目标）

| 能力 | Obsidian | Typora | VS Code | Notion | 当前 | 目标轮 |
|---|---|---|---|---|---|---|
| Soft wrap / 换行切换 | ✓ | ✓ | ✓ toggle | ✓ | 源码弱/无状态 | R1 |
| 格式工具条 B I ` H list todo quote link | hotkey/slash | 浮层 | ext | `/` | 仅图/附件 | R1 |
| 快捷键 Ctrl/⌘B I K | ✓ | ✓ | ✓ | ✓ | 无 | R1 |
| Tab / Shift+Tab 缩进 | ✓ | ✓ | ✓ | ✓ | 无 | R1 |
| Enter 列表续行 | ✓ | ✓ | ✓ | ✓ | live 部分 | R1–2 |
| 状态栏 字数/行/换行态 | ✓ | ✓ | ✓ | — | 无 | R1 |
| 粘贴/拖入图片 | ✓ | ✓ | ✓ | ✓ | 仅选文件 | R2 |
| 源码行号（可选） | ✓ | — | ✓ | — | 无 | R3 |
| Find Ctrl/⌘F | ✓ | ✓ | ✓ | ✓ | 无 | R3–4 |
| live 块格式工具/slash | ✓ | ✓ | — | ✓ | 弱 | R4–5 |
| 选区浮动格式条 | — | ✓ | — | ✓ | 仅预览选区菜单 | R5–6 |
| 换行视觉指引 / 缩进引导 | ✓ | — | ✓ | — | 无 | R6–7 |
| 窄屏工具收敛 / 溢出菜单 | ✓ | ✓ | ✓ | ✓ | 易挤 | R7–8 |
| 无障碍 aria / 焦点环策略 | ✓ | ✓ | ✓ | ✓ | 部分 | R8–9 |
| 构建验收 + 纪要收口 | — | — | — | — | — | R10 |

## 结束模式

仅轮次 · `--max-iterations 10` · **不传** `--completion-promise`

## 每轮纪律

1. 读本文件上一轮纪要 + 相关源码，再改
2. 每轮只推 1–2 个可验收缺口；改 `md-workspace` 内文件
3. 本文件追加「第 N 轮纪要」
4. 不无关重构；不碰侧栏/进程面板除非编辑器依赖

---

## 第 1 轮纪要 ✅

- 对照表写入本文件；`nx-rp loop on` + `loop start` 仅轮次 ×10（session 绑 Cursor 会话）
- 新增 `md-edit-ops.js`：wrapSelection / 行前缀 / Tab 缩进 / Enter 列表续行；返回 `{value,start,end}` 适配受控 textarea
- `md-panes.jsx` · `SourceEditor`：默认 soft-wrap（`pre-wrap` + `overflow-wrap`）、底栏「换行/不换行」切换、行/词/字状态、`editorApiRef.format`
- `tool-bar.jsx`：源码模式格式条 B / I / code / 链 / H2 / 列表 / 待办 / 引用；快捷键 Ctrl/⌘B I E K
- `style.css`：`.mdw-fmt` / `.mdw-editor.is-wrap|is-nowrap` / `.mdw-editor-status`；窄屏隐藏次要格式钮

## 第 2 轮纪要 ✅

- `md-edit-ops`：`insertTextAtCursor` / `imageFilesFromDataTransfer`
- 源码 + live：粘贴/拖入图片 → `onFiles` 在光标处插入 `![]()`，附件入栏；拖入高亮 `.is-drop`
- live 块：Tab / Shift+Tab 缩进、Enter 列表续行（与源码共用 ops + `pendingSelRef`）
- 工具条：宽屏直出列表/待办/引用；≤960px 收进「···」溢出菜单

## 第 3 轮纪要 ✅

- 源码行号 gutter（默认可关；与 textarea `scrollTop` 同步；逻辑行）
- Ctrl/⌘F / 底栏「查找」：查找条、Enter/F3 上下跳、选区预填、`n/m` 计数
- live 编辑/阅读：`pre-wrap` + `overflow-wrap:anywhere`，长行不再撑破纸面
- `md-edit-ops`：`findMatches` / `scrollTextareaToIndex`；构建通过

## 第 4 轮纪要 ✅

- live：Ctrl/⌘B I E K；工具条格式在「实时预览」模式也可用（`editorApiRef.format`）
- `/` 斜杠菜单：过滤、↑↓/Enter/Tab 选定、Esc 关闭；`SLASH_CMDS` + `applySlashCommand`
- 构建通过

## 第 5 轮纪要 ✅

- `SelMenu` 统一外壳：`kind=format` 浮条（B/I/代码/链/复制）· `kind=task` 任务菜单
- 源码 / live 编辑 textarea 划选 → 格式浮条；阅读 / live 渲染 DOM 划选 → 任务菜单
- `onMouseDown preventDefault` 保选区；构建通过

## 第 6 轮纪要 ✅

- 状态栏 `Ln/Col`（`caretLineCol`）；可开关 80ch 虚线参考线
- 窄屏 ≤960：右侧次要动作收进「更多」菜单，主按钮保留提交/进程
- 构建通过

## 第 7 轮纪要 ✅（Notion live）

- **回车修复**：空块用 ZWSP 往返；Enter 在光标处拆新块；Shift+Enter 块内软换行
- **双击浮层**：B/I/代码/链 + 转变 1正文 2标题 3小标题 4列表 5待办 6引用；浮层开时按键 1–6
- 划选同样唤起浮层；构建通过

## 第 7b · 常驻格式条（可见性）

- HTML 原型：编辑区顶栏常驻 `B I </> 链 | 1–6`，不依赖双击浮层
- React：`ToolBar` 同步 1–6；`editorApi.turn` / `turnLine`；窄屏收进「更多」

## 第 7c · 行首 `/` 命令（取代双击浮层）

- 去掉双击 / 「工具」浮层；**新行首位输入 `/`** 出命令菜单
- 命令：正文 / 标题 / 小标题 / 列表 / 待办 / 引用 + 粗体/代码/链
- ↑↓ 选择 · Enter/Tab 确认 · Esc 关闭；⋮⋮ 或顶栏「/」插入斜杠
- live + 源码 + HTML 原型已对齐

## 第 8–10 轮目标

R8 无障碍扫尾 → R9 对照表勾缺 → R10 构建+纪要收口。

---

## 交接（2026-10-30 · 新会话接防）

- R1–R7c 成果此前遗留在工作区未提交；本次经 lint 修复（eslint globals 白名单补 `getComputedStyle`）+ `pnpm run lint` / `pnpm run build` 双绿后，作为基线 commit 落地
- 用户最新反馈：编辑器整体仍不够专业，明确点名「标题不会自动换行」
- 重开循环：仅轮次 ×10、无完成承诺；纪要启用 **E 系列**（E1 起），R 系列封存
- E 系列议题池起点：标题自动换行（live `mdw-lp-title` + 源码 `mdw-title-input` 均为单行 input）→ 其余每轮现场盘点（对照 Obsidian / Typora / VS Code / Notion）
