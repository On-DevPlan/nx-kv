// 任务页「提交编辑」的寻址回归（#190 删全局池时踩过）：
//
// 改归属项目时，任务**还在旧队列**，后端要先按 cwd 在原队列找到它，再按正文里的
// project 解析新落点搬家。如果前端把 cwd 传成目标项目的路径，getTask 会在目标队列
// 报「没有 #N 任务」——表现为 pending 任务改 repo 不生效 / 报错。
//
// 这段代码埋在 React hook 里，单测直接跑 hook 成本过高；这里做**定点源码断言**：
// 只锁住 submit 里 patchTaskItem 的 cwd 取值，不检查别的写法自由度。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(
  join(root, 'src', 'web', 'frontend', 'page', 'dir', 'task-actions.ts'),
  'utf8',
);

test('提交编辑用当前队列 cwd 寻址，不能用目标项目 cwd', () => {
  // patchTaskItem({ ... }) 里紧跟的 cwd 行
  const m = /patchTaskItem\(\{[\s\S]{0,400}?\bcwd:\s*([^,\n]+)/.exec(src);
  assert.ok(m, '找到 submit 里的 patchTaskItem 调用');
  const expr = (m[1] || '').trim();
  assert.equal(
    expr,
    'topic?.cwd',
    `改归属时用目标项目 cwd 会让后端找不到原任务（#190 回归）；实际为 ${expr}`,
  );
  assert.ok(
    !/\bprojTopic\b|rows\.find/.test(src),
    'submit 不应再按 fm.project 反查目标仓库来定 cwd',
  );
});

test('归属项目可编辑性与时间目标解耦（pending / plan / 草稿可改）', () => {
  const task = readFileSync(
    join(root, 'src', 'web', 'frontend', 'page', 'dir', 'task.tsx'),
    'utf8',
  );
  const section = /projectEditable=\{([^}]+)\}/.exec(task);
  assert.ok(section, 'BoardSection 用独立的 projectEditable 开关');
  const expr = (section[1] || '').replace(/\s+/g, ' ').trim();
  assert.match(expr, /isDraft/, '草稿可改');
  assert.match(expr, /status === 'pending'/, '待领取可改');
  assert.match(expr, /status === 'plan'/, '草稿态可改');
});
