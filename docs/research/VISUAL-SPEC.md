# nx-kv 看板视觉规范 v1（基于实测，不基于感觉）

> 方法：真实 Chrome（CDP，`browser-harness`）逐站量 `getComputedStyle` + `getBoundingClientRect`，
> 原始记录在 `_scripts/rec/*.json`，截图在 `shots/*.png`；源码侧读了 plane / wekan / kanboard / focalboard
> 的主题文件。**下面每个数字都是量出来的**，不是猜的。

## 0. 实测基线（用来对照，不要凭记忆改）

| 参照 | 底/面 | 文字层级 | 字号/行高 | 圆角 | 细线 | 行高 |
|---|---|---|---|---|---|---|
| **Trello**（trello.com，实测） | `#FFFFFF` | `#292A2E` / `#505258` / `#6B6E76` | 14/20、12/16、标题 w653 | 4 / 6 / 9999 | `rgba(11,18,14,.14)` | 20·32·40·48·60px |
| **GitHub Issues**（Primer，实测） | `#FFFFFF` / `#F6F8FA` | `#1F2328` / `#59636E` / `#818B98` | 14/21、12/18 | 6 / 3 / 9999 | `#D1D9E0` | ≈36px |
| **GitLab work items**（实测） | `#ECECEF` | `#3A383F` | 14/21 | 8（上圆角） | — | 36px |
| **Plane**（tokens 源） | `#FFFFFF`/`#F7F7F7`/`#E8E8E8` | `#171717`/`#3A3A3A`/`#525252`/`#828282`/`#A3A3A3` | 9/10.8/12.6/14.4/16.2/18/21.6/27/36 | 3/10/20/50/9999 | `#F5F5F5`/`#E5E5E5`/`#D4D4D4`/`#B9B9B9` | — |
| **Wekan**（minicard 源） | `#fff` | `#4d4d4d` / `#999` | 标题 14 | 6 | — | 卡片 min 36 / 40 |
| **Kanboard**（light 源） | `#FFF`/`#fbfbfb` | `#333`/`#777`/`#dedede` | — | 2 / 5 / 6 | `#eee` 全网格 | — |
| **Focalboard**（源） | — | — | 14/24；`text-75`=12/16；标题 Metropolis 600 | 4 | — | 4px 间距刻度 |

Trello DS token 值得抄的三个：`--ds-border:#0B120E24`（14% 黑发丝线）、`--ds-shadow-raised: 0 1px 1px #1E1F2140, 0 0 1px #1E1F214F`（1px 环 + 1px 影）、`--ds-font-weight-bold: 653`。
Plane 的 `text-100/200/300/350/400` + `border-100/200/300/400` 命名值得抄：**每一层都要有名字**，别用"浅灰/深灰"。

## 1. 方向（只选一个）

**工业仪表盘 / dense console：暖中性纸面 + 1px 发丝网格 + 等宽机器数据 + 单一墨色主操作色，状态只靠色点和数字，不用彩色块。**
理由三条：① Trello、GitHub、Plane 三家的实测行高都在 32–48px、文字层级都是"标题 14/600 + 元信息 12/400"，
而 nx-kv 现在的一行 ≈73px（10 上边距 + 20.25 标题 + 14.7 路径 + 18.5 摘要 + 10 下边距），是它们的两倍 —— 密度是差距的主因，不是圆角和阴影；
② 三家的"高级感"都来自**发丝线 + 单层中性面 + 文字层级**，没有一个靠彩色渐变或卡片投影（Wekan 每张卡 `0 2px 3px rgba(0,0,0,.15)`，
Trello 每张卡 `0 1px 1px + 0 0 1px` —— 前者做成卡片汤，后者才像桌面）；
③ nx-kv 的数据本质是**机器数据**（路径、计数、倒计时），Trello/Focalboard 的等宽 + tabular 数字是天然解，
所以方向定为"仪表盘"而不是"友好 SaaS"。

## 2. 字号刻度（px / 字重 / 行高）

