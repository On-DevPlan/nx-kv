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
- [x] E4 空态：live 空文档渲染幽灵引导「输入正文，或键入 / 唤起命令…」，点击聚焦首块；占位文案此前已齐（live 块/源码/标题）
- [ ] 窄屏 ≤960 编辑器复核：标题 24px 已有；工具栏溢出菜单与标题共存、状态栏收纳
- [x] E5 长词/URL 溢出复核：live 块/阅读态/标题均无横向溢出（实测 323 字符长链：live view 与 pane scrollWidth 均未超）
- [x] E5 保存与反馈：Ctrl/⌘S 提交（标题/live 块/源码三处可达）、页签未保存圆点
- [x] E6 撤销/重做：**格式操作不可撤是真缺陷**（程序化改写冲掉原生 undo 栈）——新增文档级历史栈，Ctrl/⌘Z / Ctrl/⌘⇧Z / Ctrl+Y 可撤销格式操作与输入段
- [x] E7 快捷键速查面板：Ctrl/⌘ / 或工具栏问号唤起，15 条键位分三组
- [x] E7 撤销/重做后光标回到改动处（源码模式精确）
- [x] E8 live 模式撤销后光标定位：正文偏移→块→块内偏移换算，跨块撤销会跳到目标块并接管焦点
- [ ] serve 的 index.html 缺 no-cache 头（E4 记，待用户拍板）
- [x] E9 live/预览模式查找：此前只有源码模式有查找条，预览态只能靠浏览器原生查找——补块级查找（n/m 计数 + 命中块高亮 + 滚动定位）
- [x] E11 预览态划选后按格式键生效：此前预览态划选文字按 Ctrl/⌘B/I/E/K 完全无效——改为切编辑态保留选区后直接套格式
- [x] E4 无障碍：aria-label 补齐（正文块/正文源码/查找↑↓×/插入图片/添加附件，标题 E1 已带）；状态栏与切换钮 10.5px 小字 mid(4.0:1)→ink-2(过 WCAG AA 4.5:1)

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

## E4 轮纪要 ✅

- **空文档幽灵引导**：`splitMdBlocks('')` 返回 `['']`——空文档实为一个隐形空块，视觉上是无法进入的空白。新增 `emptyDoc` 判定（全空块），空文档时隐藏空块（`.is-empty-doc .mdw-lp-block:not(.is-edit)`）、渲染 Notion 式幽灵引导条，点击 `setFocus(0)` 直接进入首块编辑，聚焦后引导让位给 textarea 占位符——首击即达，不用先凭空点中隐形条
- **无障碍**：live 正文块/源码 textarea/查找导航↑↓×/插入图片/添加附件补 aria-label（此前仅 title 提示）；状态栏与切换钮小字对比度 mid→ink-2 过 WCAG AA
- **新发现（记入议题池待拍板）**：serve 对 index.html 未发 `Cache-Control: no-cache`，升级构建后浏览器可能继续跑旧 bundle——本轮实测踩中（`navigate url` 命中强缓存，新逻辑"不生效"，强刷才恢复）。属 server 行为（src/runtime/server.js），超出编辑器循环范围，留用户决策
- 验证：lint/build 双绿；浏览器实测（强刷后）——空文档引导渲染、点击聚焦首块、占位符接续、草稿丢弃无残留

## E5 轮纪要 ✅

- **Ctrl/⌘S 保存**：专业编辑器标配，此前只有工具栏按钮可达。标题（TitleArea）、live 块、源码 textarea 三处键位统一 `mod+S` → preventDefault + 提交；`onSave` 由 view.jsx 的 `submit` 经 MdPanes 下发
- **未保存标记**：view.jsx 维护 `dirtyIds`（标题/正文/附件改动挂点，保存/提交成功后摘除；切换模式不算改动），TabBar 以可选 `t.dirty` 渲染一颗强调色圆点（`aria-label="有未保存修改"`）——共享组件保持纯展示、向后兼容
- **溢出复核**：草稿正文塞 323 字符无空格长链 → live 视图与面板均无横向溢出（`overflow-wrap:anywhere` 生效）
- 验证：lint/build 双绿；浏览器实测（强刷后）——标题改动即挂圆点、Ctrl+S 触发 `POST /api/localtasks`（用 fetch 拦截验证，**未真实提交**，toast 落拦截错误即为证）、草稿关闭后无残留

