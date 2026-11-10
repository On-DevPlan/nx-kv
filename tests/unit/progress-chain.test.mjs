// 进程面板的任务链折叠（#172）：纯函数，无 DOM、无 IO。
//
// 背景：反馈任务链动辄几十轮，进程面板把它们**累计**摊开 → 读重复内容太费劲。
// 口径：面板只留**链尖**（最新一轮），旧轮次折叠；旧轮次在任务页「更多 → 任务链」
// 里看。判据 = 后端给的 childRoundCount（reopen 边数）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChainTip, splitChainTips } from '../../src/web/frontend/modules/md/progress-chain.js';
import { hitExactId } from '../../src/web/frontend/modules/md/progress-search.js';

test('isChainTip：childRoundCount = 0（没有下一轮）才是链尖', () => {
  assert.equal(isChainTip({ id: 1 }), true, '缺字段（老数据）当链尖');
  assert.equal(isChainTip({ id: 2, childRoundCount: 0 }), true);
  assert.equal(isChainTip({ id: 3, childRoundCount: 2 }), false, '有下一轮 → 旧轮次');
  assert.equal(isChainTip({ id: 4, childRoundCount: '1' }), false, '字符串数字也算有下一轮');
  assert.equal(isChainTip(null), true);
});

test('splitChainTips：链尖与旧轮次分开，顺序保持原样', () => {
  const { tips, folded } = splitChainTips([
    { id: 1, childRoundCount: 1 },
    { id: 2 },
    { id: 3, childRoundCount: 1 },
    { id: 4, childRoundCount: 0 },
  ]);
  assert.deepEqual(tips.map((t) => t.id), [2, 4]);
  assert.deepEqual(folded.map((t) => t.id), [1, 3]);
  assert.deepEqual(splitChainTips([]), { tips: [], folded: [] });
});

test('hitExactId：只有编号等值才召回折叠的旧轮次', () => {
  assert.equal(hitExactId({ id: 87 }, '87'), true);
  assert.equal(hitExactId({ id: 87 }, '#87'), true);
  assert.equal(hitExactId({ id: 87 }, ' 87 '), true);
  assert.equal(hitExactId({ id: 87, title: '87 号任务' }, '87'), true, '编号优先于标题');
  // 前缀 / 标题模糊不召回——一召回就把几十条旧轮次重新堆回屏上
  assert.equal(hitExactId({ id: 87 }, '8'), false);
  assert.equal(hitExactId({ id: 87 }, '870'), false);
  assert.equal(hitExactId({ id: 87 }, '标题'), false);
  assert.equal(hitExactId({ id: 87 }, '8*7'), false);
  // 组模式：编号取 taskId
  assert.equal(hitExactId({ id: 'k:87', taskId: 87 }, '87'), true);
});