| 角色 | 字体栈 | 字号 | 字重 | 行高 | 颜色 |
|---|---|---|---|---|---|
| 看板标题 | `--label` | 14 | 600 | 18 | `--ink` |
| 行标题（目录名） | `--ui` | 13.5 | 650 | 19 | `--ink` |
| 路径（机器） | `--mono` | 10.5 | 400 | 14 | `--mid`（末段 `--ink-2`） |
| 现状摘要 | `--ui` | 11.5 | 400 | 16 | `--ink-2` |
| 状态行（点+文字） | `--ui` | 12 | 400 | 17 | `--ink-2` |
| 计数（待领/已领/已删） | `--mono` | 10.5 | 400 / 数字 650 | 14 | 数字 `--ink`，标签 `--mid` |
| 倒计时 | `--mono` | 11 | 650 | 14 | `--ink-2`；临期 `--warn` |
| 表头 | `--label` | 10.5 | 600 | 14 | `--mid`，**中文不加字距、不大写** |
| 按钮 | `--ui` | 12 | 500 | 16 | 见 §4 |
| 空状态标题 / 副文 | `--ui` | 12.5 / 11.5 | 600 / 400 | 17 / 15 | `--ink-2` / `--mid` |

注：`font-weight:650` 在 Segoe UI Variable 上可用，但 `--label`（Bahnschrift）是静态字体，650 会被吸附成 700。
**规则：只用 `--label` 的地方一律 600；650 只留给 `--ui`（可变字体）。** 全局 `font-variant-numeric: tabular-nums` 保留。

## 3. 间距刻度（4 / 8 基）

`4 · 8 · 12 · 16 · 24 · 32`

| 位置 | 值 |
|---|---|
| 单元格纵向内边距 | 6px（行高 46–52px 的关键） |
| 单元格横向内边距 | 12px |
| 行内元素 gap | 8px（色点与文字 6px） |
| 表头 | 6px 12px |
| 看板块之间 | 16px（工具栏→表格、表格→归档区） |
| 页面横向内边距 | 20px（`main`），最大宽 1240px 保持不变 |
| 行与行之间 | 0（靠 1px 发丝线分隔，不靠间距） |
| 空状态上下留白 | 32px |

## 4. 颜色角色（全部是中性 + 4 个语义色，**没有紫色渐变**）

```
--canvas   #F5F4F1   页面底（微暖）
--surface  #FFFFFF   卡片/看板面
--surface-2 #F1F0EC  表头 / hover / 折叠区
--hairline #E4E2DC   1px 发丝线（次级）
--hairline-strong #D5D2C9  1px 发丝线（强调/表头下沿）

--text-1 #16181C   标题、主操作
--text-2 #4B515A   次级文字、摘要
--text-3 #838A93   元信息、路径、计数标签
--text-4 #A9AEB4   占位符 / 禁用

--accent  #16181C   主按钮、选中标记（墨色，不用蓝紫）
--live    #216E4E   活着 / 已领取（取自 Trello --ds-text-success）
--info    #1558BC   等待中（取自 Trello --ds-text-information）
--warn    #9E4C00   临期 / 已到点（取自 Trello --ds-text-warning）
--danger  #AE2E24   已删除 / 破坏性动作（取自 Trello --ds-text-danger）
```

改名对照（当前文件 → 本规范）：`--paper→--surface`、`--canvas #f7f6f3→#F5F4F1`、`--soft→--surface-2`、
`--line→--hairline`、`--soft-2→--hairline-strong`、`--ink→--text-1`、`--ink-2→--text-2`、`--mid→--text-3`、
`--live #1f7a4d→#216E4E`、`--warn #99690f→#9E4C00`、`--danger #b3261e→#AE2E24`、新增 `--info #1558BC`、`--text-4`。
另外新增一个正文变量，把 `body` 上那串字体栈提出来复用（`--ui`）：
`--ui: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;`
`--label`（Bahnschrift）只用于**列标题与面板标题**，`--mono` 只用于**机器数据**（路径 / 计数 / 倒计时 / 时间）。

语义色**只用于状态点和数字**，不做整块底色。`--live` 从 `#1F7A4D` 调到 `#216E4E`：前者偏草绿，后者是 Trello 实测的
"成功文字"色，浅底上更清楚。

## 5. 行骨架（目标行高 46–52px，目录格压到 2 行）

