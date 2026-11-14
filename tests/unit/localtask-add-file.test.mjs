// #132 · 提交任务时的多行 / 长文本输入。
//
// 口径：「把当前的上下文 + 工程知识 + 关键路径写成一条自包含任务」是 localtask add 的
// 主用途——正文天然是多行长文本。命令行里用引号硬拼在 Windows 的 PowerShell / cmd 下
// 极易踩转义坑，所以加 `--file <文件>`（`-` = 标准输入）：
//   · 文件 / stdin 的内容**逐字**成为任务正文（换行保留）；
//   · 正文与文件都不给 → 明确报错（不再默默建一条空任务）；
//   · 文件不存在 → 明确报错；
//   · stdin 只在 CLI 下可读（HTTP 的请求体不是 stdin）。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'nx-kv-addfile-'));
process.env.NX_KV_HOME = join(dir, 'home');
process.env.NX_KV_DB = join(dir, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');

const { ACTIONS } = await import('../../src/runtime/registry.js');
const addAction = ACTIONS.find((a) => a.id === 'localtask.add');
const { closeDb } = await import('../../src/core/db/index.js');

after(async () => {
  try { closeDb(); } catch { /* 已关 */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

test('#132 localtask.add --file：文件内容逐字成为任务正文（换行保留）', async () => {
  const file = join(dir, 'task.md');
  const body = '第一行：上下文\n第二行：工程知识\n第三行：关键路径 src/core/x.ts\n';
  writeFileSync(file, body, 'utf8');
  const r = await addAction.run({ file, cwd: join(dir, 'p1') }, { transport: 'cli' });
  assert.equal(r.status, 'ok');
  assert.equal(r.task.text, body.trim(), '正文逐字保留（含换行；末尾空行被去掉）');
});

test('#132 localtask.add：正文与文件都不给 → 明确报错（不再建空任务）', async () => {
  await assert.rejects(
    () => addAction.run({ cwd: join(dir, 'p2') }, { transport: 'cli' }),
    /任务正文为空/,
  );
});

test('#132 localtask.add --file：文件不存在 → 明确报错', async () => {
  await assert.rejects(
    () => addAction.run({ file: join(dir, 'nope.md'), cwd: join(dir, 'p3') }, { transport: 'cli' }),
    /任务正文文件不存在/,
  );
});

test('#132 localtask.add --file -：HTTP 下给明确错误（请求体不是 stdin）', async () => {
  await assert.rejects(
    () => addAction.run({ file: '-', cwd: join(dir, 'p4') }, { transport: 'http' }),
    /只能从命令行用/,
  );
});
