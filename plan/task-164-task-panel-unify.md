# #164【ui统一】group/dir 任务面板统一（以 group 为准）+ 组页补状态

## 需求 → 工程口径

1. 「group 和 dir 都属于任务面板页，但 UI 完全不一致，以 group 为准，抽离其任务面板为组件」
   - group 页（page/group）：卡片行面板（rp-tasks 容器 + rp-proj-row/-task 行 + StatusTag 全称药丸
     + 历史折叠段）。
   - dir 页（page/dir/landing）：密集表格（mdw-land-table + 单字徽标 等/跑/完/档 + 列头）。
   - **做法**：把 group 的面板抽到 `components/task-panel/`（容器 TaskPanel + 行 TaskRow），
     两页共用；dir 的表格换成同款行列表，批量条 / 工具区 / 翻页保留。
2. 「比较项目组和项目的任务状态，项目组少一种状态」
   - group 历史段把 claimed/done/cancelled 全渲染成 `rp-tstat live`（已领取/进行中蓝）——
     **已交付（绿）/ 已作废（收口灰）被吞**。
   - **做法**：历史行统一走 StatusTag（#121 全应用唯一状态口径），四态齐显；dir 单字徽标
     同步升级为全称药丸（同一组件）。

## 组件设计（components/task-panel/）

- `task-row.jsx` — TaskRow：`[checkbox opt][拖把 opt] #id [项目 tag opt] 标题 [⏱时间目标]
  [闸门×N][锁定] [创建/领取时间 opt] [StatusTag] [ops opt]`；整行可点开任务
  （div role=button，内嵌交互 stopPropagation）；拖拽视觉类复用 rp-proj-row.dragging/.drop-*；
  标题统一 `taskLabel`（40 字截断，sidebar/model.js 同源）。
- `index.jsx` — TaskPanel：rp-tasks 容器 + 头部（图标 + 标题 + 计数 chips + 可选 headerExtra）
  + children（行）；可选历史折叠段（historyCount>0 出 rp-done-toggle）。
  - group 用法：pending 段 + 历史折叠段。
  - dir 用法：children = 当前页全部行（不拆段，保分页语义），headerExtra = 全选本页。

## 改动清单

| 文件 | 改动 |
|---|---|
| `components/task-panel/task-row.jsx`（新） | 共享任务行 |
| `components/task-panel/index.jsx`（新） | 共享面板容器（含历史折叠） |
| `page/group/index.jsx` | 任务面板段改用共享组件；历史行换 StatusTag（补状态） |
| `page/dir/landing.jsx` | 表格 → 共享行列表；单字徽标 → StatusTag；全选移面板头 |
| `styles-v2/views.css` | 补 rp-proj-times / rp-proj-ops / rp-proj-pick / div 焦点样式 |

保留不动：dir 批量条（选中学生逻辑）、工具区、Pager、拖动排序落盘逻辑、group 新建按钮/
成员弹窗/模板下拉。

## 验证

1. `pnpm lint && pnpm build`（no-undef 拦漏 import；jsx 编译）。
2. panel probe（nx-kv-panel-probe 流程）：独立 store 全隔离（NX_KV_HOME）+ 临时端口 serve
   + Playwright：
   - dir 页与 group 页截图对比——行结构 / 状态药丸一致；
   - 四种状态齐显（pending/claimed/done/cancelled 各造一条）；
   - 回归：拖动排序、批量取消、翻页、行菜单、点行开任务。
3. `?cb=1` cache-buster 防面板缓存；改 action 后重启 serve。