```
┌──┬──────────────────────────────┬─────────────────┬──────────────┬────────┐
│▎ │  proj-nx-kv  [全局池]  D:/…/nx-kv │  ● 等待中         │ 剩余 04:12:33 │   ⋯    │
│  │  agent 正在回填 v0.9 队列…      │  3/7 待领 · 2 已领 │ 截止 21:30    │        │
└──┴──────────────────────────────┴─────────────────┴──────────────┴────────┘
 ▎ = 2px 状态导轨        ⌷ 计数=文字+数字，不是药丸
```

元素顺序：**[勾选] 状态导轨｜目录名+徽章+路径(同行)｜现状摘要(第2行)｜状态点+状态｜计数｜倒计时+截止｜⋯**

视觉重量落在**目录名（13.5/650, text-1）**和**倒计时（等宽 11/650）**两处，其余全部降到 text-3。
现状摘要第 2 行 1 行截断（`ellipsis`），不要让它换行把行高撑开。

## 6. 状态

| 状态 | 视觉变化 |
|---|---|
| hover | 行底色 `--surface-2`（`#F1F0EC`）；操作列 `⋯` 由 opacity .45 → 1；**不要**改边框颜色 |
| 选中行（已展开队列） | 底色 `--surface-2` + 首列 `inset 2px 0 0 var(--ink)`；导轨变 `--text-1` |
| 等待中（有 agent 阻塞） | 状态点 `--info` + 2px 光晕环 `0 0 0 3px rgba(21,92,188,.14)`；导轨 `--info` |
| 已领取 / 进行中 | 状态点 `--live` + 同款光晕环；导轨 `--live` |
| 空闲 | 状态点空心环 `inset 0 0 0 1.5px var(--text-4)`；导轨 `--hairline-strong` |
| 已到点（目标过期） | 倒计时文字 `--warn` + 左侧 2px `--warn` 短导轨；**不加红色**（到点是预期内，不是错误） |
| 有未领取工作（待领 > 0） | 「待领」数字用 `--text-1`/650 加重；行导轨加 1px 顶端刻痕（`inset 0 1px 0`），其余不变 |
| 空状态 | 26px 标记 + 标题 12.5/600 + 副文 11.5/400，居中，上下 32px 留白；**不要**用插画或表情 |

## 7. 五个"贵"的动作（都可直接落地）

**① 每行一条 2px 状态导轨（不是只在选中时）**
```css
.directory-board tbody tr { --rail: var(--hairline-strong); }
.directory-board tbody tr td:first-child { box-shadow: inset 2px 0 0 var(--rail); }
.directory-board tbody tr[data-state="waiting"] { --rail: var(--info); }
.directory-board tbody tr[data-state="live"]    { --rail: var(--live); }
.directory-board tbody tr.is-active             { --rail: var(--text-1); }
```
依据：Wekan 的 minicard 用 `inset 3px 0 0 0 #f2c94c` 画标签色条 —— 一列对齐的色条是看板最省力的"贵"。

**② 发丝环影取代投影（照抄 Trello `--ds-shadow-raised`）**
```css
:root { --shadow-ring: 0 0 0 1px rgba(22,24,28,.08); }
.board-table-wrap { box-shadow: var(--shadow-ring); }   /* 删掉 --shadow 的 0 10px 28px -16px */
```
看板是"仪表"，不是"卡片堆"：任何一块都不许浮起来。

**③ 路径做成等宽芯片，祖先目录变暗**
```css
.board-cwd { font: 400 10.5px/14px var(--mono); }
.board-cwd .anc { color: var(--text-3); }
.board-cwd .leaf { color: var(--text-2); }
```
渲染成 `D:/code/a_js/` + `proj/nx-kv`（后段高亮），悬停加 1px 下划线，点击复制。路径变成"可扫的标签"，
而不是一坨挤在一起的灰色长串。

**④ 倒计时做成定宽字段（tabular），临期才变色**
```css
.board-goal-label {
  display: inline-block; min-width: 96px; text-align: left;
  font: 650 11px/14px var(--mono); font-variant-numeric: tabular-nums;
}
.board-goal-label.urgent { color: var(--warn); }
```
定宽 96px + 等宽数字 = 刷新时数字不左右跳；临期只换颜色、不闪背景（闪背景是最廉价的"高级感"）。

