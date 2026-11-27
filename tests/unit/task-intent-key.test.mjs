// #156：「直接提交」的 intent key 契约。
//
// 参数填写页（fill.tsx）setTaskIntent 存 intent，任务页（dir/task.tsx）mount 时
// takeTaskIntent 取走并自动 submit。两侧的 key 必须是**同一个 docId**——
// 曾经 fill 存的是裸草稿 id（d_xxx），任务页取的是 docIdOf(scope, task)
// （scope::xxx::d_xxx），永远取不到 → 自动提交从未触发，「直接提交」退化成
// 「进入编辑页」，用户必须再手动点一次提交。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// fill 页的 PluginClientApi 由 client-api.ts 统一构造（plugin-page 与任务页 dock 共用）。
const fillSrc = readFileSync(join(root, 'src/web/frontend/plugin-host/client-api.ts'), 'utf8');
const taskSrc = readFileSync(join(root, 'src/web/frontend/page/dir/task.tsx'), 'utf8');
// #191：自动提交逻辑从 task.tsx 抽到 use-auto-submit.ts（task.tsx 行数门禁），取 intent 的断言落在这里
const hookSrc = readFileSync(join(root, 'src/web/frontend/page/dir/use-auto-submit.ts'), 'utf8');

test('契约：fill 页存 intent 用的 key 是 docId（与任务页 docIdOf(scope, task) 同形）', () => {
  // 不许再出现 setTaskIntent(task, ...) —— 那是裸草稿 id，任务页按 docId 取永远 miss
  assert.ok(
    /setTaskIntent\(\s*docId\s*,/.test(fillSrc),
    'fill.tsx 的 setTaskIntent 必须传 docId（task.tsx 按 docIdOf(scope, task) 取）',
  );
  assert.ok(!/setTaskIntent\(\s*task\s*,/.test(fillSrc), '不许把裸 task id 当 intent key');
});

test('契约：任务页取 intent 用的是 docId 形态的 id', () => {
  assert.ok(/takeTaskIntent\(\s*id\s*\)/.test(hookSrc), 'use-auto-submit hook 按本页 id（docId）取 intent');
  assert.ok(/useAutoSubmit\(\s*id\s*,/.test(taskSrc), 'task.tsx 把本页 id（docId）传给 hook');
  assert.ok(
    /const id = docIdOf\(scope, task\)/.test(taskSrc),
    'task.tsx 的 id 必须来自 docIdOf(scope, task)',
  );
});

test('task-intent 模块行为：取后即删，同一 key 只消费一次', async () => {
  const mod = await import('../../src/web/frontend/modules/md/task-intent.ts');
  mod.setTaskIntent('a::1', { submit: true });
  assert.deepEqual(mod.takeTaskIntent('a::1'), { submit: true }, '第一次取到');
  assert.equal(mod.takeTaskIntent('a::1'), undefined, '取后即删：第二次拿不到');
  // 裸 id 与 docId 形态是不同的 key（钉住「不匹配就取不到」的事实）
  mod.setTaskIntent('bare-id', { submit: true });
  assert.equal(mod.takeTaskIntent('scope::x::bare-id'), undefined, 'key 不同形 → 取不到');
});
