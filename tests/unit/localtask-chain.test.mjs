// 任务链（#74）单测：就地重开写入 history + taskChain.nodes；旧 forkOf 仍兼容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-chain-'));
process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'localtasks.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

const dirA = join(tmp, 'projA');
const dirB = join(tmp, 'projB');
const keyA = svc.normalizeCwd(dirA).key;

test('reopen：就地写 history；chain.nodes 含 origin + 事件 + current', async () => {
  const added = await svc.addTask({ cwd: dirA, text: '# 原任务\n\n做某事' });
  const re = await svc.reopenTask({
    cwd: dirA,
    id: added.task.id,
    text: '# 原任务\n\n+用户反馈：这里不对',
    feedback: '这里不对',
  });
  assert.equal(re.id, added.task.id, '同号');
  assert.equal(re.forked, false);
  assert.ok(re.task.history.length >= 2);
  assert.equal(re.task.history[0].kind, 'origin');
  assert.equal(re.task.history.at(-1).kind, 'reopen');

  const chain = await svc.taskChain({ cwd: dirA, id: re.task.id });
  assert.ok(chain.nodes.length >= 3, 'origin + reopen + current');
  assert.equal(chain.nodes[0].kind, 'origin');
  assert.equal(chain.nodes.at(-1).kind, 'current');
  assert.equal(chain.nodes.at(-1).current, true);
  assert.equal(chain.task.id, added.task.id);
});

test('addTask：裸数字 forkOf=同主题；forkKind 缺省 comment（旧派生仍可用）', async () => {
  const parent = await svc.addTask({ cwd: dirA, text: '# 父任务\n\n正文' });
  const child = await svc.addTask({ cwd: dirA, text: '# 评论任务\n\n问题', forkOf: parent.task.id });
  assert.equal(child.task.forkOf, `${keyA}:${parent.task.id}`);
  assert.equal(child.task.forkKind, 'comment');
  const chain = await svc.taskChain({ cwd: dirA, id: parent.task.id });
  assert.ok(chain.children.some((c) => c.id === child.task.id));
});

test('addTask：forkOf 跨主题用 "key:id"；父任务不存在直接报错', async () => {
  const parent = await svc.addTask({ cwd: dirA, text: '# 跨主题父任务' });
  const child = await svc.addTask({ cwd: dirB, text: '# 别的目录的子任务', forkOf: `${keyA}:${parent.task.id}` });
  assert.equal(child.task.forkOf, `${keyA}:${parent.task.id}`);
  assert.equal(child.task.key || child.key, svc.normalizeCwd(dirB).key, '子任务落在自己的主题');

  await assert.rejects(
    () => svc.addTask({ cwd: dirA, text: '# 虚链', forkOf: 99999 }),
    /forkOf 指向的任务不存在/,
  );
  await assert.rejects(
    () => svc.addTask({ cwd: dirA, text: '# 虚链2', forkOf: 'nosuchkey:1' }),
    /forkOf 指向的任务不存在/,
  );
});

test('旧数据兼容：无 forkKind 的行 normalizeTask 出空串；taskChain 正常', async () => {
  const t = svc.normalizeTask({ id: 1, text: '# 旧任务', status: 'pending', forkOf: 'abc:9' });
  assert.equal(t.forkKind, '');
  assert.equal(t.forkOf, 'abc:9');
  assert.deepEqual(t.history, []);
  const chain = await svc.taskChain({ key: '0000000000000000', id: 1 }).catch(() => null);
  assert.equal(chain, null, '主题/任务不存在 → notFound');
});

test('clone：内容逐字复制，不带派生链、不继承约束，源任务不动（#70）', async () => {
  const src = await svc.addTask({
    cwd: dirA,
    text: '# 模板任务\n\n正文原样',
    timegoal: { duration: '2h', prompt: '别漂' },
  });
  const c = await svc.cloneTask({ cwd: dirA, id: src.task.id });
  assert.equal(c.cloned, true);
  assert.equal(c.from.id, src.task.id);
  assert.ok(c.task.id !== src.task.id, '新编号');
  assert.equal(c.task.text, '# 模板任务\n\n正文原样', '正文逐字复制');
  assert.equal(c.task.forkOf, '', '克隆不建派生链');
  assert.equal(c.task.forkKind, '');
  assert.equal(c.task.timegoal, null, '不继承时间目标（约束跟着活走）');
  const back = await svc.taskChain({ cwd: dirA, id: src.task.id });
  assert.equal(back.task.status, 'pending');
  assert.equal(back.children.some((x) => x.id === c.task.id), false, '克隆不进链');
});

test('clone：全局任务的克隆仍进全局池', async () => {
  const g = await svc.addTask({ text: '# 全局模板任务', global: true });
  const c = await svc.cloneTask({ key: '__GLOBAL__', id: g.task.id });
  assert.equal(c.isGlobal, true);
  assert.equal(c.task.forkOf, '');
  assert.equal(c.task.text, '# 全局模板任务');
});
