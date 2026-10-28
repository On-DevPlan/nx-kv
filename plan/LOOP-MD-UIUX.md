# Ralph loop · MD 工作台 UI/UX（仅轮次 × 5）

> `nx-rp` 0.4.1 无 `loop` CLI；本会话手工 Ralph × 5。产物在 `src/modules/md-workspace` + 侧栏样式。

## 任务

继续打磨 MD 工作台观感与布局：按钮右齐、少黑块、工具区单一、进程不挡编辑、侧栏与主区视觉统一。

## 结束模式

仅轮次 · max 5 · 无 promise

## 轮次目标

1. 工具区密度：右侧按钮组不换行挤乱；hint 可让位；顶栏更干净
2. 编辑/预览排版：标题、正文、分栏留白与字号
3. 进程面板：改为主区内嵌右栏（非 fixed 遮挡），开合不压按钮
4. 侧栏任务子行与选中态再对齐青绿语言
5. 扫尾：空态、hover、构建验证、本纪要

---

## 第 1 轮纪要 ✅

- `tool-bar.jsx`：左 `mdw-toolbar-left`（模式/工具/hint）+ 右 `mdw-actions`（`margin-left:auto`、nowrap）
- 文案缩短（导入 / 新任务 / 标注），避免窄宽挤乱
- hint 溢出省略；≤960px 隐藏 hint

## 第 2 轮纪要 ✅

- 编辑标题 18px、正文 13px/1.7；预览文章 max 680、更大标题与段落间距
- 分栏 `mode-split` 50/50；引用块改用青绿 soft，去掉土黄硬边

## 第 3 轮纪要 ✅

- 布局改为 `.mdw` 横向：`mdw-main` + 内嵌 `#mdw-prog` / `.mdw-prog-rail`
- 去掉 fixed 浮层与中间 fab；收起为右侧竖条「进程」
- 窄屏（≤720）进程改为 absolute 叠层，避免主区过窄

## 第 4 轮纪要 ✅

- `.task-child` 高度/字号/hover/青绿计数徽章对齐工作台强调色
- 去掉子行 inline `fontSize` 样式

## 第 5 轮纪要 ✅

- `pnpm run build` 通过
- 清理 tool-bar 未用 Icon import
- 本文件收口
