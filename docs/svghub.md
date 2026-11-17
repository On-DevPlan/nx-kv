# SVG 资产库（svghub）设计与挂载说明

> 状态：已实现（分支 `worktree-svghub`）。入口：左侧栏底部「SVG 资产库」、目录/组/仓库页工具区「SVG 资产」、地址 `#/svghub`。
> 事实来源：`src/web/frontend/svghub/**`、`components/icons.tsx`、`page/repos/icons.tsx`、`components/sidebar/index.tsx`。

## 1. 现状（动手前的三个问题）

| # | 问题 | 证据 |
|---|------|------|
| 1 | **图标按文件分家**：全站图标散在两套互不相干的表里 | `components/icons.tsx` 是一张 47 项的 `name → JSX` 表；`page/repos/icons.tsx` 是 19 个独立组件。同一个概念（仓库、文档、搜索）在两处各画一遍 |
| 2 | **语义不可分**：左侧栏的组、开发仓库、参考仓库统统画文件夹 | 侧栏组行硬编码 `folder`；仓库行走 `row.type === 'global' ? 'globe' : 'folder'`。15 行目录扫一眼分不出「组 / 仓库 / 参考仓库」 |
| 3 | **资产不可用**：图形是 React 节点，出不了这个仓库 | 没有 `.svg` 文件、没有检索、不能复制/导出；新页面要用图标只能再抄一遍 path，改一处改不全 |

另外一个隐性口径冲突：全局图标线宽 1.8，仓库页 1.6——两套并存在同一屏会显得「一深一浅」。

## 2. 目标与非目标

**目标**

- 一份资产的**唯一存放处**：数据化、可检索、可预览、可复制、可导出 `.svg`。
- 至少三条复用路径同时成立：旧 `Icon` 接口、新 `SvgIcon`、仓库页的组件名（`IconRepo` 等），全部指向同一份定义。
- 行语义可辨：组（分支）/ 开发仓库 / 参考仓库 / 全局池 / 目录，各有各的图形。
- 应用内有一个**资产库页**：陈列、搜索、分类、尺寸预览、挂载点说明、导出。

**非目标**

- 不引第三方图标库（仓库既有约定：一律内联 SVG）。
- 不做图标主题包 / 换肤；颜色仍由 `currentColor` + CSS 语义色决定。
- 不改任何业务逻辑、接口与数据。

## 3. 方案

```
svghub/
  types.ts          图元与资产类型 + 分类表（纯数据）
  catalog-nav.ts    外壳与导航   (20)
  catalog-repo.ts   仓库与组     (8)
  catalog-doc.ts    文档与任务   (8)
  catalog-state.ts  状态与提示   (7)
  catalog-act.ts    操作         (10)
  index.ts          全库合并 / 查找 / 检索 / 统计（唯一入口）
  icon.tsx          渲染层：SvgIcon / Icon（旧接口）/ glyph（组件桥）
  serialize.ts      资产 → 独立 .svg 文本；下载
  hub.tsx           资产库页（面板 component = 'svghub'）
  hub.css           资产库页样式
```

当前全库 **53 份**资产。

分层原则：**目录存数据，渲染层画图，页面只是消费方**。目录里不出现 React 节点，因此
同一份资产既能画进界面，也能序列化成 `.svg` 文件、被单测直接读。

### 3.1 资产规范

- 24×24 viewBox，`fill=none`，`stroke=currentColor`，`stroke-linecap/linejoin=round`。
- 默认线宽 1.8；个别资产可用 `w` 覆盖（当前全库统一 1.8）。
- 图元只有四种：描边路径 `p(d)`、填充路径 `f(d)`、圆 `c(cx,cy,r,fill?)`、矩形 `r(x,y,w,h,rx?)`。
- 名字：小写字母/数字/连字符，全局唯一（单测强制）。
- 必填 `label`（中文名）与 `group`（分类）；`keys` 是检索别名；`where` 是挂载点说明，空 = 已入库未挂载。

### 3.2 三条复用路径

| 路径 | 写法 | 使用方 |
|------|------|--------|
| 旧接口（默认） | `<Icon name="repo" size={14} />` | 30+ 处既有调用点，**零改动** |
| 新接口 | `<SvgIcon name="repo" size={16} title="仓库" />` | 资产库页、后续新页面 |
| 组件桥 | `export const IconRepo = glyph('repo')` | 仓库页 `<IconRepo />` 等 19 个组件名 |

`components/icons.tsx` 与 `page/repos/icons.tsx` 现在都只剩「名字映射」：前者一行 re-export，
后者是 19 行 `glyph(...)`。**加图标改 `catalog-*.ts`，不改这两处。**

### 3.3 挂载映射（本轮实际落点）

