# nx-kv「本地任务」目录看板 · 视觉评估

> 快照 2026-10-21 21:10 · 隔离 store（`NX_KV_LOCALTASK_STORE=.tool/visual/lt.json`）· 面板 :7955 · 未碰 `~/.nx-kv/`
> 被测：`src/web/frontend/style.css`（773 行）+ `src/modules/localtask/view.jsx`；**没有**改 `src/`、`tests/`、`assets/`，没有跑 build
> 量法：独立 headless Chrome + CDP，`Emulation.setDeviceMetricsOverride` 锁 1280×900 与 700×900（dpr=1）；所有数字来自 `getComputedStyle` / `getBoundingClientRect`，控制台错误 0 条
> 数据：4 目录 + 全局池、待领/已领/已删混合、1 个目录 agent 等待中、5h / 90m / 30m 目标各一、1 个已到点目标

## 截图

| 文件 | 内容 |
| --- | --- |
| `shots/board-1280.png` | 1280×900 视口：板子 + 队列面板 |
| `shots/board-1280-full.png` | 1280 整页（1160px） |
| `shots/board-700.png` | 700×900 窄屏（侧栏宽度） |
| `shots/board-700-full.png` | 700 整页（1321px） |
| `shots/ref-gitlab.png` | 对比基准：GitLab 工作项列表（实测量） |

## 实测现状

**字体**：正文 `"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`，**13px / 19.5px**，`font-variant-numeric: tabular-nums`；表头/标题 `--label`（Bahnschrift）；路径·计数·时间 `--mono`（ui-monospace）。

**色板**（`:root`）：`--ink #16181c` / `--ink-2 #4b515a` / `--mid #838a93` / `--paper #fff` / `--canvas #f7f6f3` / `--soft #f2f1ed` / `--soft-2 #e5e3de` / `--line #e7e5e0` / `--live #1f7a4d` / `--warn #99690f` / `--danger #b3261e`。圆角 `--radius 10px` / `--radius-sm 7px`；阴影只用 `--shadow-sm 0 1px 2px rgba(22,24,28,.05)`（表格框·工具栏）与 `--shadow 0 1px 2px rgba(22,24,28,.05), 0 10px 28px -16px rgba(22,24,28,.18)`（弹窗·卡片）。

**表格几何**：`table-layout: fixed` / `border-collapse: separate` / `min-width: 780px`。表头 th：padding `7px 12px`、10.5px Bahnschrift 600、`letter-spacing .42px`、uppercase、色 `--mid`、底 `--soft`、底线 `1px --line`。单元格 td：padding `10px 12px`、`vertical-align: top`、底线 `1px --line`。
- **实测列宽：30 / 324 / 324 / 324 / 196**（合计 1198）
- **实测行高：77.7 / 85.75 / 93.39 / 93.39 / 92.39**（5 行 = 443px）
- 目录格 4 段：名 13.5px/650、路径 mono 10.5px、现状 11.5px、提交说明 11.5px（现状 300px 容器装 331px 文字 → 截 31px；700px 时容器 160.66px → 截掉一半）

**层级统计**：全页 **8 种字号**（10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 13.5）、7 种文字色、4 种字重（400/600/650/700）、3 种底色、3 个字体族。

**版面**：header 57.75px（`0 1px 0 --soft-2`）；main `padding 18px 20px 28px` / `max-width 1240`；板子工具栏 46px；表格框 1198×443（radius 10 + `1px --line` + shadow-sm）；归档卡 102px @ y=617；**队列输入框在 y=722**；页面总高 1160（1280 视口）/ 1321（700 视口）。

**队列面板**：工具条 40px，6 个子元素横排（label 36 / select 261×33 / 说明 336.89 / sep 1 / **textarea 428×40** / 按钮 89×31.5），`gap 8px` + `flex-wrap: wrap`。队列表 1192 宽，列 `30/46/710/78/172/156`，行高 45，正文 12.5px/18.125。折叠区 summary 12px/400、padding `6px 10px`、原生三角 `disclosure-closed`、色 `rgb(22,24,28)`。

**眼睛先去哪**：① 唯一高饱和色 = assets 行绿点（`--live` 6px + `0 0 0 3px rgba(31,122,77,.12)` 光晕）；② 两个近黑实心块（右上「看板设置」、队列「回填新任务」）；③ 全局池行的 2px 墨条。其余全是 `--mid` 灰 —— **「谁在等我」只有 1 处信号，「哪个已经超时了」0 处信号**。