**⑤ 操作列收敛成一个 `⋯`（196px → 96px）**
```css
.directory-board .board-ops { width: 96px; text-align: right; }
.directory-board .board-ops .btn { opacity: .45; }
.directory-board tbody tr:hover .board-ops .btn { opacity: 1; }
```
把「登记队列 / 设置时间目标 / 取消等待 / 移除目录」收进一个溢出菜单。
**这是单笔收益最大的改动**：多出来的 100px 全部给目录列，表格立刻从"表单"变成"看板"。

## 8. 该删的（直说）

1. `--shadow` 里 `0 10px 28px -16px rgba(...)` —— 整个面板不该有模糊投影，换成 1px 环（§7②）。
2. `board-summary` 上的 `cursor: zoom-in` —— 它点开的是弹窗不是缩放，这是骗人的光标；改成 `cursor: text` + 悬停虚线下划线。
3. `.tag` 的 `border-radius: 999px` 药丸 —— 「全局池」「已登记」是**身份**，不是状态；改 4px 半径的描边 chip（10.5px/600）。
4. 看板固定列宽 `board-ops: 196px` + 三个常驻 ghost 按钮 —— 见 §7⑤。
5. 三档近乎相同的暖灰 `--canvas #f7f6f3` / `--soft #f2f1ed` / `--soft-2 #e5e3de` —— 收敛成 `--canvas` + `--surface-2` 两档，其余用 alpha 黑推。
6. `.directory-board thead th` 上的 `text-transform:uppercase` + `letter-spacing:.04em` —— **中文无效**，只对拉丁文表头保留；中文表头靠字号/颜色分层（代码注释里已经写了这个坑，别再踩）。
7. `.board-count { letter-spacing: -0.01em }` —— 10.5px 上看不出来，还跟 `tabular-nums` 打架，删。
8. 全局 `tbody tr + tr td { box-shadow: inset 0 1px 0 var(--soft) }` —— 和看板自己的 `border-bottom` 叠成双线，看板里必须取消（保留发丝线一条）。
9. `.directory-board .board-check { width: 34px }` 的空白勾选列 —— 34px 常驻只为一个 13px 的框；改成 28px。

## 9. 别学这些（反模式）

- **Kanboard 的全网格**：`th/td` 都 `border: 1px solid #eee`，一眼就是 2012 年后台。→ 看板只画**横向发丝线**，不画竖线。
- **Wekan 的卡片汤**：每张 minicard `box-shadow: 0 2px 3px rgba(0,0,0,.15)`，列表一长就糊成一片。→ 卡片汤 = 廉价。
- **Trello 模板页的十色强调**（lime/magenta/teal/…）加上巨型彩色缩略图：消费级 SaaS 味。→ 状态色最多 4 个，且只做点/数字。
- **GitHub Issues 的药丸堆**（一堆 `9999px` 圆角标签 + 12/18 元信息）：信息在，但一眼"组件库 demo"。→ 计数用文字+数字，不用药丸。
- **Plane 的 token 膨胀**（primary 色阶 10 档、间距按 Tailwind 90% 缩放出十几档）：抄它的**命名分层**，别抄它的**数量**。
- **紫色渐变 / 玻璃拟态 / 大圆角 / 表情符号**：一律不要。面板必须完全离线，渐变与阴影在廉价屏上最先露馅。
- **整行高亮**：选中行只加左标记 + 极浅底（已在做），不要整行铺饱和色。

## 10. 验收清单（实现完逐条量）

- [ ] 任意一行的 `getBoundingClientRect().height` ∈ [46, 52]px
- [ ] 行内只出现 3 个字号（13.5 / 11.5 / 10.5）+ 状态行 12
- [ ] 看板面上 **0 处** `box-shadow` 含 blur ≥ 8px
- [ ] 面板里 **0 处** `border-radius: 999px`（除状态药丸，状态药丸要删）
- [ ] 看板范围内 **0 处** `border-radius: 999px`（`.pill` / `.toggle` 不在看板上，保留）
- [ ] 计数列刷新 3 次，数字左右不位移（tabular-nums 生效）
- [ ] 选中行 / 等待中 / 已到点 三种状态的导轨颜色不同，且只靠 1 个 2px 元素区分
- [ ] `grep -n "999px" style.css` 的命中只剩 `.pill` 与 `.toggle`
