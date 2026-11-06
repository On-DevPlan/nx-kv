#!/usr/bin/env node
// nx-kv 唯一入口。
// 设计约定：Web 面板上每个按钮，都对应这里的一条 CLI 命令——二者由同一份 action
// 声明派生（见 src/modules/*/index.js），不是靠人维护两份清单。

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

const { runCli } = await import('../src/runtime/cli.js');

runCli(process.argv.slice(2)).catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
