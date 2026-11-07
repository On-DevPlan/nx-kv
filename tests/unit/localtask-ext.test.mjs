// ext（待领取队列余量）的数据口径：只统计同一主题、排除当前任务、标题取正文首行。
//
// 存储一律指向临时库，绝不写脏用户目录。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as svc from '../../src/modules/localtask/service.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-ext-'));
const dirA = join(tmp, 'projA');
const dirB = join(tmp, 'projB');
mkdirSync(dirA, { recursive: true });
mkdirSync(dirB, { recursive: true });
process.env.NX_KV_DB = join(tmp, 'nxkv.db');
process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'localtasks.json');
process.env.NX_KV_CONFIG = join(tmp, 'config.json');

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

test('pendingQueueInfo：同主题、排除当前任务、标题去 frontmatter 与 #', async () => {
  const a1 = await svc.addTask({ cwd: dirA, text: '# 甲一\n\n正文' });
  const a2 = await svc.addTask({ cwd: dirA, text: '---\nboard: b1\n---\n# 甲二\n\n正文' });
  const b1 = await svc.addTask({ cwd: dirB, text: '# 乙一' });

  const info = await svc.pendingQueueInfo(svc.normalizeCwd(dirA).key, a1.task.id);
  assert.equal(info.count, 1, '同主题剩余 1 条，不把 B 主题算进来');
  assert.deepEqual(info.list.map((x) => x.id), [a2.task.id]);
  assert.equal(info.list[0].title, '甲二', 'frontmatter 跳过，前导 # 去掉');
  assert.equal(info.list[0].topic, svc.normalizeCwd(dirA).name, '带上主题名');

  const empty = await svc.pendingQueueInfo(svc.normalizeCwd(dirB).key, b1.task.id);
  assert.equal(empty.count, 0, '只剩当前任务时余量为 0');
  assert.deepEqual(empty.list, []);
});
