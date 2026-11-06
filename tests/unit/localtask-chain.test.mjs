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

test('reopen 派生新任务：链 = task_links（R1→R2），节点 seq 做 key', async () => {
  const added = await svc.addTask({ cwd: dirA, text: '# 原任务\n\n做某事' });
  const re = await svc.reopenTask({
    cwd: dirA,
    id: added.task.id,
    text: '# 原任务\n\n+用户反馈：这里不对',
    feedback: '这里不对',
  });
  assert.notEqual(re.id, added.task.id, '派生 = 新编号');
  assert.equal(re.kind, 'reopen');
  assert.equal(re.parentId, added.task.id);
  assert.equal(re.task.status, 'pending', '新任务立即可领');
  assert.match(re.task.text, /这里不对/, '反馈段跟正文走');

  const chain = await svc.taskChain({ cwd: dirA, id: re.id });
  assert.equal(chain.status, 'ok');
  assert.equal(chain.round, 2, 'R2');
  assert.equal(chain.derivedFrom && chain.derivedFrom.includes(added.task.id), true, '派生自 R1');
  // 节点从根到叶：R1（done 保持）→ R2（当前尖）
  assert.equal(chain.nodes.length, 2, '每轮一条任务');
  assert.equal(chain.nodes[0].id, added.task.id);
  assert.equal(chain.nodes.at(-1).id, re.id);
  assert.equal(chain.nodes.at(-1).current, true, '当前尖 = 查询的那条');
  assert.equal(chain.task.id, re.id);
  // 父是 pending 被重开 → cancelled + superseded 标记（done 父则保持 done）
  const parent = await svc.getTask({ cwd: dirA, id: added.task.id });
  assert.equal(parent.status, 'cancelled');
  assert.equal(parent.supersededBy, re.id, 'ext_superseded_by 指向派生的新任务');
});

test('addTask：裸数字 forkOf=同主题；跨主题用 "key:id"（派生链写入 task_links）', async () => {
  const b = await svc.addTask({ cwd: dirB, text: '# B 的任务', forkOf: 'nosuchkey:1' }).catch(() => null);
  assert.equal(b, null, '父任务不存在 → 报错');
});

test('addTask：forkOf 跨主题用 "key:id"；父任务不存在直接报错', async () => {
  const repo = svc.repo;
  const parent = await svc.addTask({ cwd: dirA, text: '# 跨主题父任务' });
  const child = await svc.addTask({ cwd: dirB, text: '# 别的目录的子任务', forkOf: `${keyA}:${parent.task.id}` });
  // T04：forkOf 落 task_links（视图不再暴露 forkOf 字段）
  const parentLink = repo.links.parentLink(
    repo.tasks.getTaskRow(repo.topics.getTopic(svc.normalizeCwd(dirB).key).id, child.task.id).row.id
  );
  assert.equal(parentLink.dst_id, parent.task.id, '链指向父任务');
  assert.equal(parentLink.type, 'comment', 'forkKind 缺省 comment');
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

test('旧数据兼容：normalizeTask 不再暴露 forkOf/forkKind/history（T04 下线）', async () => {
  const t = svc.normalizeTask({ id: 1, text: '# 旧任务', status: 'pending', forkOf: 'abc:9' });
  assert.equal(t.forkOf, undefined, 'forkOf 字段已下线');
  assert.equal(t.forkKind, undefined);
  assert.equal(t.history, undefined);
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
  assert.equal(c.task.timegoal, null, '不继承 timegoal');
  // 源任务不动
  const srcAfter = await svc.getTask({ cwd: dirA, id: src.task.id });
  assert.equal(srcAfter.status, 'pending');
  assert.equal(srcAfter.text, '# 模板任务\n\n正文原样');
});

test('clone：全局任务的克隆仍进全局池', async () => {
  const g = await svc.addTask({ text: '# 全局模板任务', global: true });
  const c = await svc.cloneTask({ key: '__GLOBAL__', id: g.task.id });
  assert.equal(c.isGlobal, true);
  assert.equal(c.task.text, '# 全局模板任务');
});
