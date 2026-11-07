# 简介文档优化：面板三界面文档展示重构（nx 组任务，原误标 nx-as #3）

## 需求（任务正文）
1. **repos 界面 + 项目(dir) 界面 + 项目组(group) 界面**：文档 / reference 不以 tag（chip）形式外显。
2. 点击「**查看详情**」→ 弹出 modal：可查看**完整文档列表**，编辑器**复用编辑器组件**（MdPanes）。
3. 「**更多**」菜单里有「**查看列表**」下拉项 → 打开**与进程一致的右侧边栏**（可关闭），显示该**项目组/项目的 reference 列表**。

## 现状
- Introduction（dir/group 页）：主篇链接 + 「补充」chips 行（tag 外显）＋ ＃标签编辑 ＋ ＋ref。
- repos 页 DocChips：文档列 chip 外显（主篇/补充/组内），× 摘除、＋ 添加；refRepos 表同款。
- 进程面板：`openPanel(model,{component:'progress',location:'right'})`；右侧 tabset `ts_right` enableTabStrip:false → **右侧栏实际是单面板位**（两个 tab 共存无法切换）。
- DescModal（components/repos/desc-modal.jsx）：**无人引用的死代码**，但它是「列表+MdPanes 编辑器」modal 的现成模板。

## 改动清单
| # | 文件 | 动作 |
|---|------|------|
| A | `components/Introduction/docs-modal.jsx` | 新增 DocsModal：kind=repo/board；数据复用 useIntro（live 集合）+ repo.boards 组内条目；左列表右 MdPanes（DescModal 模式：GET item→PATCH/POST 保存、外部只读、missing 可创建）；每条 摘除（repo: DELETE /api/repos/docs{index}，board: POST /api/docs/link{remove}）、标签（setLinkTag）、＋补充（addRef）、↗页签 |
| B | `components/Introduction/index.jsx` | 去掉补充 chips 行与 ＃ 编辑；加「查看详情 N」按钮开 DocsModal；主篇链接保留 |
| C | `page/repos/index.jsx` | DocChips → 「查看详情」入口（主篇摘要+数量）；组内文档 chips 收进 modal；删 DocChips 与无主 acts（docRemove/docAdd/doc/docLink/noteOf）；新增 docsFor 状态渲染 DocsModal；rp-doc-chip* 样式清理 |
| D | `page/dir/index.jsx` | moreMenuItems 加「查看列表（reference）」→ openPanel refs（config.repoKey=topic.repo.key）；isGlobal/无 repo 时 toast |
| E | `page/group/index.jsx` | 头部加「更多 ▾」PopMenu，含「查看列表」→ openPanel refs（config: boardKey/boardName） |
| F | `page/refs/index.jsx` | 新增 RefsPanel（右侧栏）：repoKey→/api/repos/docs、boardKey→/api/boards/:id；行点击 useWikiNav.openByDocId 开文档页签；关闭按钮 |
| G | `panels.jsx` + `workspace/areas.js` | 注册 refs：PANELS.refs、PANEL_AREA.refs=RIGHT、SINGLETON_PANELS+refs |
| H | `workspace.js` | clearRightPanels(model, keep)：右侧栏单面板位（开 refs 顶掉 progress、开 progress 顶掉 refs；syncProgressPanel 同步时清 refs）；closeRightPanelOf(model, component)：删该 component 页签，右侧 tabset 空则收起（refs 关闭用） |
| I | CSS | Introduction/style.css 删 chips 样式；page/refs/style.css 新增；repos style.css 清 rp-doc-chip* |

## 序号口径（摘除用，已核实）
- repo：`DELETE /api/repos/docs {id,index}`，1=主篇绑定，≥2=docLinks[n-2]（**不含**目录 extras）。
- board：`POST /api/docs/link {board, remove:n}`，n=docLinks 1-based。
- extras（介绍目录同目录兄弟 md）是计算出来的，不在 docLinks，**不提供摘除**（只读+编辑）。

## 验收
- [x] repos 页行内无 doc chip 外显；「查看详情」modal 列出 主篇/补充/外部/组内 全量，双栏编辑可保存
- [x] dir/group 页简介行无补充 tag 外显；「查看详情」同上
- [x] dir「更多 → 查看列表」、group「更多 ▾ → 查看列表」开右侧栏（进程同款），列出 reference，可关闭
- [x] 右侧栏单面板位：refs/progress 互不叠卡（互顶替，syncProgressPanel 同步时 refs 让位）
- [x] 摘除/标签/＋补充 在 modal 内可用（口径正确）；主篇点击仍开文档页签
- [x] lint + build 通过；面板探针实测（temp home 全隔离 + 7891 端口 + Playwright 22 项断言全绿）

## 实测发现并顺手修掉的既有缺陷
1. **FlexLayout `fromJson` 丢空 tabset**：新会话活模型里 `ts_right` 根本不存在（探针实锤）——
   右栏面板 dock 进临时 tabset，`clearMainPanels` 把它当主区内容清掉；右侧栏收起也是空操作。
   修法：`rightTabsetId` 结构化识别（id 或「装着 progress/refs」）+ openPanel RIGHT 分支
   根行右缘现建 + `clearMainPanels` 组件级豁免右栏面板。
2. **`docSetOf` 主篇只认旧单文件路径**：主篇写在目录 `index.md` 的项目在 repos 行永远「未写」。
   修法：docSetOf 对约定路径先探 `index.md`（与 readIntroSet 同口径）。
3. **board 文档集字段名差异**：board 响应是 `docLinks`，repo 是 `links`——新组件统一双读。

## 风险与注意
- 右侧栏 enableTabStrip:false → 必须单面板位，否则两 tab 互相挡死（进程现状也靠 syncProgressPanel 单例）。
- 并行会话可能改前端文件：提交前 git status 核对，只 add 自己的清单。
- 面板验证用 nx-kv-panel-probe 流程（绝不碰真实队列/repos.json）。
- 探针留档：temp/seed-docs-probe.mjs（播种）+ temp/probe-docs.cjs（22 项断言），temp/ 已 gitignore。
