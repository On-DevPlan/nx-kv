#!/usr/bin/env node
// 测试隔离门禁：**碰库的测试必须把库指到临时目录**（否则测试会写进用户的 ~/.nx-kv）。
//
// 为什么需要这条：2026-11-14 有一批测试没隔离，把 `D:\Temp\tmp.*` / `nx-kv-dbtest-*`
// 写成了用户库里的主题；目录删掉后就成了「面板里看得见、左侧树里没有」的幽灵
// （#155 用户反馈）。清理数据只是一次性的，**真正的修复是别再产生**。
//
// 判定（静态、不跑代码）：
//   1. 文件里 import 了 src/ 下会打开库的模块（core/db、localtask、docs、repos、
//      templates、tasktool 等）；
//   2. 且没有出现任何 `NX_KV_*` 环境变量设置，也没用共享夹具 `createTestStore`。
// 两者同时成立 → 报错。
//
// 白名单：tests/support/（夹具本身，它负责设 env）。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOTS = ['tests'];
const SKIP_DIRS = new Set(['support', 'fixtures', 'unit/__golden__']);
/**
 * 会打开 SQLite / 读写本机存储的模块（**精确到文件**，别用大目录通配：
 * promptplug / attach-template / workflow-* 这类纯函数模块不该被误判）。
 */
const DB_MODULES = [
  'src/core/db/index',
  'src/core/db/bootstrap',
  'src/modules/localtask/service',
  'src/modules/localtask/infra/repo/',
  'src/modules/localtask/lifecycle/topics',
  'src/modules/localtask/lifecycle/task-ops',
  'src/modules/localtask/lifecycle/task-lifecycle',
  'src/modules/localtask/lifecycle/task-view',
  'src/modules/localtask/lifecycle/deletion',
  'src/modules/docs/service',
  'src/modules/docs/actions/',
  'src/modules/repos/service',
  'src/modules/repos/boards',
  'src/modules/repos/transfer',
  'src/modules/templates/service',
  'src/modules/templates/actions/',
  'src/modules/tasktool/get',
  'src/modules/tasktool/wait',
  'src/modules/tasktool/timegoal',
];
const ISOLATION_MARK = /NX_KV_[A-Z_]+|createTestStore/;

/**
 * 豁免：import 了会开库的模块，但**只调用其中的纯函数**（已人工核对）。
 * 新增豁免必须写清「为什么不会碰库」，否则一律按未隔离处理。
 */
const ALLOW = new Map([
  ['tests/unit/attach-template.test.mjs', '只测 attachTemplateCtx / attachInstructionOf（纯渲染，无库访问）'],
  ['tests/unit/getloop-instruction.test.mjs', '只测 getLoopInstruction（纯字符串）'],
  ['tests/unit/localtask-board.test.mjs', '只测看板视图纯函数（不落库）'],
  ['tests/unit/progress-tasknum.test.mjs', '只测任务号格式化（纯函数）'],
]);

const errors = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = full.replace(/\\/g, '/');
    if (SKIP_DIRS.has(name) || SKIP_DIRS.has(rel.replace(/^tests\//, ''))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(mjs|js|ts)$/.test(name)) continue;
    if (!/\.(test\.mjs|test\.js)$/.test(name) && !/smoke/.test(name)) continue;
    check(full, rel);
  }
}

function check(full, rel) {
  if (ALLOW.has(rel)) return;
  const text = readFileSync(full, 'utf8');
  const importsDb = DB_MODULES.some((m) => text.includes(m));
  if (!importsDb) return;
  if (ISOLATION_MARK.test(text)) return;
  // 显式给库路径也是隔离（openStore({ path }) / new DatabaseSync(path)）
  if (/openStore\(\s*\{[^}]*path/.test(text) || /DatabaseSync\(/.test(text)) return;
  errors.push(rel);
}

for (const root of ROOTS) walk(root);

if (errors.length) {
  console.error('[check-test-isolation] 这些测试碰库但没隔离（会写进用户真实库 ~/.nx-kv）：');
  for (const f of errors) console.error('  - ' + f);
  console.error('修法：文件顶部（import src 之前）设 NX_KV_HOME / NX_KV_DB 到 mkdtemp 目录，');
  console.error('     或改用 tests/support/test-store.mjs 的 createTestStore()。');
  process.exit(1);
}
console.log('[check-test-isolation] OK：碰库的测试都指到了临时目录');
