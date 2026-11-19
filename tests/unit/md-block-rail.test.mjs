// 块级结构操作（#205 md 编辑器 UIUX）：
//   1. moveBlockInList / reindexAfterMove —— 拖拽排序与 Alt+↑↓ 共用的纯逻辑
//   2. 结构钉：块侧栏挂进每块、落点指示由列表级拖拽算出、Alt+↑↓ 挂在块列表容器上
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moveBlockInList, reindexAfterMove } from '../../src/web/frontend/modules/md/md-edit-ops.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const panes = readFileSync(join(root, 'src/web/frontend/components/md/panes/md-panes.tsx'), 'utf-8');
const rail = readFileSync(join(root, 'src/web/frontend/components/md/rails/block-rail.tsx'), 'utf-8');
const drag = readFileSync(join(root, 'src/web/frontend/components/md/hooks/use-block-drag.ts'), 'utf-8');

test('moveBlockInList：移动后源块占 to 位（前移/后移对称）', () => {
  assert.deepEqual(moveBlockInList(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveBlockInList(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assert.deepEqual(moveBlockInList(['a', 'b', 'c', 'd'], 1, 2), ['a', 'c', 'b', 'd']);
});

test('moveBlockInList：原地/越界/单块都返回等值新数组，不动原数组', () => {
  const src = ['a', 'b'];
  const same = moveBlockInList(src, 1, 1);
  assert.deepEqual(same, src);
  assert.notEqual(same, src, '返回副本，调用方改写不会污染原列表');
  assert.deepEqual(moveBlockInList(src, -5, 99), ['b', 'a'], '两端下标夹回合法区间');
  assert.deepEqual(moveBlockInList(['only'], 0, 1), ['only'], '单块无从移动');
  assert.deepEqual(moveBlockInList([], 0, 1), []);
});

test('reindexAfterMove：焦点跟着块走，跨过的块整体让位一格', () => {
  // 移动块自己落 to
  assert.equal(reindexAfterMove(0, 0, 2), 2);
  // 后移：中间的块左移
  assert.equal(reindexAfterMove(1, 0, 2), 0);
  assert.equal(reindexAfterMove(2, 0, 2), 1);
  // 前移：中间的块右移
  assert.equal(reindexAfterMove(1, 2, 0), 2);
  assert.equal(reindexAfterMove(0, 2, 0), 1);
  // 区间外不动
  assert.equal(reindexAfterMove(3, 0, 2), 3);
});

test('结构钉：每块都挂侧栏，把手支持拖拽，落点指示来自列表级状态', () => {
  assert.match(panes, /rail=\{\(\s*<BlockRail/, 'LiveBlock 每块都渲染 BlockRail');
  assert.match(panes, /dropEdge=\{drag\.dropAt && drag\.dropAt\.index === i \? drag\.dropAt\.edge : null\}/, '落点指示按块下标下发');
  assert.match(rail, /draggable/, '把手可拖拽');
  assert.match(rail, /dragIndexRef\.current = index/, 'dragstart 写拖拽源');
  assert.match(drag, /const edge: BlockDropAt\['edge'\] = e\.clientY < rect\.top \+ rect\.height \/ 2 \? 'before' : 'after'/, '落点按上半/下半分前后');
  assert.match(drag, /if \(from < to\) to -= 1;/, '源块先被抽走，落点下标要扣一格');
});

test('结构钉：Alt+↑↓ 挂在块列表容器（视图态与编辑态同一入口）', () => {
  assert.match(panes, /const onBlocksKeyDown = \(e: ReactKeyboardEvent<HTMLDivElement>\) => \{/, '列表容器级按键处理器');
  assert.match(panes, /if \(!e\.altKey \|\| e\.shiftKey \|\| \(e\.key !== 'ArrowUp' && e\.key !== 'ArrowDown'\)\) return;/, '只接管 Alt+↑↓');
  assert.match(panes, /<div\s*\n\s*className=\{`mdw-lp-blocks/, '块列表容器存在');
  assert.match(panes, /\{\.\.\.drag\.listProps\}/, '拖拽处理器铺在列表容器上');
});

test('结构钉：侧栏交互不让事件冒泡到块容器（否则点把手会切成编辑态）', () => {
  assert.match(rail, /onMouseDown=\{stop\}/);
  assert.match(rail, /onClick=\{stop\}/);
});
