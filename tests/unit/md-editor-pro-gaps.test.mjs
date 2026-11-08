// #99：md 编辑器对照专业编辑器的差距修复——结构钉（前端行为在 node 里跑不动，
// 端到端在 temp/ 探针里做）：
//   1. IME 组合守卫（块编辑器 + 源码态）——组合中按键归输入法
//   2. Delete 块尾正向合并（Backspace 并上块的镜像）
//   3. 视图态复选框点击切换（.mdw-cb → toggleNthTodo）
//   4. 源码态拖文件 = 粘贴图片同通道（与实时预览态对等）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/web/frontend/components/md/md-panes.jsx'), 'utf-8');

test('IME 守卫：块编辑器与源码态都在按键分发前拦组合输入', () => {
  const hits = src.match(/e\.nativeEvent\?\.isComposing \|\| e\.keyCode === 229/g) || [];
  assert.ok(hits.length >= 2, `组合守卫至少两处（块编辑器 + 源码态），实际 ${hits.length}`);
});

test('Delete 块尾合并：镜像 Backspace 并块，FM 块同样不并', () => {
  assert.match(src, /e\.key === 'Delete'\s*\n\s*&& ta\.selectionStart === val\.length/, '只在块尾无选区时接管');
  assert.match(src, /&& i < blocks\.length - 1 && !slashRef\.current/, '末块不接管');
  assert.match(src, /!isFrontmatterBlock\(normalizeBlockText\(blocks\[i \+ 1\] \?\? ''\)\)/, '下一块是 FM 块不并');
  assert.match(src, /pendingSelRef\.current = \{ index: i, start: val\.length, end: val\.length \}/, '光标落接缝');
});

test('视图态复选框可点：点击拦截 .mdw-cb 走 toggleNthTodo', () => {
  assert.match(src, /e\.target\.closest\?\.\('\.mdw-cb'\)/, '点击落在复选框上时接管');
  assert.match(src, /onToggleTodo\?\.\(index, cbs\.indexOf\(cb\)\)/, '按 DOM 序号映射到源码第 n 个 todo');
  assert.match(src, /toggleNthTodo\(raw, n\)/, '切换经纯函数 toggleNthTodo');
});

test('源码态拖放：textarea 有 onDrop 与粘贴同通道', () => {
  assert.match(src, /onDrop=\{\(e\) => \{\s*\n\s*\/\/ 拖文件进来/, '源码态 textarea 挂 onDrop');
  assert.match(src, /ingestImages\(files\);\s*\n\s*\}\}\s*\n\s*onMouseUp=/, '拖放入 ingestImages 与粘贴同通道');
});
