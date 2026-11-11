// #97：面包屑上独立的「←」返回键已删，整段路径**本身就是返回钮**。
// 结构检查（前端行为在 node 里跑不动，端到端在 temp/ 探针里做）：
// breadcrumb.jsx 不再出现 nx-crumb-back；路径包在可点的 button.nx-crumb-path 里，
// 且仅在「有上一级 + 能导航」时渲染可点形态（总览这类顶层页退化为纯文本）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/web/frontend/components/layout/breadcrumb.tsx'), 'utf-8');
const css = readFileSync(join(root, 'src/web/frontend/style-v2.css'), 'utf-8');

test('独立「←」返回键已删（nx-crumb-back 不再出现在组件与样式里）', () => {
  assert.ok(!src.includes('nx-crumb-back'), 'breadcrumb.jsx 不再有返回箭头钮');
  assert.ok(!css.includes('nx-crumb-back'), '样式里不再有 nx-crumb-back 规则');
});

test('整段路径包在 button.nx-crumb-path 里，点击走原返回行为', () => {
  assert.match(src, /className="nx-crumb-path"/, '路径有可点形态');
  assert.match(src, /title="返回上一级"/, '保留返回语义的 title');
  assert.match(
    src,
    /onClick=\{\(\) => \(onBack \? onBack\(\) : onNavigate\(back\)\)\}/,
    '点击 = 来处优先（onBack）、退父级兜底（onNavigate(back)）'
  );
});

test('没有上一级（back 为空）时不渲染可点钮，路径退化为纯文本', () => {
  const gate = src.indexOf('!(back && onNavigate)');
  const btn = src.indexOf('nx-crumb-path');
  assert.ok(gate > -1, '有「back && onNavigate」不满足的分支');
  assert.ok(btn > gate, '可点钮只在该分支之后（顶层页纯文本）');
});
