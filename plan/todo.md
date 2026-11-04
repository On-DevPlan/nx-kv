# nx-kv

## 项目业务

### 语义

一个 kv 清单的任务管理中枢系统。

### 使用流程

用户提交任务后，Agent 基于项目组的上下文方向引导，以 Markdown 文件为交互载体进行任务执行，支持单独配置等待任务与时效目标；任务完成后执行回填并进入等待状态，若用户产生新的修改反馈则在 Markdown 上继续编辑并重新进入执行循环，若无更新则直接结束，形成「执行—等待—反馈修改」的动态闭环。

**对外 skill（已收敛）**

- [x] `kv-get` — 领取 / wait / done / reopen（含 timegoal check 门禁、项目级持续 get）
- [x] `kv-submit` — 提炼需求并 `localtask add` 委托
- [x] `kv-repo` — 项目组关系报告 + clone 外源参考仓库并**强制读**

旧 skill（`kv-localget` / `kv-waittask` / `kv-timegoal` / `kv-repo-mmx-gitrepo`）已并入上述 references，不再单独维护。

**回调定位**

- [x] 领取输出带头 `#<task.id>`；完成 / 重开 / 编辑一律 `--id`，保证回调准确
- 其余（收尾指令模板、持续 get）走项目 / 全局设置

## 项目单元概念

### 项目 vs 项目组

- [x] 项目：绑定仓库，一仓库 = 一个项目
- [x] 项目组：组合关系（看板），无父子层级，具有语义方向性
- [x] 项目 / 组均可绑定 markdown 目录，支持 `[[双链]]`
- [x] 介绍的「补充文档」可带**分类标签**（`--tag`，如 qa）——面板 ＋ ref 新增可选填、每条链接旁 ＃ 可改/可清，渲染成小 chip；docLinks 条目 = DocRef + 注解（note/tag），写入口 / loadStore 归一化 / zip 导出导入三处同一口径（`docref.withLinkMeta`）；同 doc 重复添加 = 更新该条
- [x] 组内每个仓库有独立组内描述（note）——地位、解决问题、与兄弟关联
- [x] CLI 可快速拿到本项目知识（`board list` / `repo knowledge` / `repo ref of`）
- [x] 发布任务指定归属（`--project`，配 `--board` 时必须是该组成员；落点目录由项目推导，`--cwd` 只做一致性校验）；领取按落点目录定位
- [x] 提交携带 frontmatter：`board`/`project` 归属 + `boardIntro`/`projectIntro`（介绍文档**引用式**：路径 + 一行摘要）；改文案（reopen/update `--text`）不丢 frontmatter
- [x] 取/派两条链路同构：派任务编排迁 `tasktool/add.js`（与领取侧 get/wait 并列，action 层一行委托），落点判定只此一份实现——CLI/HTTP/面板提交/远程导入同走一条 `submitTask`；正文自带 frontmatter（fail-open）落点也跟到项目队列（显式 `--cwd` 时不挪窝）
- [x] 领到组内仓库任务时，交付 `instruction` 封装：组概念、组介绍、本项目位置、兄弟角色、参考文件可读路径（`task.text` 保持原文）

### 任务工具

- [x] **timegoal**（任务级）：发布带 `--duration`（CLI）或任务编辑页「时间目标」栏 → 领取即计时 → 提示词要求 `timegoal check` → 未到点 `done` 返回 `blocked`，派 sub agent 重提需求
- [x] **waitgoal**（项目级「持续 get」）：默认直接 get；开启后无任务自动唤起阻塞窗口 + 模板增强「继续 get 直到超时」（模板可多条，与回调提示词同款按条编辑）
- [x] 时间窗口从领取起算；check / 剩余时间 / 提示词模板可配
- [x] 回调提示词可配多条（列表存储，按条增删；拼接后统一分流渲染）：设置面板 →「模板与任务工具」；时长无全局默认（曾有的全局默认时长已删），只在发布/编辑任务时显式给——CLI `--duration` 或面板编辑页「时间目标」栏；**未领取**的任务可在编辑页改/清声明，已领取计时中的冻结（要调先 reopen）
- [x] **任务附件（2026-11-04 #15 定稿口径：本地贴图走本地存储，与云端零关联）**：面板编辑器贴图/选文件与 `localtask attach --path` 都落**本机附件仓**（`~/.nx-kv/attachments/local/`，`core/localatt.js`——不发网、上传即落盘）；正文嵌 `![名](fileId)`（id 与云端 fileId 同构，语法零分叉）；领取标注本机仓优先（命中即绝对路径，全命中零网络），云端清单引用才按设置走镜像同步；`/api/file/content` 本机仓优先（面板预览离线可用）。修掉的现象：旧链路把贴图送上云端图床，云端不可达时界面看着有图、正文只有死引用，agent 领取 `attachments count: 0`

