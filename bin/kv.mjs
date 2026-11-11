#!/usr/bin/env node
// nx-kv 唯一入口。
// 设计约定：Web 面板上每个按钮，都对应这里的一条 CLI 命令——二者由同一份 action
// 声明派生（见 src/modules/*/），不是靠人维护两份清单。
//
// 运行的是 TS 源码（tsx 注册 loader 后动态 import）——与 `pnpm dev`、smoke 测试
// 同一条执行路径，**没有第二个真相源**。刻意不走 dist：bin 跑构建产物的话，
// 「改了源码忘了 build」会让全局 `nx-kv` 静默跑旧逻辑，这类 bug 没有任何报错指向根因。
// tsx 在 devDependencies：本仓库以 pnpm link 方式安装（scripts/link-local.mjs），
// bin 从仓库自己的 node_modules 解析 tsx，不需要装进 dependencies。

// ── Node 版本硬拦（必须在任何业务 import 之前）──────────────────────────
//
// 存储层用 Node 内置 SQLite（node:sqlite）。Node < 22.13 上，第一行
// `import 'node:sqlite'` 会抛 `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in
// module: node:sqlite` 加一段栈 —— 完全指不出「你的 Node 太老」这个真因。
//
// 所以先查版本、给出人话错误，再**动态** import 业务入口（动态 import 保证
// 检查发生在求值之前）。version.js 自身不碰 node:sqlite，import 它是安全的。
import { checkNodeVersion } from '../src/core/db/version.js';

const versionCheck = checkNodeVersion();
if (!versionCheck.ok) {
  console.error(versionCheck.message);
  process.exit(1);
}

import { register } from 'tsx/esm/api';

// 注册 tsx loader（返回 unregister，进程退出无需清理）
register();

const { runCli } = await import('../src/runtime/cli.ts');

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
