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

---

# E 系列（2026-10-30 起 · 本会话 loop-2 · 仅轮次 ×10）

## 议题池（滚动维护，每轮勾掉已完成、补入新发现）

- [x] **E1 标题自动换行**（用户点名）：live `.mdw-lp-title` + 源码 `.mdw-title-input` 均为单行 input，长标题横向溢出 → 改自动增高 textarea
- [x] E2 源码标题聚焦态：去光晕，底边线转强调色（与 live 零 chrome 语言统一）
- [x] E2 工具栏层级：格式组去灰底容器（hover 显底）+ 簇间 hairline + 次级动作去描边；主次归位
- [x] E2 功能修复：工具栏自适应改容器查询（进程 rail 开/侧栏宽不再静默裁按钮）+ 溢出菜单 portal 到 body（此前被 overflow:hidden 整条裁掉）
- [x] E3 阅读模式：补题头（此前阅读态无标题，与 live/源码断裂）；排版核查——h1-h3/列表/待办/代码/引用/图片样式本已齐备，行宽 720px 上限健康（窄列下实测正文 574px）
- [x] E3 复核后关闭：状态栏切换钮（行号/参考线/查找/换行）on 态语言本已一致，不动
- [ ] 空态打磨：无标题 placeholder、空正文占位引导（「输入 / 唤起命令」之类）
- [ ] 窄屏 ≤960 编辑器复核：标题 24px 已有；工具栏溢出菜单与标题共存、状态栏收纳
- [ ] 长词/URL 溢出：live 块 anywhere 已有；阅读模式与源码 gutter 对齐待查
- [ ] 无障碍扫尾：aria-label 补齐、焦点环策略统一、对比度过一遍

## E1 轮纪要 ✅

- 新增 `TitleArea` 组件（md-panes.jsx）：`rows=1` textarea + `useLayoutEffect` 自动增高（`height:auto→scrollHeight`），监听 window resize 重算；`aria-label="标题"`
- Enter（非输入法组合态）不产生换行 → 焦点交给正文：live 走 `setFocus(0)` 进首块，源码走 `taRef.focus()+setSelectionRange(0,0)`
- 替换两处调用点：LivePreview（`.mdw-lp-title`，onFocus 清块焦点与斜杠菜单）与 SourceEditor（`.mdw-title-input`）
- style.css：`.mdw-title-input` 补 `display:block/width:100%/box-sizing/resize:none/overflow:hidden/overflow-wrap:anywhere/border-radius:0`（压全局 textarea 边框圆角）；`.mdw-lp` 零 chrome 重置块与 28px 样式块、24px 窄屏块均扩到 `textarea.mdw-lp-title`
- 验证：`pnpm run lint` ✅ `pnpm run build` ✅；serve 7877 + Chrome DevTools 实测——live 标题 2 行 `clipped:false`、源码标题 `resize:none`+`anywhere`、标题按 Enter 后 `activeElement` 为正文 textarea 且光标在 0、标题值无 `\n`

## E2 轮纪要 ✅

- **容器查询**：`.mdw-main` 声明 `container:mdwmain / inline-size`；工具栏/纸面自适应从视口媒体查询迁到容器查询三级折叠——`≤1280` 收转变组（1-6）、`≤960` 格式与动作收进 `···`/`更多`、`≤640` 纸面紧凑 + 标题 24px。修掉「进程 rail 一开，左簇被 overflow:hidden 静默裁按钮」的真缺陷；进程 rail 自身规则仍留视口媒体查询
- **工具栏分层**：格式组 `.mdw-fmt` 去灰底容器（hover 才显底）；`.mdw-toolbar-left > * + *` 簇间 hairline（模式 | 格式 | 插入）；`.mdw-actions` 次级动作去描边转文本态（hover 显底、主按钮保住视觉重量）
- **标题聚焦统一**：`.mdw-title-input:focus` 去 box-shadow 光晕、底边线转 `--mdw-accent`（0.15s 过渡），与 live 标题零 chrome 语言对齐
- **溢出菜单 portal**：`useMenu` 升级（menuRef + 锚点 pos），新增 `MenuPortal`（createPortal 到 body、fixed 定位）/`openMenuAt`（left/right 两种锚定，右缘按钮锚 right 防顶出屏）——修 `···` 菜单被工具栏裁掉看不到的缺陷；外点关闭逻辑兼容 portal（btnRef/menuRef 双判）
- 已知限制：菜单开着时改窗口大小不重算锚点（外点即关，影响可忽略）
- 验证：lint/build 双绿；Chrome DevTools 实测——rail 开启态工具栏正确折叠、`···` 与 `更多` 菜单完整渲染且贴锚、源码标题聚焦 `box-shadow:none` + 底边线 `rgb(47,111,94)`

## E3 轮纪要 ✅

- **阅读模式补题头**：preview 分支加 `.mdw-reader` 包裹层（原 720px 上限/居中/内边距从 article 上移），标题渲染为 `.mdw-reader-title`（28px/700/字距 -0.025em，与 live `.mdw-lp-title` 同语言，overflow-wrap:anywhere 防长词溢出）；空标题不渲染 h1
- 容器查询同步：`.mdw-reader` 并入 960/640 两档内边距与 640 档标题 24px
- 排查记录：`renderMarkdownHtml` 仅产 code/b（无链接/hr），阅读样式无缺口；`.mdw-preview article` 原 720px 约束实测有效（截图目测 890px 系缩放误差，DOM 实测正文 574px）
- 验证：lint/build 双绿；浏览器实测阅读态——题头 28px 两行渲染、article 为题头兄弟节点、正文接排
