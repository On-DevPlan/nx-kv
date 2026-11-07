// 撤销/恢复按钮必须有**可见文字**（#95 验收反馈判「未实现」的根因）。
//
// 背景：#93 把 ↶↷ 文本字形换成线形图标后，按钮的 textContent / innerText
// **全空**（纯 SVG）——按文字找按钮的工具定位不到，验收判「未实现」，
// 而人眼看到的也只是两枚认不出的图标。图标给形、文字给名，两者都要。
//
// 这里做**结构检查**（前端行为在 node 里跑不动，端到端在 temp/ 探针里做）：
// 两颗按钮必须同时有 <span> 文字节点与 aria-label。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sidebar = readFileSync(join(root, 'src/web/frontend/components/sidebar/index.jsx'), 'utf-8');
const panel = readFileSync(join(root, 'src/web/frontend/components/sidebar/panel.jsx'), 'utf-8');

test('侧栏展开态：撤销/恢复按钮带可见文字「撤销」「恢复」', () => {
  const undo = sidebar.slice(sidebar.indexOf('className="iconbtn labeled undo"'));
  const redo = sidebar.slice(sidebar.indexOf('className="iconbtn labeled redo"'));
  assert.ok(undo.length && redo.length, '两颗按钮都用 labeled 形态');
  assert.match(undo, /<span>撤销<\/span>/, '撤销要有可见文字节点');
  assert.match(redo, /<span>恢复<\/span>/, '恢复要有可见文字节点');
  assert.match(undo, /aria-label="撤销上一次布局操作"/, '撤销要有 aria-label');
  assert.match(redo, /aria-label="恢复上一次布局操作"/, '恢复要有 aria-label');
});

test('侧栏收起态（窄轨）：撤销/恢复按钮同样带可见文字', () => {
  const rail = panel.slice(panel.indexOf('nx-rail-acts'));
  assert.match(rail, /撤销/, '窄轨有撤销按钮');
  assert.match(rail, /恢复/, '窄轨有恢复按钮');
  // 窄轨里是纯文字按钮（竖排空间窄），文字即内容（不是 <span> 包着的图标钮）
  assert.match(rail, /className="nx-rail-act labeled"[\s\S]{0,220}?>\s*撤销\s*</, '窄轨撤销是纯文字');
  assert.match(rail, /className="nx-rail-act labeled"[\s\S]{0,220}?>\s*恢复\s*</, '窄轨恢复是纯文字');
});

test('labeled 按钮样式：文字不隐藏（display:none 会让 innerText 变空、工具又定位不到）', () => {
  const css = readFileSync(join(root, 'src/web/frontend/style-v2.css'), 'utf-8');
  // 只看**与 labeled 相关的选择器块**（整段切片会裹进后面的无关规则）
  const blocks = css
    .split('}')
    .map((b) => (b.replace(/\/\*[\s\S]*?\*\//g, '').trim()))
    .filter((b) => b.includes('.iconbtn.labeled') || b.includes('.nx-rail-act.labeled'));
  assert.ok(blocks.length, '样式里有 labeled 形态');
  for (const b of blocks) {
    assert.ok(!/display:\s*none/.test(b), `labeled 规则不得隐藏文字：${b.slice(0, 80)}`);
  }
});
