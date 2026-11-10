# 决策：提示词模板内置 helper + timegoal 两段可配文案

- date: 2026-11-10
- status: accepted
- schema: 无变更（只动模板与渲染层）
- producers: `src/core/instruction-template.js`（helper 注册）；`src/shared/prompt-blocks.js`（goalhint / doneguard 默认模板）；`src/modules/localtask/task-lifecycle.js`（`renderDoneGuard`）
- consumers: `src/shared/prompt-blocks.js`（BLOCK_DEFS）；`src/modules/localtask/action-lifecycle.js`（done 的 blocked 展示）；`src/web/frontend/page/settings/prompt-template-params.js`（参数速查）

## 背景

任务级 timegoal 已经会在领取时给出提示词，但模板只能取值、不能判断。用户要的是
「进度到了某条线就换一种话术」：完成 1/2 时间给警告，到 2/3 提示收尾整理。
这要求模板里能做**比较与计算**，而不是由服务端再塞一批布尔开关。

同时，agent 在时间未到时调 `localtask done` 会被拦（blocked），但当时只有一句固定的
「时间未到」，发布方无法按项目习惯补「这段时间该做什么」。

## 决策

1. **在模板引擎层提供一套纯计算 helper**（25 个），所有区块共用：
   - 比较：`eq ne gt gte lt lte between v min max` → 布尔，可直接进 `{{#if}}` 或作子表达式；
   - 逻辑：`and or not`；
   - 数值：`add sub mul div mod round v [位数] floor ceil percent part total [位数] ratio part total [位数] clamp v min max`；
   - 字符串：`includes haystack needle`、`length v`、`default v fallback`；
   - 时间：`formatDuration 秒`（与交付文案同一套措辞）。
   命名沿用社区习惯（Handlebars-helpers 那一套），写模板的人不用记新方言。
2. **只做计算，不做业务判断**：helper 里没有「任务是否该收尾」「是否还要 check」这类
   规则——那些仍由 `timegoal check` / `done` 的门禁决定。模板能做的是「把已有变量
   换算成一句话」，不是绕过状态机。
3. **失败不抛错**：整份渲染不能因为一个坏输入挂掉。
   - 比较类拿不到有限数 → `false`（条件安全走 else）；
   - 数值类坏输入 → 输出可见的 `NaN`；除零照 JS（`Infinity` / `-Infinity` / `NaN`）；
   - `percent` / `ratio` 的总量为 0 → `NaN`（百分比语境里 `∞%` 没有意义，刻意不照搬除零语义）。
4. **goalhint 默认模板改用百分比 + 分档话术**：显示已过百分比；≥50% 提示「先确认主线」，
   ≥67% 提示「收尾整理」，到点提示收口。发布方可以直接在面板里改这一段。
5. **新增 doneguard 区块**：只在 `done` 被时间门禁拦住时渲染，以 blocked 返回的
   `guard` 字段出现（不进正常交付、不占 `<nx-kv>` 里的一段）。默认文案带剩余时间、
   `timegoal check` 与 `done` 的确切命令，并可按进度分档。CLI 展示优先用它，
   取不到时回落到原固定提示。
6. **不引入第三方 helper 包**：`handlebars-helpers` 带 100+ helper 与 lodash，
   与「一个只读模板引擎」的定位不符；本仓库只需要上述五类。

## 影响

- 模板能力：任何区块都能写
  `{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}…{{/if}}`；
  旧的取值 / `#if` / `#each` 写法完全不受影响。
- 默认 goalhint 的输出措辞变了（多了百分比与分档句）；它是系统内置模板，
  用户在设置里已自定义的模板不会被覆盖。
- `done` 的 blocked 返回多了 `guard` 字段；`hint` 保留原固定文案，调用方不感知也能用。
- 设置页「提示词模板」多出两个区块（goalhint / doneguard），参数速查同步给出
  可用 helper 与用法。
- 新增单测 `tests/unit/template-helpers.test.mjs` 钉住三条约定与用户原场景
  （过半警告 / 2/3 收尾）。

## 不做

- 不在模板里做正则、不在 helper 里写 I/O 或改库；
- 不给 `done` 门禁加「跳过」开关：未到点是业务约束，不是模板问题；
- 不做隐藏规则引擎（例如按模板内容推断该不该 done）——门禁只有一处。
