# SVG 资产（开发期目录，不在界面出现）

界面上**没有**「SVG / 图标 / 资产库」这类概念，也没有对应页面或入口。这套东西只解决两个开发期问题：

1. **统一管理**：图标的图元只写一次，改一处全站生效；
2. **多路复用**：工具栏 / 菜单 / 侧栏 / 列表行都从同一张表取 `name`，不各画一份 path。

用户看到的是「保存」「导入」「更多」这些动作前面多了个小图形——直觉化，而不是模块。

## 目录结构

```
src/web/frontend/svghub/
  types.ts        图元类型（p 线 / f 面 / c 圆 / r 圆角矩形）+ 五个分类元信息
  catalog-nav.ts  nav   导航类（目录、任务、组、文档…）
  catalog-repo.ts repo  仓库类（仓库、参考仓库、分支、远程…）
  catalog-doc.ts  doc   文档类（文档、标签、附件、fork…）
  catalog-state.ts state 状态类（待领取、完成、进行中…）
  catalog-act.ts  act   动作类（新增、删除、保存、导入、评论、快捷键…）
  index.ts        总表 SVG_ASSETS + assetOf / hasAsset / assetsOfGroup
  icon.tsx        SvgIcon（按资产名直出）+ Icon（旧接口，带 .ic 类）
  serialize.ts    图元 → SVG 标记（导出脚本与需要字符串时用）
```

加一份资产 = 在对应分类文件里加一条 `{ name, label, group, els, ... }`，总表自动收进来。

## 怎么挂到界面

图标**不是**组件里手写 SVG，而是「模块表里写 `icon: 'name'`，渲染层统一画」：

- 工具栏 / 「更多」菜单：`components/tool-acts/modules.ts` 的六张表（dir / group / task / doc / repos / repos-row）每项带 `icon`；`components/tool-acts/bar.tsx`（dir / group / repos 头部与行内动作）渲染。
- 任务页头：`components/md/tool-bar.tsx`（`KIND = 'task'`）。
- 文档页头：`components/doc/doc-head.tsx`（`KIND = 'doc'`）——它和 task 页头是同构的两份实现，加字段两边都要动。
- 编排面板：`components/tool-acts/layout-panel.tsx`。
- 侧栏：`components/sidebar/index.tsx` 的 `rowIcon()`（组 = branch、仓库 = cube、参考仓库 = 立方体箭头、全局 = 地球）。
- 列表行 chip：`components/tool-acts/layout-panel.tsx` 与 `page/repos` 的行内按钮。

`icon` 写了不存在的名字不会报错——`SvgIcon` 直接不画（`assetOf` 返回 undefined 就返回 `null`）。所以 `tests/unit/svghub-catalog.test.mjs` 有一条挂载守护：扫前端所有 `icon: 'xxx'` 字面量，断言资产存在。新增图标后跑单测即可，不会静默丢图。

## 导出给外部用

```powershell
node --import tsx scripts\export-icons.mjs            # 默认 temp/icons/
node --import tsx scripts\export-icons.mjs out\icons  # 指定目录
```

导出每份资产为独立 `.svg`（24×24 视框、`stroke` 留 `currentColor`），用作 favicon、文档配图或设计稿对照。`temp/` 已 gitignore，导出物不进仓库。

## 边界（曾经的错误方向）

第一版做过 `#/svghub` 资产库页（图标墙 + 搜索 + 复制/下载）与侧栏 footer 入口，已被删除：资产是**开发资源**，不是产品功能。不要为了「展示图标」再加页面、面板、路由或按钮。
