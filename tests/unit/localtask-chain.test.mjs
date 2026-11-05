// 任务链（#69）单测：forkOf/forkKind 的写入契约 + taskChain 查询。
//
// 钉三件事：
//   1. reopen 派生的新任务带 forkOf（'key:旧编号'）+ forkKind 'reopen'，旧任务被
//      supersededBy 指向——chain 的祖先/子任务两个方向都能查到；
//   2. addTask 接受 forkOf（裸数字=同主题 / 'key:id'=跨主题）+ forkKind，父任务
//      不存在直接报错（链是拿来查的，虚链没意义）；
//   3. 旧数据（无 forkKind）读出来 forkKind 为空串，不炸 normalizeTask。
//
// 存储一律指向临时文件，绝不写脏用户目录。
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
const keyB = svc.normalizeCwd(dirB).key;

test('reopen：forkOf + forkKind=reopen 落库；chain 双向可查', async () => {
  const added = await svc.addTask({ cwd: dirA, text: '# 原任务\n\n做某事' });
  const re = await svc.reopenTask({ cwd: dirA, id: added.task.id, text: '# 原任务\n\n+用户反馈：这里不对' });
  assert.equal(re.task.forkOf, `${keyA}:${added.task.id}`);
  assert.equal(re.task.forkKind, 'reopen');
  assert.equal(re.archived.supersededBy.key, keyA);
  assert.equal(re.archived.supersededBy.id, re.task.id);

  const chain = await svc.taskChain({ cwd: dirA, id: re.task.id });
  assert.equal(chain.ancestors.length, 1, '祖先链一层');
  assert.equal(chain.ancestors[0].id, added.task.id);
  assert.equal(chain.ancestors[0].status, 'archived', '旧任务已归档');
  assert.equal(chain.ancestors[0].excerpt, '原任务', '节取首行并去掉 # 前缀');
  // 从旧任务反查：子任务就是重开出来的新任务
  const back = await svc.taskChain({ cwd: dirA, id: added.task.id });
  assert.equal(back.children.length, 1);
  assert.equal(back.children[0].id, re.task.id);
  assert.equal(back.children[0].forkKind, 'reopen');
});

test('addTask：裸数字 forkOf=同主题；forkKind 缺省 comment', async () => {
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
  assert.equal(child.task.key || child.key, keyB, '子任务落在自己的主题');

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
  // 链上引用指向不存在的行 → 如实标注 missing，不静默吞
  const chain = await svc.taskChain({ key: '0000000000000000', id: 1 }).catch(() => null);
  assert.equal(chain, null, '主题/任务不存在 → notFound（这里没有该主题）');
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
  // 源任务不动：仍 pending，链上也没有克隆这条
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