## E6 轮纪要 ✅

- **缺陷定位**：受控 textarea 里，格式工具/斜杠命令等**程序化改写**会冲掉浏览器原生 undo 栈——实测「Ctrl+B 加粗 → Ctrl+Z」毫无反应（`**` 仍在，len 58 不变）。原生撤销只能回退纯输入，专业编辑器该有的「撤销格式操作」缺失
- **文档级历史栈**（新增 `md-history.js`）：每文档一份 `{past, future}` 快照（存改动前的 `{title, body}`）；连续输入按 700ms 窗口合并成一条，格式/结构操作各自成条；栈上限 200 条；提交/保存后清空历史（不撤回到已落盘之前）
- **语义修正**：初版把「弹出的旧态」塞进 future，导致重做回到错误状态——改为撤销时存 current（撤销前所处状态）、重做时再弹回，redo 恢复正常
- **快捷键收口**：Ctrl/⌘S、Ctrl/⌘Z、Ctrl/⌘⇧Z、Ctrl/⌘Y 从各控件的局部键位，改为 `MdPanes` 上 **window 捕获阶段**统一接管（仅编辑区文本框：.mdw-editor/.mdw-lp-src/.mdw-lp-title/.mdw-title-input；查找框等保留原生撤销）。原因：局部键位依赖焦点，且原生 undo 与我们的历史栈会互相打架（实测真实按键序列曾出现一次撤销失效）
- 验证：lint/build 双绿；浏览器真实按键全链路——输入 `ab` → Ctrl+B 加粗（58）→ Ctrl+Z 撤格式（54）→ Ctrl+Z 撤输入（53）→ Ctrl+⇧Z 重做（54）→ Ctrl+⇧Z 重做格式（58）；Ctrl+S 经 fetch 拦截验证仍触发提交（未真实提交）
- 备注：`node --test tests/unit/*.test.mjs` 存在**既有 flaky**（时序探针，两次跑分别 fail 1 / fail 0），与本轮改动无关

## E7 轮纪要 ✅

- **快捷键速查面板**（新增 `shortcut-sheet.jsx`）：15 条键位分「格式 / 编辑 / 导航与文件」三组，白纸浮层 + kbd 键帽；Ctrl/⌘ / 唤起（Notion 习惯，仅工作台范围内生效，侧栏输入框不受影响），工具栏新增问号按钮可直接打开；Esc / 点遮罩关闭；`role="dialog" aria-modal="true"`；第三组横跨整行排两列避免留白
- **图标集**：新增 `help` 图标（24 网格 / 1.8 线宽 / currentColor，遵 ft-svg 规范）
- **撤销/重做后光标回到改动处**：`md-edit-ops.js` 新增 `diffIndex`（公共前缀长度 = 改动起点），源码编辑器 API 增 `caretFromDiff(prev, next)`；view.jsx 撤销/重做回写后于 rAF 调用。实测：行首插入 `z`（len 53, caret 1）→ Ctrl+Z → len 52 且 **caret 回到 0**、焦点保持
- 已知限制：live 模式（块级）撤销后光标留在原处——块内偏移换算未做，已记入议题池
- 验证：lint/build 双绿；浏览器实测——速查面板按钮唤起/Ctrl+/ 开关/Esc 关闭/三组 15 条/两列布局、光标恢复、草稿页签清理干净（无残留脏点）

## E8 轮纪要 ✅

- **live 模式光标定位补齐**：LivePreview 的编辑器 API 增 `caretFromDiff(prev, next)`——先用 `bodyBlocksOnly` + `joinMdBlocks` 把正文偏移换算成「块序号 + 块内偏移」（块边界用真实 joiner 累加，连接符 `

` 与实际拼接口径一致），改动块正在编辑则直接 `setSelectionRange`，否则走 `pendingSelRef` + `setFocus` 让 LiveBlock 恢复选区
- **修焦点缺失**：LiveBlock 的 pending 选区分支原先跳过了 `el.focus()`——跨块撤销后虽然选区对了但拿不到 DOM 焦点（连带影响格式操作后的选区恢复）。补上 `el.focus()` 后，撤销会「跳到改动处并接管编辑」
- 验证：lint/build 双绿；浏览器实测——块内改动后撤销：caret 精确回 0、块仍在编辑、焦点保持；跨块撤销：从第 5 块撤销第 2 块的改动 → 自动跳到第 2 块、caret 0、焦点跟随