---

## 哪里看起来廉价 / 不对（按视觉伤害排序）

**1. 三列等宽 —— CSS 里写的 40% / 18% / 19% 根本没生效。**
症状：目录、本地任务、时间目标三列一样宽（各 324px），现状被压成 300px 的省略号，而「操作」列占掉 196px。
成因：`table-layout: fixed` 只认**第一行（thead th）**的宽度；列宽规则 `.board-directory{40%} / .board-task-state{18%} / .board-goal-state{19%}`（style.css:429-431）写在 **td** 上，th 只有 `board-check`(30) 与 `board-ops`(196) 有类 → 剩下 972px 被三列平分 = 324。实测 th：30/324/324/324/196。
改法：加 `<colgroup>`（38% / 15% / 16% / 190px）或把同名 class 挂到 th 上。**改 4 行 CSS，收益最大。**

**2. 目录格塞了 4 段文字，行高 93px，看板扫不动。**
症状：每行要读「名+徽标 / 路径 / 现状 / 提交说明」四段，且现状与提交说明双双被截成「…」。
成因：四个块都是 `display:block`（`.board-cwd` mono 10.5px、`.board-summary` 11.5px、提交说明 11.5px），td padding `10px 12px`，实测行高 77.7→93.39px。
改法：现状压到 1 行（`white-space: nowrap` + 12px），路径只留 basename（`D:\code\a_js\proj\nx-kv\docs` → `docs`，全路径进 `title`），提交说明并入现状的 hover/title；目标行高 ≤ 56px。

**3. 逾期的时间目标 = 「未设置」，同一套灰。**
症状：src 行「已到点（见归档区）」和全局池行「未设置」视觉完全一样（都 13px / `--mid`），超时 2 小时 24 分在板上等于隐形；真正信息被丢到板子下面那张独立白卡里。
成因：`/api/timegoals/all` 读时 `autoRecycle()`（timegoal/service.js:252-261）把已到点目标直接移进 archived，于是 `goal` 为 null，走 `archivedGoal` 分支渲染 `<span className="muted">已到点（见归档区）</span>`（view.jsx:985-987）；**`.board-goal-label.reached{color:var(--warn)}`（style.css:498）实测渲染数为 0**（`reachedLabels: []`）。
改法：行内保留琥珀（`--warn #99690f`）标签「已超时 2 小时 24 分」，别把逾期降级成灰。

**4. 同一列里两种时间格式。**
症状：30 分钟目标显示「剩余 5:47」，90 分钟显示「剩余 1:05:47」——「5:47」是 5 分还是 5 小时？
成因：`fmtClock()`（view.jsx:66-73）h>0 用 `h:mm:ss`，否则 `m:ss`。
改法：统一 `h:mm:ss`（不足 1 小时写 `0:47`），或统一人话；并按紧迫度换色（<15min `--warn`，<1h `--ink-2`）。

**5. 队列输入框是浏览器默认样式 —— 全页最扎眼的原生控件。**
症状：回填框 1px 灰边、0 圆角、monospace 13.33px；同一条工具带上却是 7px 圆角 `--soft` 底的选择器 + 近黑实心大按钮。两个年代。
成因：style.css:106 的 `input, select {}` 没覆盖 textarea，而队列用的是裸 `<textarea>`（实测 `className: ""`）：`border 1px solid rgb(118,118,118)`、`border-radius 0`、`padding 2px`、`font-family monospace`、`font-size 13.3333px`、高 40px。
改法：`textarea { font: inherit; border: 1px solid var(--soft-2); border-radius: var(--radius-sm); padding: 8px 10px; min-height: 56px; background: var(--paper); color: var(--ink); }`。

**6. 队列表的「操作」列塞不下 4 个按钮，「删除」被卡片边切掉。**
症状：1280 宽下「删除」按钮右半截被切（见整页图）。
成因：`.queue-table .c-ops{width:156px}`（style.css:344），4 个 42px 按钮 + 3px 间距 = **190px**；实测 `td.ops` scrollWidth 190 / clientWidth 156（超 34px）。
改法：`.c-ops` → 200px；或把「提前/置后」折进一个 `⋯` 菜单（GitLab 4 动作也是收在菜单里的）。

