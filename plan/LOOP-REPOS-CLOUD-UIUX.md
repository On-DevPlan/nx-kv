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
4. 纪要落本文件；`git commit`（conventional commits，中文，本地不 push）
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
