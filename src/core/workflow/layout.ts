// workflow 目标目录规范（按 nx-kv 分层 + 语义子目录）。
//
// 原则
//   1. 禁止平行顶层 src/{facade,store,mutator,scheduler,plugins}/。
//      同名语义**必须**落在 modules 或 core/workflow 的子目录里。
//   2. **全部 goal 同一目录、每种一份**——block / wait / time / task 都在
//      tasktool/plugins/；禁止再拆「core 一份 + modules 一份」。
//   3. localtask = 写侧（store/mutator/scheduler/bus）；
//      tasktool = 消费门面 + goal 族；二者成对，允许互引
//      （scheduler 调 blockgoal → import tasktool/plugins 即可）。
//   4. 面板只吃 /api；两端同构投影才进 shared/。
//   5. JS ESM only；子目录均带 index.js 桶文件对外导出。
//
// 依赖方向（单向）
//   web → modules → core/workflow → Node 内置
//   tasktool/facade ──▶ localtask/{store,mutator}
//   localtask/scheduler ──▶ tasktool/plugins/blockgoal + core readiness + bus
//   localtask/mutator ──▶ localtask/store
//   tasktool/plugins/runtime ──▶ 同目录各 goal
//
// ---------------------------------------------------------------------------
// 目标树（✅ 已有 / ○ 待落地 / → 自现状迁入）
// ---------------------------------------------------------------------------
//
// src/core/workflow/
// ├── types.js                          ✅
// ├── snapshot.example.json             ✅
// ├── layout.js                         ✅ 本规范
// ├── readiness.js                      ✅ 自 dag 下沉
// ├── edges.js                          ✅
// ├── event-names.js                    ✅
// └── plugin-registry.js                ✅ 按 name / scope 校验
//
// src/modules/localtask/
// ├── index.js / service.js             ✅ 模块壳；complete → refreshTopicAfterComplete
// ├── dag.js                            ✅ 再导出 readiness
// ├── engine.js / writes.js             ✅ 主题引擎；DAG 日常写经 Mutator
// ├── store/                            ✅ SnapshotStore + memory/file/topic adapter
// ├── bus/ mutator/ scheduler/          ✅
//
// src/modules/tasktool/
// ├── index.js                          ✅
// ├── facade/                           ✅ submit/get/wait 再导出
// ├── plugins/                          ✅ 目录扫描 IoC + 实现同目录
// │   ├── discover.js                   扫描注册（跳过 *-store/*-config）
// │   ├── *-store.js / waitgoal-config  原 timegoal/taskgoal/getloop 迁入
// │   └── block|wait|time|task goal.js  definePlugin
// ├── facade/                           ✅ submit→store+入队；get→AsyncIterable
// ├── groupctx.js / attach.js           ✅
// └── getloop/timegoal/taskgoal.js      ✅ 薄再导出 → plugins/*
//
// 为何 blockgoal 也进 tasktool/plugins（不留 core）
//   goal 是插件族，视觉与注册平级；拆到 core 会造成「调度 goal 一套路径、
//   消费 goal 另一套路径」。localtask↔tasktool 本就可配对互引，scheduler
//   直接 import blockgoal 即可，无需为避依赖把家族拆开。
//
// ---------------------------------------------------------------------------

export const TARGET_PATHS: Readonly<Record<string, string>> = Object.freeze({
  'core types': 'src/core/workflow/types.js',
  'snapshot example': 'src/core/workflow/snapshot.example.json',
  'this layout norm': 'src/core/workflow/layout.js',
  readiness: 'src/core/workflow/readiness.js',
  'plugin registry': 'src/core/workflow/plugin-registry.js',
  'store/': 'src/modules/localtask/store/',
  'store barrel': 'src/modules/localtask/store/index.js',
  'store file-adapter': 'src/modules/localtask/store/file-adapter.js',
  'store memory-adapter': 'src/modules/localtask/store/memory-adapter.js',
  'bus/': 'src/modules/localtask/bus/',
  'bus barrel': 'src/modules/localtask/bus/index.js',
  'mutator/': 'src/modules/localtask/mutator/',
  'mutator barrel': 'src/modules/localtask/mutator/index.js',
  'mutator validate': 'src/modules/localtask/mutator/validate.js',
  'scheduler/': 'src/modules/localtask/scheduler/',
  'scheduler barrel': 'src/modules/localtask/scheduler/index.js',
  'scheduler state-drive': 'src/modules/localtask/scheduler/state-drive.js',
  'facade/': 'src/modules/tasktool/facade/',
  'facade barrel': 'src/modules/tasktool/facade/index.js',
  'facade submit': 'src/modules/tasktool/facade/submit.js',
  'facade get': 'src/modules/tasktool/facade/get.js',
  'facade wait': 'src/modules/tasktool/facade/wait.js',
  'plugins/': 'src/modules/tasktool/plugins/',
  'plugins barrel': 'src/modules/tasktool/plugins/index.js',
  'plugins runtime': 'src/modules/tasktool/plugins/runtime.js',
  blockgoal: 'src/modules/tasktool/plugins/blockgoal.js',
  waitgoal: 'src/modules/tasktool/plugins/waitgoal.js',
  timegoal: 'src/modules/tasktool/plugins/timegoal.js',
  taskgoal: 'src/modules/tasktool/plugins/taskgoal.js',
});

/** 全部 goal 唯一落点（同一目录；禁止第二份） */
export const GOAL_HOMES = Object.freeze({
  blockgoal: 'src/modules/tasktool/plugins/blockgoal.js',
  waitgoal: 'src/modules/tasktool/plugins/waitgoal.js',
  timegoal: 'src/modules/tasktool/plugins/timegoal.js',
  taskgoal: 'src/modules/tasktool/plugins/taskgoal.js',
});

/** 必须出现的语义子目录（相对仓库根） */
export const REQUIRED_SEMANTIC_DIRS = Object.freeze([
  'src/modules/localtask/store',
  'src/modules/localtask/bus',
  'src/modules/localtask/mutator',
  'src/modules/localtask/scheduler',
  'src/modules/tasktool/facade',
  'src/modules/tasktool/plugins',
]);

/** 禁止的平行顶层 */
export const FORBIDDEN_TOP_LEVEL = Object.freeze([
  'src/facade',
  'src/store',
  'src/mutator',
  'src/scheduler',
  'src/plugins',
  'src/bus',
  'src/core/types',
]);
