// 冒烟测试共享台架：临时目录与环境变量、结果收集、CLI 调用助手。
//
// 用例按职责分组在 tests/smoke/ 下的兄弟文件里（04-localtask、05-attachments …），
// 入口 tests/smoke.mjs 建好 ctx 后按序执行各组 —— 各组共享同一份临时配置，
// 已种数据沿执行顺序自然流动。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = dirname(TESTS_DIR);
export const BIN = join(REPO_ROOT, 'bin', 'kv.mjs');

export function createCtx() {
  const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-smoke-'));
  const cfgPath = join(tmp, 'config.json');
  // 进程内的 server.js 也要读这份配置 —— 只给子进程设 env 是不够的
  process.env.NX_KV_CONFIG = cfgPath;
  // 附件目录也指向临时目录：绝不在测试里往真实的 ~/.nx-kv/attachments/ 写东西
  process.env.NX_KV_ATTACHMENTS = join(tmp, 'attachments');
  // 仓库登记与文档树同样指向临时目录：docs 落盘绝不碰真实的 ~/.nx-kv/docs/
  process.env.NX_KV_REPOS_STORE = join(tmp, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(tmp, 'docs');

  const results = [];
  function check(name, cond, extra = '') {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  -- ' + extra : ''));
  }

  // ⚠️ 必须用**异步** execFile，不能用 spawnSync：spawnSync 会阻塞事件循环，
  // 同进程里起的 HTTP 服务（06-web）就响应不了子进程的请求。
  const execFileAsync = promisify(execFile);
  async function cli(args) {
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
        env: { ...process.env, NX_KV_CONFIG: cfgPath },
        encoding: 'utf8',
      });
      return { status: 0, stdout, stderr };
    } catch (e) {
      return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }
  async function cliJson(args) {
    const r = await cli([...args, '--json']);
    if (r.status !== 0) return { __error: (r.stdout + r.stderr).trim() };
    try {
      return JSON.parse(r.stdout);
    } catch {
      return { __error: '非 JSON: ' + r.stdout.slice(0, 120) };
    }
  }

  return { tmp, cfgPath, results, check, cli, cliJson };
}
