# Ralph loop · repos / cloud 两板块 UI/UX（手工 Ralph × 10）

> `nx-rp` 0.4.1 无 `loop` CLI（同 LOOP-MD-WORKSPACE 先例）；本会话手工 Ralph × 10。
> 目标：把「仓库」与「云端」两个 tab 的观感与交互对齐面板 v2 设计语言（青绿 #2F6F5E、
> 侧栏/MD 工作台为基准），消除 v1 遗留的工具栏混杂、弱空态、按钮平铺噪音。

## 任务

优化 `src/modules/repos/`（仓库）与 `src/modules/todo/`（云端）两个板块的 UI/UX：
分区、密度、空态、hover 交互、语义色、窄屏，全部对齐 v2 tokens。

## 结束模式

仅轮次 · max 10 · 无 promise（UI/UX 判据需人眼，跑满即停）

## 每轮协议

1. 读本文件 + `git log --oneline -5` 接上轮进度
2. 按路线图选本轮改动；实现
3. 门槛：`pnpm test` 全绿（lint + build + smoke + unit）；视觉改动起本地 serve 截图对照
4. 纪要落本文件；`git commit`（conventional commits，中文，本地不 push）。
   **只 add 本轮明确改过的文件，禁用 `git add -A`** —— 本仓库有并行会话
   在同一工作树干活（R2 曾卷入 md-workspace WIP，靠 soft reset 拆分补救）
5. 修不动则 revert 本轮 commit 并记录原因，轮次照常 +1

## 硬约束

- 不改后端 API / service 语义；不破坏 tests/unit/registry.test.mjs 三表契约
- eslint 分层：前端禁 import 模块 index.js / service.js / runtime / core
- 样式复用 style-v2.css tokens（--paper/--ink/--soft/--faint/--wait/--cloud/#2F6F5E）；
  两页存量样式主要在 style.css（v1 文件，1177 行起），改动能进 v2 的进 v2
- 不引入新依赖；单文件 ≤400 行警戒线（repos/view.jsx 已 1194 行，拆分保守、每步全绿）

## 第 1 轮目标（审计 + 路线图）

代码走查 + 本地 serve 截图，产出问题清单与本路线图；顺手修零成本项。

## 问题清单（第 1 轮审计）

### cloud（todo/view.jsx，373 行）
- C1 工具栏三种职责挤一行：筛选（工作空间/主题）+ 快速新增（主题+内容+提交）+ 全局设置（附件自动下载）
- C2 快速新增是两个裸 input + 按钮，无视觉分组；应成投递条
- C3 行操作 4 按钮全量平铺（完成/冻结/编辑/删除），密度大噪音高；v2 模式是 hover-reveal
- C4 空态只有「（空）」一行 muted
- C5 cloud-counts 与三个 colhead 计数重复显示
- C6 主题筛选原生 select，主题多时不可搜；已完成桶「归档旧记录」inline style
- C7 语义色没用上：--cloud 青蓝已定义；三桶无差异标识

### repos（repos/view.jsx，1194 行 + transfer-panel 400 行）
- R1 行操作 3-4 按钮全量平铺（打开/编辑/描述/删除；参考仓库再+同步），hover-reveal 可减噪
- R2 参考仓库大面板 colhead 塞整段说明文字；5 列表格密度高
- R3 筛选行 side chips 用文本箭头 ▾/▸；on 态已青绿（好），细节可再对齐
- R4 12 个 Modal 表单密度/主按钮/标签样式需体检统一
- R5 空态是表格里一行 muted，可卡片化；读取中态弱
- R6 页头 page-head 已有（好），但与 cloud 页无页头形成不一致

### 通用
- G1 两页仍是 v1 的 .card/.toolbar/.row 语言，壳层已 v2 —— 统一是主旋律。
  **锚点改动**：主按钮 `.btn` 还是墨黑底（v1），md-workspace 已是青绿 `--mdw-accent`；
  ghost hover 也应对齐青绿（上一轮侧栏/轨道已从墨底反白改青绿，方向一致）
- G2 加载/错误态：repos 读取失败静默成空表；todo load 失败只有 toast
- G3 窄屏（≤720）布局未复查
- G4 可复用先例：v1 有 `.compose-bar` 投递条（指挥条模式），cloud 快速新增可直接借形

## 轮次路线图