## E9 轮纪要 ✅

- **真功能缺口**：查找此前只在源码模式可用——实时预览/阅读态没有任何应用内查找（只能退回浏览器原生查找，体验割裂）。补齐为块级查找：
  - `LivePreview` 新增查找状态（query/index/open）与块级匹配（对每个块做不区分大小写的全量匹配，记录块号与位置）
  - 复用源码态的 `EditorFindBar` 组件（同一套视觉与键盘：Enter/⇧Enter 跳、F3 继续、Esc 关闭）
  - 命中块加 `.is-hit`：柔和强调底 + 左侧强调条；跳转时 `scrollIntoView({block:'center'})` 把命中块带到视口中央
  - `LivePreview` 编辑器 API 增 `openFind()`；`MdPanes` 的 window 捕获层在非源码态接管 Ctrl/⌘F（源码态仍由编辑器自己处理，避免双触发）
- 验证：lint/build 双绿；浏览器实测——Ctrl+F 唤起且输入框自动聚焦；长任务正文查「任务」得 9 处匹配（1/9 → Enter 到 2/9）；草稿多块文档查「验收」精确命中第 3 块并高亮（1/1，data-i=2）；查找条 Esc 可关；草稿关闭后无残留

## E10 轮纪要 ✅（收口）

### E 系列能力对照（横向基线 Obsidian / Typora / VS Code / Notion）

| 能力 | R 系列 | E 系列补齐 | 轮次 |
|---|---|---|---|
| 标题软换行 | 仅正文 | live/源码标题自动增高 textarea，回车交焦正文 | E1 |
| 工具栏层级 | 一排灰药丸 | 三簇 hairline 分组 + 格式组去容器 + 次级动作去描边 | E2 |
| 自适应机制 | 视口媒体查询 | 容器查询三级折叠（修 rail 开启即裁按钮） | E2 |
| 溢出菜单 | 被 overflow 裁掉 | portal 到 body + 左/右锚定 | E2 |
| 焦点语言 | 标题吃全局光晕 | 零 chrome + 强调色下划线 | E2 |
| 阅读态题头 | 无 | 题头与正文同轴同宽 | E3 |
| 空态 | 一片空白 | Notion 式幽灵引导，点击聚焦首块 | E4 |
| 无障碍 | 部分 | aria-label 补齐 + 小字对比度过 AA | E4 |
| 保存 | 仅工具栏按钮 | Ctrl/⌘S + 页签未保存圆点 | E5 |
| 撤销/重做 | 无（格式操作不可撤） | 文档级历史栈 + 光标归位 | E6–E8 |
| 快捷键可发现性 | 仅 tooltip | 速查面板 15 条键位 | E7 |
| 预览态查找 | 无 | 块级查找 + 命中高亮 + 滚动定位 | E9 |

### 回归验证（E10）

- `pnpm run lint` ✅　`pnpm run build` ✅
- `pnpm run test:smoke` ✅ 158/158　`pnpm run test:unit` ✅ 247/247
  （注：单测里有一条时序探针曾偶发 fail，本轮及前几轮多次复跑均通过，非本次改动引入）
- 浏览器总复验：标题 2 行不裁剪 · 工具栏三簇 · 速查面板按钮在位 · live 查找条可唤起 ·
  改动挂未保存点并已还原 · 草稿页签全部清理（无残留脏点）

### 留待用户拍板 / 未做

- **serve 的 index.html 未发 `Cache-Control: no-cache`**（E4 实测踩中：升级构建后浏览器可能继续跑旧 bundle，
  强刷才恢复）。属 server 行为（`src/runtime/server.js`），超出本循环「只动编辑器」纪律，未擅自修改