**7. 同一页两张表是两种表格语言。**
症状：板子表头是浅灰底 + 1px 底线 + Bahnschrift 小字；下面队列表表头**透明底、无线**、同样小字。像两个产品。
成因：`.directory-board thead th` 有 `background: var(--soft); border-bottom: 1px solid var(--line)`（style.css:408-420），而通用 `th`（style.css:319-327）两者都没有 → 队列表 th 实测 `background: rgba(0,0,0,0)`、`border-bottom: 0px none`。
改法：同页只能有一套表头 —— 给队列表 th 补 `background: var(--soft); border-bottom: 1px solid var(--line)`。

**8. 700px 窄屏：主操作列整列在屏幕外，工具条被拆成三行。**
症状：表格 min-width 780 > 可视 643 → 横向滚动条；「操作」列 196px（占表宽 25%）在屏外，只看得到「任务」；现状文字截掉一半；「回填新任务」按钮掉到第三行（工具条 40px → 120.5px）。
成因：`table.directory-board{min-width:780px}`（style.css:404）+ `.board-ops{width:196px}`（style.css:432）；`投递到` 说明 336.89px + textarea 283px 挤不进 645px。
改法：≤820px 改卡片式堆叠（名一行 / 现状一行 / 状态+目标一行 / 操作变 icon 菜单），`min-width: 0`；工具条窄屏改 `flex-direction: column` 让输入框整行。

**9. 行内操作按钮常态 50% 透明度，像 disabled。**
症状：每行 3 个按钮都是半透明灰块；真的 disabled（提前/置后到头）又是 40% —— 两态分不清。
成因：`.directory-board .board-ops .btn{opacity:.5}`（style.css:434）vs `.btn:disabled{opacity:.4}`（style.css:137）。
改法：常态 0.7、hover/选中 1；disabled 改用 `--mid` 文字色 + 无底色，别只靠 opacity。

---

## 对比基准（均为实测量；Kanboard demo DNS 不通、Linear 需登录，量不到）

| 参照 | 实测值 |
| --- | --- |
| **GitLab 工作项**（`shots/ref-gitlab.png`） | 行高 64px（padding `10px 16px`，无边框无圆角）；标题 14px/21px **600** `rgb(58,56,63)`；行内只有 **2 级字号**（14/600 标题 + 12/400 `rgb(98,97,104)` 元信息）；标签 12px/16px、radius **12px**、`0 0 0 2px` 同色 inset 描边；头像 24×24 radius 4px |
| **Plane**（登录壳可测） | Inter Variable 16px/24px；文字 `oklch(0.1689 0.0021 286.18)`、底 `oklch(0.9614 0.0013 286.38)`；小徽标 11px / padding 5px / radius 11px |
| **WeKan** | 卡片 radius **6px**、`1px solid rgba(0,0,0,.176)`、`0 8px 16px rgba(0,0,0,.15)`；正文 16px Roboto |
| **Trello** | 正文 14px/20px Atlassian Sans `rgb(41,42,46)`；卡片 radius **4px** |

**我们缺的 5 件事**（每条都带参照值）
1. **一行的字号只有 2 级。** GitLab 行内 14/600 + 12/400；我们的目录格就有 13.5 / 11.5 / 10.5 三级，全页 8 种字号、4 种字重。→ 收到 4 档：13.5 标题 / 12 正文 / 11 次要 / 10 机器数据。
2. **行高。** GitLab 64px（含副标题），Linear/Plane 单行约 32–36px；我们 77.7–93.39px。→ 目标 ≤ 56px。
3. **状态是胶囊不是裸字。** GitLab 标签 12px / radius 12px / 同色 inset 描边；我们「空闲 / 共享任务池 / 等待中」都是 12px 纯文字 + 6px 圆点，没有可点的药丸。
4. **负责人/头像锚点。** GitLab 每行右端 24×24 radius 4px 头像 + 12px 日期；我们的队列数据里明明有 `claimedByName`（「这条被谁领的」），板子上一眼却看不出这行归谁。
5. **逾期要有颜色。** GitLab 标签用饱和色（`rgb(209,0,105)`）和 2px inset 描边；我们超时 2 小时 24 分是 `--mid` 灰。

---

