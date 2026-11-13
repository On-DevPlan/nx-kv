// #190：面包屑语义拆开——每段路径独立可点（真正的面包屑），「返回」是独立的 ← 钮。
// #97 的「整段路径=返回钮」废除：md 编辑器（DocPanel）里的面包屑表现为
// 「是返回而不是面包屑」——看着是路径，点哪都是返回，层级点不进去。
// 结构检查（前端行为在 node 里跑不动，端到端在 temp/ 探针里做）：
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/web/frontend/components/layout/breadcrumb.tsx'), 'utf-8');
const css = readFileSync(join(root, 'src/web/frontend/styles-v2/dag.css'), 'utf-8');

test('「←」返回钮回来了：来处优先（onBack）、退父级兜底（onNavigate(back)）', () => {
  assert.match(src, /className="nx-crumb-back"/, '面包屑里有独立返回钮');
  assert.match(src, /title="返回上一级"/, '保留返回语义的 title');
  assert.match(
    src,
    /onClick=\{\(\) => \(onBack \? onBack\(\) : onNavigate\(back\)\)\}/,
    '点击 ← = 来处优先、退父级兜底'
  );
});

test('整段路径不再是单个大按钮（#97 的 nx-crumb-path 已删）', () => {
  assert.ok(!src.includes('nx-crumb-path'), '组件里不再有整段路径钮');
  assert.ok(!css.includes('nx-crumb-path'), '样式里不再有 nx-crumb-path 规则');
});

test('每段路径独立可点：非末段 + 有 hash + 能导航才渲染钮；当前层纯文本', () => {
  assert.match(src, /const isCurrent = i === trail\.length - 1;/, '末段 = 当前层');
  assert.match(src, /className="nx-crumb-t nx-crumb-link"/, '可点段用 nx-crumb-link');
  assert.match(src, /onClick=\{\(\) => onNavigate\(c\.hash\)\}/, '点段 = 导航到该层路由');
});

test('样式里有 nx-crumb-back 与 nx-crumb-link 两条规则', () => {
  assert.ok(css.includes('.nx-crumb-back'), '← 钮样式');
  assert.ok(css.includes('.nx-crumb-link'), '可点段样式');
});
