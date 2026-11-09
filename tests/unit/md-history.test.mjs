// md-history 撤销栈钉子（#156）：typing 合并窗口撤销一次回退整段；op 各自成条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushHistory, undoHistory, redoHistory } from '../../src/web/frontend/modules/md/md-history.js';

// 打桩 Date.now 控制合并窗口（node --test 每个文件独立进程，桩不外泄）
let nowMs = 1_000_000;
Date.now = () => nowMs;

test('typing 连续输入：撤销一次回退整段（不是只退一个字符）', () => {
  const store = new Map();
  pushHistory(store, 'd', { title: '', body: '' }, 'typing');
  for (const ch of 'ABC') {
    nowMs += 50; // 窗口内（<700ms）
    pushHistory(store, 'd', { title: '', body: `旧${ch}` }, 'typing');
  }
  const snap = undoHistory(store, 'd', { title: '', body: '旧C' });
  assert.equal(snap.body, '', '撤销应回到整段输入开始前（段首快照）');
});

test('超窗后的新一段输入各自成条', () => {
  const store = new Map();
  pushHistory(store, 'd', { title: '', body: 'A0' }, 'typing');
  nowMs += 50;
  pushHistory(store, 'd', { title: '', body: 'A' }, 'typing'); // 合并进段首
  nowMs += 5_000; // 超窗
  pushHistory(store, 'd', { title: '', body: 'B0' }, 'typing');
  nowMs += 50;
  pushHistory(store, 'd', { title: '', body: 'B' }, 'typing');
  // 撤销第二段 → 回到段首 B0；再撤销 → 回到第一段段首 A0
  const s1 = undoHistory(store, 'd', { title: '', body: 'B' });
  assert.equal(s1.body, 'B0');
  const s2 = undoHistory(store, 'd', { title: '', body: 'B0' });
  assert.equal(s2.body, 'A0');
});

test('op 类改动各自成条、断开合并窗口', () => {
  const store = new Map();
  // push 存的是改动**前**快照：typing 段（段首 'x'）→ op 的前置态是 'y'
  pushHistory(store, 'd', { title: '', body: 'x' }, 'typing');
  nowMs += 10;
  pushHistory(store, 'd', { title: '', body: 'y' }, 'op'); // 紧跟的 op 不并入 typing 段
  const s = undoHistory(store, 'd', { title: '', body: 'z' });
  assert.equal(s.body, 'y', 'op 的前置快照自成一条，撤销先回到它');
  const s2 = undoHistory(store, 'd', { title: '', body: 'y' });
  assert.equal(s2.body, 'x', '再撤销回到 typing 段首');
});

test('redo：undo 后 redo 回到撤销前状态', () => {
  const store = new Map();
  pushHistory(store, 'd', { title: '', body: 'old' }, 'op');
  const undone = undoHistory(store, 'd', { title: '', body: 'new' });
  assert.equal(undone.body, 'old');
  const redone = redoHistory(store, 'd', { title: '', body: 'new' });
  assert.equal(redone.body, 'new');
});

test('空历史撤销返回 null（不抛错）', () => {
  const store = new Map();
  assert.equal(undoHistory(store, 'none', { title: '', body: 'x' }), null);
});