## Top 8 视觉改造项（按影响排序）

| # | 改什么 | 具体数值 / CSS | 工作量 |
| --- | --- | --- | --- |
| 1 | 修列宽（3 列等宽 → 40/15/16/190） | `<colgroup>` 38% / 15% / 16% / 190px，或把 `.board-directory` 等类挂到 th | **15 min** |
| 2 | 目录格瘦身：现状 1 行、路径只留 basename、提交说明并入 title | `.board-summary{font-size:12px;max-width:100%}`、`.board-cwd{content:basename}`；td padding `8px 12px`；行高 93 → ≤56px | **40 min** |
| 3 | 逾期显性化 | 行内加 `--warn #99690f` 胶囊「已超时 2 小时 24 分」（`font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(153,105,15,.12)`） | **20 min** |
| 4 | 时间格式统一 + 按紧迫度换色 | `fmtClock` 统一 `h:mm:ss`；<15min `--warn`、<1h `--ink-2`、其余 `--live` | **15 min** |
| 5 | textarea 套 token | 见上文第 5 条（`font:inherit; radius 7px; 1px --soft-2; padding 8px 10px; min-height 56px`） | **10 min** |
| 6 | 队列表头对齐板子表头 + 操作列加宽 | th 补 `background:var(--soft); border-bottom:1px solid var(--line)`；`.c-ops` 156 → 200px | **10 min** |
| 7 | 窄屏卡片式堆叠（≤820px） | `min-width:0`；行转 `display:grid` 2 列；操作列 196 → 36px icon 菜单；工具条 `flex-direction:column` | **60 min** |
| 8 | 归档卡收成一行，把队列面板顶上来 | 归档区默认折叠成一排「已到点 (1)」链接；板子+归档 722px → ≤560px，一屏多看 5 行队列 | **25 min** |

合计 ≈ 3 小时 15 分。（第 9 条「按钮 0.5 → 0.7」顺手做，1 min。）

## 不要动的东西

1. **状态色点 + 文字**（`.board-status::before` 6px 圆点 + 3px 同色光晕 + 12px 文字）—— 全板最省力又最像样的决定，共享池/空闲/待领/已领一眼可分，别退回成填充色块。
2. **机器数据一律等宽**（`--mono` + `tabular-nums`）—— 路径/编号/计数/时间不抖，Linear/Plane 都是这条路子。
3. **暖中性纸面色板**（`--canvas #f7f6f3` / `--paper #fff` / `--soft #f2f1ed` / `--line #e7e5e0`）—— 比纯灰有质感，是这个面板的底子，别往冷灰/蓝调改。
4. **1px 细线 + 10px 圆角 + `shadow-sm`** —— 克制，别加厚阴影或加圆角到 16px。
5. **表头用 Bahnschrift 10.5px/600/字距 .42px**（中文不加字距）—— 仪表刻度的质感，是辨识度来源，别退回系统默认粗体表头。
6. **选中行用 2px 左侧墨条 + `--soft` 底**（不是整行高亮）—— 很克制，保留。
7. **空状态** `.board-empty-mark` 虚线圆 + 标题 + 副标题 —— 是设计过的，别换成一行灰字。
8. **「已领取历史 / 已删除」折叠在队列表下方** —— 层级判断是对的，只调样式（summary 12px→12.5px/600、加 1px 分隔）不动结构。

---

### 附：复现方式

```powershell
$env:NX_KV_LOCALTASK_STORE = "D:\code\a_js\proj\nx-kv\.tool\visual\lt.json"
$env:NX_KV_TIMEGOAL_STORE  = "D:\code\a_js\proj\nx-kv\.tool\visual\tg.json"
node D:\code\a_js\proj\nx-kv\bin\cli.mjs serve --no-open --port 7955
node D:\code\a_js\proj\nx-kv\.tool\visual\py\run-measure.mjs   # 1280/700 量测 + 截图
```
播种脚本 `.tool/visual/seed.mjs`（4 目录 + 全局池 + 待领/已领/已删 + 阻塞 wait + 5h/90m/30m/已过期 timegoal）。
**注**：`assets` 的「等待中」是用改隔离 store 的 `waiting/waitingUntil` 复现的（该标志按「截止时刻未过」判活，见 localtask/service.js:353-358），面板渲染与真实 wait 进程完全一致。