1. **审计 + 路线图**（本轮）：清单、截图、日志
2. **cloud 工具栏分区**：筛选行 / 投递条 / 设置三区分离（C1 C2 C5）
3. **cloud 桶与行**：行 hover-reveal 操作、空态卡片、桶语义色（C3 C4 C7）
4. **cloud 细节**：主题筛选、归档入口、窄屏复查（C6 G3-cloud）
5. **repos 行与操作**：hover-reveal、按钮层级（R1）
6. **repos 参考面板**：说明收编、表格密度、chip 视觉（R2 R3）
7. **repos 弹窗体检**：12 个 Modal 统一（R4）
8. **repos 空态与页头**：空态卡片化、与 cloud 页头一致性（R5 R6）
9. **通用收口**：加载/错误态、focus、tooltip、窄屏（G1 G2 G3）
10. **回归收尾**：全量 test、截图前后对比、日志收口、清理 temp

---

## 纪要

## 第 2 轮纪要 ✅（含轮次外插队：用户实测反馈的 .col 泄漏修复）

- **fix(9b6be6e)**：style-v2.css 看板 `.col { width:216px; flex:none }` 泄漏进云端页
  （todo 同名类被覆盖），三列被钉死 216px、主区右侧空一块 —— 收进 `.pane .col` 作用域。
  用户报「宽度没有占满」，截图实证后修复。
- 按钮语言 v2（锚点 G1）：`.btn` 主按钮墨黑 → 青绿 #2F6F5E，ghost hover 青绿
  （`:not(.danger)` 收窄防染红）；行内 完成/解冻 转 ghost，黑块清零
- cloud 工具栏分区（C1 C2）：筛选行（工作空间药丸 + 主题 select 左 / 附件自动下载 +
  刷新右）与投递条分离；投递条合成一个输入组 [主题 | 内容 | 加入待办]，
  焦点环做在容器上（借 v1 `.compose-bar` 先例）
- 删除重复计数行 cloud-counts（C5）：信息在三个 colhead 里都有
- 死规则清理：`.cloud-page .toolbar/.cloud-counts/.cloud-quick-text`（v1）；
  `.cloud-page .cols/.col/.card.list` 迁入 v2
- 截图对照：temp/shots/cloud-fixed.png（修宽后）→ cloud-r2.png（本轮后）
- 遗留 → R3：行操作换行占两行、长文本竖条（.row 布局重构 + hover-reveal）

## 第 3 轮纪要 ✅

- 行结构重构：`.row` 改纵向容器，单行 `row-main`（tid/主题/正文/时间/操作）
  + 备注独立成层 —— 操作钮不再换行把行高撑成两倍，正文不再被挤成一字竖条
- 操作 hover 浮现（`opacity`，占位不变；`focus-within` 保键盘可达；
  `hover: none` 触屏常显）
- 操作收敛：主操作直出（待办=完成 / 冻结=解冻），低频操作（冻结/编辑/删除）
  收进行尾 ⋯ 菜单（新 `todo/row-menu.jsx`，点外/Esc 关闭，danger 红字）——
  4 钮 ~240px → 主钮+⋯ ~70px，窄桶正文恢复可读
- 桶语义色点（待办=青绿 / 已完成=灰 / 冻结=琥珀 --wait）+ 计数徽章化（C7）
- 空态卡片化（C4）：待办「在上方投递条输入，Enter 直达」等分桶引导
- 归档按钮 inline style → `.colhead .grow`；窄桶（<560px，container query）先藏时间
- 截图：temp/shots/cloud-r3b.png
- 教训入库：**本仓库有并行会话，禁用 `git add -A`**（R2 曾卷入 md-workspace
  WIP，已拆分修复）—— 循环协议补上这条

## 第 4 轮纪要 ✅

- 壳层窄屏（G3 抽查发现）：≤900px 侧栏浮层化后没有遮罩、点外收不起 ——
  App 加 `.side-scrim`（z-39，点击收起；≥901px display:none），实测 720px 遮罩生效
- container query 阈值 560 → 480：456px 桶宽下时间显示良好，原阈值过于激进
- 空态实测通过（shared 工作区恰好清空）：三桶分桶引导文案正确
- **刻意跳过**：主题筛选可搜索化（select）—— 常见主题数 < 20，原生 select 够用；
  若将来主题膨胀再升级，避免本轮造轮子
- 截图：temp/shots/cloud-r4-720.png（问题）→ cloud-r4-scrim.png（修复后）

## 第 5 轮纪要 ✅

- repos 行操作 hover 浮现（`.rp-acts` opacity，tr:focus-within 保键盘，
  hover:none 常显）—— 开发仓库表与参考仓库表同类
- 删除按钮无需改：v1 `.rp-del` 已是「平时同貌、悬停变红」，与本轮方向一致
- **Playwright hover 实测**（系统 Chrome channel）：cloud/repos 行操作
  悬停 opacity=1 ✅（temp/verify-hover.py，可复跑）
- 截图：temp/shots/repos-r5.png、verify-cloud-hover.png、verify-repos-hover.png
