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
  // #124 起跨块选区升到块级处理（removeBlockRange），单块路径的注释不再提「跨块」
  assert.match(src, /if \(pos === -1\) return; \/\/ 跨标记：保守放弃，不删/, '不中不删，不做错位改写');
});

test('删除走 op 通道：可撤销（历史栈）且删后光标落接缝', () => {
  assert.match(src, /updateAt\(i, raw\.slice\(0, pos\) \+ raw\.slice\(pos \+ text\.length\)\)/, '删除经 updateAt 提交');
  assert.match(src, /pendingSelRef\.current = \{ index: i, start: pos, end: pos \}/, '光标落接缝');
  assert.match(src, /onCloseSelMenu\?\.\(\);/, '划选浮层随手关闭');
});

// ── #124：跨块选区（滑动选区）——块粒度的「统一删除 / 复制」 ──────────────
// 视图块的渲染 HTML 选区偏移映射不回源码，跨块操作升到块级：选区两端落在
// 不同视图块 → 整段块 [lo, hi] 就是操作单元。删除（Backspace/浮层按钮）与
// 复制（整段源码）共用同一区间语义。

test('#124 跨块删除：Backspace 分流到 removeBlockRange（块粒度整段移除）', () => {
  assert.match(src, /removeBlockRange\(Math\.min\(i, iff\), Math\.max\(i, iff\)\)/, '按块序整理成 [lo, hi] 后整段移除');
  assert.match(
    src,
    /const removeBlockRange = useCallback\(\(lo, hi\) => \{/,
    '删除实现收口在 removeBlockRange（keydown 与浮层按钮共用）'
  );
  assert.match(src, /next\.splice\(lo, hi - lo \+ 1\);/, '块粒度：触到的整段块全移除');
});

test('#124 浮层「删除选区」：editorApi.deleteBlockRange 暴露同一实现', () => {
  assert.match(src, /deleteBlockRange\(lo, hi\) \{\s*\n\s*return removeBlockRange\(lo, hi\);/, 'imperative handle 转发 removeBlockRange');
  const menu = readFileSync(join(root, 'src/web/frontend/components/md/sel-menu.jsx'), 'utf-8');
  assert.match(menu, /onDelete/, 'SelMenu 支持 onDelete 入参');
  assert.match(menu, /删除选区/, '浮层带「删除选区」按钮');
  const task = readFileSync(join(root, 'src/web/frontend/page/dir/task.jsx'), 'utf-8');
  assert.match(task, /deleteBlockRange\?\.\(br\[0\], br\[1\]\)/, '浮层按钮走 editorApi.deleteBlockRange');
});

test('#124 跨块复制：浮层 onCopy 对 blockRange 复制整段 Markdown 源码', () => {
  const task = readFileSync(join(root, 'src/web/frontend/page/dir/task.jsx'), 'utf-8');
  assert.match(task, /blockRange/, 'mouseup 时记下选区触到的块区间');
  assert.match(task, /liveBodyBlocks\(doc\.body\)/, '按同一块切分口径取源码');
  assert.match(task, /\.join\('\\n\\n'\)/, '块间按正文 joiner 拼接');
});