### 导入导出

- [x] 以全局唯一 **key**（归一化远程地址 / 自定义）为身份；仓库组绑 key，不绑本地路径
- [x] 导出 zip：`layout.json` + 自有 docs 树（描述 markdown 一并带走）
- [x] 无 key / 无远程：跳过或标「待完成」；导入端本地没有的成员 →「待初始化」占位
- [x] 仓库统一管理面板：接管 / clone 补齐占位（只要 key 对上即可链接）

> 说明：导出不只是「项目关系」——含仓库条目、看板成员 key、参考关系与自有文档树（v4）。

## UI

### 左右面板 / 侧边栏

- [x] 上侧面板（顶栏）删除；全局动作进侧边栏品牌区
- [x] 设置面板统一收敛到侧边栏齿轮（浮动设置面板）
- [x] 侧边栏拖拽自动收起：宽度 &lt;46px 收起 / ≥120px 展开，中间迟滞带防抖；点击收起/展开直接翻状态

### 任务队列显示

- [x] 显示序：**未完成（待领取）优先**——队列是追加序，新任务会被几十条历史埋底；显示序与队列序分开（`sortTasksForDisplay`，桶内待领取仍按队列原序=领取优先级）
- [x] 队列长度有出口：侧栏任务子行不再硬截断在 12 条（静默丢弃第 13 条起，用户既看不到也够不着），改**分页**（12 条/页）；目录任务表同样分页（20 条/页）+「N 待领取 · M 个任务」计数
- [ ] 后续（用户提出「后续可以尝试」）：队列存储换 SQLite——`~/.nx-kv/localtasks.json` 现在是整份读写，队列一长就整份重写；换库前先做只读镜像比对（同一批任务两种存储逐条对齐）再切换

### 设置面板

- [x] 全局设置进侧边栏浮动面板（偏好 / 工作区 / 云端与存储 / 模板与任务工具 / 项目级）
- [x] 功能性：模板配置入口、任务工具（回调提示词）、项目级「持续 get」
- [x] 项目级设置 UI：icon 入口在标题行左侧圆形预览，点开就地编辑（与侧栏同步显示）

### 弹层组件收敛（2026-11-04 #30）

- [x] **两个唯一出处**：`components/toast/`（ToastProvider / useToast / useGuard）与 `components/popup/`（Modal / useDialog / PopMenu / RowMenu / useDismiss + `.pp-*` 统一视觉）——ui.jsx 只剩 Copyable / ErrorBoundary / DiffPre
- [x] **原生 alert/confirm 全部清零**（12 处、8 文件）：confirm → `useDialog`（danger 红 + 页内键盘可取消），成功/失败提示 → toast；此前 ui.jsx 头注释写着「不用浏览器原生弹窗」却一直有 12 处违规
- [x] **旧弹层外壳收编**：迁移确认框 / 快捷键 sheet / 成员选择器重壳到 Modal；`.dlg`、`.modal`（v1 遮罩 与 v2 盒子两套互斥定义的历史雷）、`.mdw-sheet`、`.gmenu`、`.rowmenu-pop` 样式块删除，Esc/点外关闭统一进 `useDismiss`

## 开发

- [x] 项目级 skill `.claude/skills/dev-nxkv/`：改本仓库代码的施工单——分层地图、模块骨架、action 字段全表、CRUD 契约、注册三步、常见坑与验收命令（README「架构」节有指引）
