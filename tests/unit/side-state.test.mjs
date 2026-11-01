// 侧栏三态分类（side-state.js）——weight 分档与落模型属性
import test from 'node:test';
import assert from 'node:assert/strict';
import { W_CLOSED, W_COLLAPSED, W_EXPANDED, W_CLOSED_MIN, classifySideState, sideStateAttrs, normalizeSidebarWeight } from '../../src/web/frontend/components/sidebar/side-state.js';

test('classifySideState: 三档 weight 各归其位', () => {
  assert.equal(classifySideState(W_CLOSED), 'closed');
  assert.equal(classifySideState(W_COLLAPSED), 'collapsed');
  assert.equal(classifySideState(W_EXPANDED), 'expanded');
});

test('classifySideState: 阈值边界（<2 closed / 2~8 collapsed / >=8 expanded）', () => {
  assert.equal(classifySideState(0.1), 'closed');
  assert.equal(classifySideState(1.99), 'closed');
  assert.equal(classifySideState(2), 'collapsed');
  assert.equal(classifySideState(7.99), 'collapsed');
  assert.equal(classifySideState(8), 'expanded');
  assert.equal(classifySideState(84), 'expanded');
});

test('classifySideState: 异常输入按展开处理（找不到 tabset / 手拖出的 0）', () => {
  assert.equal(classifySideState(undefined), 'expanded');
  assert.equal(classifySideState(null), 'expanded');
  assert.equal(classifySideState(0), 'expanded');
  assert.equal(classifySideState(-3), 'expanded');
  assert.equal(classifySideState('abc'), 'expanded');
});

test('classifySideState: 字符串数字也能分档（getWeight 兜底路径）', () => {
  assert.equal(classifySideState('2.5'), 'collapsed');
  assert.equal(classifySideState('16'), 'expanded');
});

test('sideStateAttrs: 三态落模型的 weight 与页签条开关', () => {
  assert.deepEqual(sideStateAttrs('expanded'), { weight: W_EXPANDED, enableTabStrip: true });
  assert.deepEqual(sideStateAttrs('collapsed'), { weight: W_COLLAPSED, enableTabStrip: false });
  assert.deepEqual(sideStateAttrs('closed'), { weight: W_CLOSED, enableTabStrip: false });
});

test('sideStateAttrs: 未知状态按展开兜底', () => {
  assert.deepEqual(sideStateAttrs('whatever'), { weight: W_EXPANDED, enableTabStrip: true });
});

test('闭环：三态各自落模型再读回，分类不变', () => {
  for (const s of ['expanded', 'collapsed', 'closed']) {
    const attrs = sideStateAttrs(s);
    assert.equal(classifySideState(attrs.weight), s);
  }
});

test('normalizeSidebarWeight: 病态小值拉回可渲染的关闭档', () => {
  assert.equal(normalizeSidebarWeight(0.09), W_CLOSED);
  assert.equal(normalizeSidebarWeight(W_CLOSED_MIN - 0.01), W_CLOSED);
  assert.equal(normalizeSidebarWeight(0), W_EXPANDED);
  assert.equal(normalizeSidebarWeight(W_COLLAPSED), W_COLLAPSED);
  assert.equal(normalizeSidebarWeight(W_EXPANDED), W_EXPANDED);
});
