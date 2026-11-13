// #189：md 编辑器快捷键——Ctrl+S 按住不放会按键盘重复率反复保存、反复弹 toast（抖动）。
// 这里钉住判定层（纯函数）与两处结构（快捷键入口 / toast 去重），端到端在 temp/ 探针里做。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMBO_GAP_MS, createComboGate, docComboOf } from '../../src/web/frontend/components/md/doc-keys.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf-8');

const key = (over = {}) => ({
  key: 's', ctrlKey: true, metaKey: false, altKey: false, repeat: false, isComposing: false,
  ...over,
});

test('只认完整组合按击：Ctrl/⌘ + 单个字母', () => {
  assert.equal(docComboOf(key()), 's');
  assert.equal(docComboOf(key({ ctrlKey: false, metaKey: true })), 's', '⌘ 同为 mod');
  assert.equal(docComboOf(key({ key: 'S' })), 's', '大写键归一成小写');
  assert.equal(docComboOf(key({ key: 'z' })), 'z');
});

test('修饰键本身 / 无修饰键 / 带 alt 都不接管', () => {
  assert.equal(docComboOf(key({ key: 'Control' })), null, 'Control 单独按下不算');
  assert.equal(docComboOf(key({ key: 'Shift' })), null);
  assert.equal(docComboOf(key({ ctrlKey: false, metaKey: false })), null, '裸字母是输入，不是快捷键');
  assert.equal(docComboOf(key({ altKey: true })), null, 'AltGr 等组合留给系统');
});

test('按住不放的自动重复不算新按键（抖动根因）', () => {
  assert.equal(docComboOf(key({ repeat: true })), null);
});

test('输入法组合中归输入法', () => {
  assert.equal(docComboOf(key({ isComposing: true })), null);
  assert.equal(docComboOf(key({ keyCode: 229 })), null);
});

test('节流闸门：窗口内只放行第一次，窗口外放行，按键之间互不影响', () => {
  assert.ok(COMBO_GAP_MS >= 200, '间隔得够长才吞得掉按住');
  const gate = createComboGate(400);
  assert.equal(gate('save', 1000), true);
  assert.equal(gate('save', 1200), false, '窗口内连击被吞');
  assert.equal(gate('save', 1399), false);
  assert.equal(gate('save', 1400), true, '过了窗口就是新的一次保存');
  assert.equal(gate('undo', 1401), true, '按不同按键计时，不互相挡');
});

test('结构钉：文档级快捷键走判定函数 + 保存节流', () => {
  const src = read('src/web/frontend/components/md/md-panes-root.tsx');
  assert.match(src, /const k = docComboOf\(e\)/, '按键先过 docComboOf 归一');
  assert.match(src, /if \(!saveGateRef\.current\('save', Date\.now\(\)\)\) return;/, '保存前过闸门');
  assert.match(src, /e\.preventDefault\(\);\s*\n\s*if \(!saveGateRef/, '被节流掉也要 preventDefault，别让浏览器弹另存');
});

test('结构钉：toast 同文案原地续时，不再压新节点', () => {
  const src = read('src/web/frontend/components/toast/index.tsx');
  assert.match(src, /if \(same\) \{\s*\n\s*arm\(same\.id\)/, '同文案 → 续时');
  assert.match(src, /MAX_STACK/, '栈有上限，提示区高度稳定');
});
