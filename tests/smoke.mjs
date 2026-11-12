// 冒烟测试入口：CLI 全链路 + HTTP API + 静态页。
//
// 全程纯本机：不依赖任何远程后端，也不碰生产数据。
// 使用临时配置（NX_KV_CONFIG），不污染 ~/.nx-kv。
// 运行：pnpm test（或 node tests/smoke.mjs）
//
// 用例按职责分组在 tests/smoke/ 下的兄弟文件里，这里只做装配：
// 建台架 → 按序执行各组（状态沿顺序流动）→ 收尾汇总。
// 退出码语义不变：有 FAIL 则 exit 1。
import { rmSync } from 'node:fs';
import { createCtx } from './smoke/harness.mjs';
import { run as localtask } from './smoke/04-localtask.mjs';
import { run as attachments } from './smoke/05-attachments.mjs';
import { run as web } from './smoke/06-web.mjs';
import { run as docs } from './smoke/07-docs.mjs';

const ctx = createCtx();

try {
  await localtask(ctx);
  await attachments(ctx);
  await web(ctx);
  await docs(ctx);

  if (ctx.server) await new Promise((r) => ctx.server.close(r));
} finally {
  // T03：localtask 存储是 SQLite —— 先关本进程的连接再删临时目录
  //（子进程 CLI 各自持有的连接随进程退出释放）。
  try {
    const { closeDb: closeTaskDb } = await import('../src/modules/localtask/repo/index.js');
    closeTaskDb();
  } catch { /* ignore */ }
  try {
    rmSync(ctx.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    // 残留句柄（子进程 CLI）可能仍占着库文件：目录留在 tmp 里，不影响结果
    console.error('（提示：临时目录清理失败，可手动删除:', e.message, '）');
  }
}

const failed = ctx.results.filter((r) => !r.ok);
console.log(`\n${ctx.results.length - failed.length}/${ctx.results.length} 通过`);
if (failed.length) {
  console.log('失败项: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
