// #98：预览态（视图块）划选后按 Backspace/Delete 应删除选中文字。
//
// 背景：视图块是渲染好的 HTML，选区落在不可编辑内容上——浏览器默认对
// Backspace 无动于衷（用户实测：选中文字按 back 删不掉）。编辑态 textarea
// 的原生行为本来就正确，所以修复只补视图态：document 捕获的 keydown，把
// 选区文本用 indexOf 映射回块源码后删除（与 formatSelection 同一口径）。
//
// 这里做结构检查（前端行为在 node 里跑不动，端到端在 temp/ 探针里做）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/web/frontend/components/md/md-panes.jsx'), 'utf-8');

test('视图态划选删除：document 捕获的 Backspace/Delete 处理存在', () => {
  assert.match(src, /Backspace' && e\.key !== 'Delete'/, '同时接管 Backspace 与 Delete');
  assert.match(src, /document\.addEventListener\('keydown', onKey, true\)/, '捕获阶段挂 document');
});

test('可编辑元素内的按键不拦（原生行为保留）', () => {
  assert.match(
    src,
    /t\.tagName === 'TEXTAREA' \|\| t\.tagName === 'INPUT' \|\| t\.isContentEditable/,
    'textarea/input/contentEditable 直接放行'
  );
});

test('选区映射与 formatSelection 同口径：indexOf 不中保守放弃', () => {
  assert.match(src, /const pos = raw\.indexOf\(text\);/, 'indexOf 映射回块源码');
  assert.match(src, /if \(pos === -1\) return; \/\/ 跨标记\/跨块：保守放弃，不删/, '不中不删，不做错位改写');
});

test('删除走 op 通道：可撤销（历史栈）且删后光标落接缝', () => {
  assert.match(src, /updateAt\(i, raw\.slice\(0, pos\) \+ raw\.slice\(pos \+ text\.length\)\)/, '删除经 updateAt 提交');
  assert.match(src, /pendingSelRef\.current = \{ index: i, start: pos, end: pos \}/, '光标落接缝');
  assert.match(src, /onCloseSelMenu\?\.\(\);/, '划选浮层随手关闭');
});