- live 查找命中块**不自动切到编辑态**（保持阅读观感，有意为之）；若要像源码态那样选中文字需另做
- live 模式下「选区浮动格式条」仅覆盖渲染态划选，块级操作（复制/删除/上下移动块）未做——超出本轮范围

## E11 轮纪要 ✅（计划外补轮：迭代计数延后触发的一轮）

- **补齐预览态格式快捷键**：此前在实时预览（阅读态渲染）划选文字后，Ctrl/⌘B/I/E/K **完全无效**——格式键只在 textarea 内被接管，而渲染态没有 textarea。这是与 Notion / Typora 的明显差距
- **做法（不新增浮层）**：划选后按格式键 → `LivePreview.formatSelection(op)` 读当前选区，定位到所属块，用选中文本在块原文里的位置恢复选区（`pendingSelRef`），并记下待套操作（`pendingFormatRef`）→ 块切到编辑态后，LiveBlock 的 effect 先恢复选区、再就地套用格式并回写
- **保守边界**：选区文本在块原文中找不到（跨 markdown 标记等）时直接放弃，不做错位改写；套格式时同步收起任务菜单，避免两个浮层打架
- 验证：lint/build 双绿；浏览器实测——预览态划选「目标：为」→ Ctrl+B → 该块切编辑态且文本变为 `**目标：为**`、焦点跟随；随后 Ctrl+Z 还原，页面刷新确认内容与脏点均无残留（真实任务页零改动）

## 循环结束记录（loop-2 · 仅轮次 ×10 · 无完成承诺）

### 提交序列（12 个独立 commit，可逐个回滚）

| 轮 | 主题 | commit |
|---|---|---|
| 基线 | 上一会话遗留 R1–R7c 落地（先修 lint） | `3ee6e94` |
| E1 | 标题自动换行（自动增高 textarea + 回车交焦正文） | `d71e66f` |
| E2 | 工具栏分层 + 容器查询折叠 + 溢出菜单 portal | `c94f9b8` |
| E3 | 阅读模式补题头 | `e9c4994` |
| E4 | 空文档幽灵引导 + 无障碍扫尾 | `636788b` |
| E5 | Ctrl/⌘S 保存 + 页签未保存圆点 | `9cce012` |
| E6 | 文档级撤销/重做（格式操作可撤） | `060faf4` |
| E7 | 快捷键速查面板 + 撤销后光标归位 | `274c6bc` |
| E8 | live 模式光标定位 + 修跨块撤销失焦 | `9da1d83` |
| E9 | 实时预览块级查找 | `1043269` |
| E10 | 收口：能力对照表 + CHANGELOG + 回归结论 | `8c1e214` |
| E11 | 预览态划选后按格式键直接生效 | `774f9fc` |

### 最终质量门（E12 · 迭代计数触发的最后一轮）

- `pnpm run lint` ✅　`pnpm run build` ✅　`pnpm run test:smoke` ✅ 158/158　`pnpm run test:unit` ✅ 247/247
- 浏览器回归（E11 改动过的 LiveBlock 效果路径）：实时预览打字 ✅ · Enter 拆块 ✅ ·
  行首 `/` 命令菜单 9 项 ✅ · Esc 关闭 ✅ · Ctrl+Z 撤销 ✅ · 草稿清理后无残留脏点 ✅
- 工作区干净，无未提交改动；真实任务页数据零改动（所有交互验证都在内存态草稿完成）

### 四个被修掉的真缺陷（非样式级）

1. **格式操作完全不可撤销** —— 受控 textarea 的程序化改写冲掉原生 undo 栈（Ctrl+B 后 Ctrl+Z 无反应）
2. **进程 rail 一开，左簇按钮被静默裁掉** —— 自适应走视口媒体查询，容器窄了却不折叠
3. **溢出菜单被裁得根本看不见** —— 行内 absolute 定位撞上工具栏 `overflow:hidden`
4. **预览态格式快捷键失效** —— 渲染态没有 textarea，格式键无人接管

### 仍待用户拍板（未擅自修改）

- `serve` 的 index.html 缺 `Cache-Control: no-cache`（server 层，超出本循环「只动编辑器」纪律；实测升级后浏览器会跑旧 bundle）
- 块级操作（复制/删除/上下移动块）、live 查找命中后直接选中文字 —— 属产品决策