| 界面位置 | 行语义 | 资产名 |
|----------|--------|--------|
| 侧栏组行 | 项目组（分支） | `board` |
| 侧栏仓库行 | 开发仓库 | `repo` |
| 侧栏仓库行（`type=ref`） | 参考仓库 | `repo-ref` |
| 侧栏全局池 | 全局任务池 | `globe` |
| 侧栏底部 | SVG 资产库 | `shapes` |
| 目录/组/仓库页工具区 | 「SVG 资产」按钮 | `shapes`（文案 + 页面入口） |
| 仓库页分支条 / 区块按钮 | 组 / 仓库 / 参考仓库 / 文档 | `board` / `repo` / `repo-ref` / `docs` |

侧栏取图标的规则收在一个函数里（`components/sidebar/index.tsx` 的 `rowIcon`），
数据侧只多带一个 `repoType`（`model.ts`），不再在 JSX 里写三元。

## 4. 挂载与页面

- 路由：`routes/static.ts` 的 `svghubPage`（单例），`routes/index.ts` 登记。
- 面板：`panels.tsx` 的 `svghub`（lazy 加载 `svghub/hub.tsx`）。
- 区域：`workspace/areas.ts` → `maincontent`，并列入 `SINGLETON_PANELS`。
- 工具区：`components/tool-acts/modules.ts` 的 `dir` / `group` / `repos` 三张表各加
  `{ id: 'svghub', label: 'SVG 资产', section: 'bar' }`；三个调用页把动作接到 `#/svghub`。
  该按钮参与既有编排（可拖顺序、可收进「更多」）。

资产库页能力：

- 搜索：名字 / 中文名 / 别名（`repo`、`参考仓库`、`等待` 都能命中）。
- 分类：全部 + 5 类，带计数。
- 详情：大图预览、挂载点、网格口径、别名、12/14/16/20 四种实际尺寸并排。
- 拿走：复制 SVG 源码、复制 React 用法、下载 `.svg`、复制全库清单（JSON）。
- 「未挂载」标记：入库但还没在界面上用的资产一眼可见——避免「库里堆着没人用」。

## 5. 如何新增一份资产

1. 在对应分类文件里追一条：`{ name, label, group, keys, where, els }`；
2. 图形只画 24 网格内的 `p / f / c / r`，路径以 `M` 起笔；
3. 在调用点用 `<Icon name="新名" />` 或 `<SvgIcon name="新名" />`；
4. `node --import tsx --test tests/unit/svghub-catalog.test.mjs`（或 `pnpm test:unit`）——
   名字唯一、路径合法、坐标在格内、**源码里引用的名字都存在**，四条都在这份测试里。

## 6. 验收与取舍

验收（本分支已跑）：

- `tsc -b tsconfig.web.json` 通过；
- `node --import tsx --test tests/unit/svghub-catalog.test.mjs` 5/5 通过；
- `node --import tsx --test tests/unit/*.test.mjs` 全量：**本分支改到的三份测试全绿**
  （`svghub-catalog` / `route-table` 新增 `svghub` 基线 / `tool-acts-modules` 三张表各多一颗 `svghub`）；
  其中 `route-table.test.mjs` 补 `svghub` 两条基线（新增视图是「加基线」，不是重生成夹具）。
  注意：本分支 rebase 到了 `main@83732c4`（v13 收尾进行中），该提交自身有 10 条 docs/import/
  迁移类用例红着（已在 pristine `main@83732c4` 上复核，与本分支无关）；本分支没有新增任何失败。
- `eslint`（改动目录）0 error；`node scripts/check-lines.mjs` 全部合规；
- `vite build` 通过（`src/web/public` 产物）；
- 真实浏览器核过（隔离库 + 本地 `serve`）：`#/svghub` 页、侧栏三类行图标、仓库页与目录页工具区的
  「SVG 资产」按钮（点击即落到资产库）。

做的时候修掉的两个真问题：`App.tsx` 的 `routeFromHash` 白名单没有 `svghub`（`#/svghub` 会静默回落到总览）；
资产库页在窄面板会横向溢出，改成容器查询（`.shub { container-type: inline-size }` + `@container`），
按**面板宽度**降级而不是窗口宽度。

取舍（需要知道的两处变化）：

1. **重名图标合并为一颗**：两套表里 `search / plus / chevron / check / x / folder / edit /
   trash / link / repo` 各画过两版，现在每名只留一版（取更规整的那版）。仓库页会因此有
   极小的形状变化，换来的是「同一个词永远同一颗图」。
2. **仓库页线宽 1.6 → 1.8**：与全局口径统一（见 §1 末）。

未做：图标不参与主题换色以外的定制；资产库页不提供在线编辑图形（编辑请改目录文件）。
