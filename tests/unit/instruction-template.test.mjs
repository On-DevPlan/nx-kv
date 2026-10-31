// instruction-template 纯函数单测（仿 localtask-board.test.mjs：纯 fixture、无 store、无 env）。
// 钉死的契约：段落按 ctx 有无整段丢弃、占位符缺失一律 ''、单遍渲染（插入值永不再扫描）、
// 独立行段落标记整行移除、时间格式化与 timegoal fmtDur/renderCheck 措辞对齐。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasTemplateMarkers,
  renderInstruction,
  formatDuration,
  formatGoalTiming,
} from '../../src/core/instruction-template.js';

// ─── hasTemplateMarkers ────────────────────────────────────────────────

test('hasTemplateMarkers：任何 {{ 即模板，纯文本/空值不是', () => {
  assert.equal(hasTemplateMarkers(''), false);
  assert.equal(hasTemplateMarkers(null), false);
  assert.equal(hasTemplateMarkers(undefined), false);
  assert.equal(hasTemplateMarkers('规划计划，然后 wait 收尾'), false);
  assert.equal(hasTemplateMarkers('{{'), true);
  assert.equal(hasTemplateMarkers('{{#goal}}x{{/goal}}'), true);
  assert.equal(hasTemplateMarkers('前缀 {{task.text}} 后缀'), true);
});

// ─── 占位符 ────────────────────────────────────────────────────────────

test('占位符：嵌套路径与顶层键都按 . 分段解析', () => {
  const ctx = {
    goal: { name: 'proj', prompt: 'P', remainingHuman: '剩余 2 小时' },
    task: { id: 7, text: 'BODY' },
    source: 'global',
    cwd: 'D:/w',
  };
  assert.equal(renderInstruction('{{goal.name}}|{{source}}|{{cwd}}|{{task.id}}', ctx), 'proj|global|D:/w|7');
  assert.equal(renderInstruction('{{task.text}}', ctx), 'BODY');
});

test('占位符：缺失一律空串（未知路径 / 缺段落 / 缺 ctx / 空花括号）', () => {
  assert.equal(renderInstruction('[{{goal.name}}]', {}), '[]');
  assert.equal(renderInstruction('[{{task.text}}]', { task: null }), '[]');
  assert.equal(renderInstruction('[{{task.text}}]', { task: {} }), '[]');
  assert.equal(renderInstruction('[{{nope.deep}}]', { goal: {} }), '[]');
  assert.equal(renderInstruction('[{{ }}]', { goal: { name: 'x' } }), '[]');
  assert.equal(renderInstruction('[{{ goal.name }}]', { goal: { name: 'x' } }), '[x]', '路径两侧空格被 trim');
});

// ─── 段落 ──────────────────────────────────────────────────────────────

test('段落：ctx 缺失整段丢弃（含内联与独立行两种写法）', () => {
  // 内联：丢弃后前后片段直接拼接
  assert.equal(renderInstruction('A{{#goal}}G{{/goal}}B', {}), 'AB');
  assert.equal(renderInstruction('A{{#goal}}G{{/goal}}B', { goal: { name: 'x' } }), 'AGB');
  // 独立行：标记行整行移除，段落丢弃后不留空行
  const tpl = ['头部', '{{#goal}}', '目标行 {{goal.name}}', '{{/goal}}', '尾部'].join('\n');
  assert.equal(renderInstruction(tpl, {}), '头部\n尾部');
  const kept = renderInstruction(tpl, { goal: { name: 'proj' } });
  assert.equal(kept, '头部\n目标行 proj\n尾部');
});

test('段落：task 段与 goal 段各自独立开关', () => {
  const tpl = '{{#task}}[{{task.id}}]{{/task}}{{#goal}}(G){{/goal}}';
  assert.equal(renderInstruction(tpl, { task: { id: 3 } }), '[3]');
  assert.equal(renderInstruction(tpl, { goal: { name: 'x' } }), '(G)');
  assert.equal(renderInstruction(tpl, { task: { id: 3 }, goal: { name: 'x' } }), '[3](G)');
  assert.equal(renderInstruction(tpl, {}), '');
});

test('段落：close 按名匹配弹栈，错配 close 是无操作（钉死）', () => {
  // 同名嵌套：第一个 close 弹内层，外层继续
  assert.equal(renderInstruction('A{{#goal}}X{{/goal}}Y{{/goal}}Z', { goal: { name: 'g' } }), 'AXYZ');
  // 多余的 close 是无操作（弹空栈）
  assert.equal(renderInstruction('A{{/goal}}B', { goal: { name: 'g' } }), 'AB');
  // 未知段落标记落占位符分支 → ''
  assert.equal(renderInstruction('A{{#other}}B{{/other}}C', {}), 'ABC');
  // 错配 close 不弹栈：被丢弃 task 段的内容不会提前见光
  assert.equal(
    renderInstruction('{{#goal}}A{{#task}}B{{/goal}}C{{/task}}D', { goal: { name: 'g' } }),
    'AD',
    'C 在被丢弃的 task 段内，不许泄漏'
  );
  // {{/other}} 永不弹 task 帧
  assert.equal(renderInstruction('{{#task}}{{#other}}B{{/other}}C{{/task}}', {}), '');
});

test('占位符：只认自有属性，不解析原型链', () => {
  assert.equal(renderInstruction('[{{constructor}}]', {}), '[]');
  assert.equal(renderInstruction('[{{toString}}]', {}), '[]');
  assert.equal(renderInstruction('[{{goal.constructor}}]', { goal: { name: 'x' } }), '[]');
});

test('段落：全段丢弃 → 空串（调用方据此省略 instruction 字段）', () => {
  const tpl = '{{#goal}}〔{{goal.name}}〕{{/goal}}';
  assert.equal(renderInstruction(tpl, {}), '');
  assert.equal(renderInstruction('{{#goal}}X{{/goal}}   \n  ', { goal: null }), '');
});

// ─── 单遍渲染（防漂移的字符串学保证）──────────────────────────────────

test('单遍：task.text 里的 {{...}} / 段落标记逐字原样，不再展开', () => {
  const taskText = '正文 {{goal.name}} 与 {{#task}}假段{{/task}}';
  const out = renderInstruction('T:{{task.text}}:END', { task: { id: 1, text: taskText } });
  assert.equal(out, `T:${taskText}:END`);
});

test('单遍：goal.prompt 含 {{ }} 与 {{#goal}} 均逐字（prompt 原文不被改写）', () => {
  const prompt = '根指令：保持 {{字面}}，含 {{#goal}} 与 {{task.text}}，结尾 }}';
  const out = renderInstruction('{{goal.prompt}}', { goal: { name: 'g', prompt } });
  assert.equal(out, prompt);
});

// ─── 时间格式化（对齐 timegoal fmtDur / renderCheck）──────────────────

test('formatDuration：档位边界', () => {
  assert.equal(formatDuration(45), '45 秒');
  assert.equal(formatDuration(90), '1.5 分钟');
  assert.equal(formatDuration(5400), '1.5 小时');
  assert.equal(formatDuration(90000), '1.0 天');
  assert.equal(formatDuration(172800), '2 天');
  assert.equal(formatDuration(3600), '1 小时');
  assert.equal(formatDuration(0), '0 秒');
  assert.equal(formatDuration(-5), '0 秒');
  assert.equal(formatDuration(undefined), '0 秒');
});

test('formatGoalTiming：三形态（未到点 / 刚到点 / 超时）', () => {
  assert.equal(formatGoalTiming({ reached: false, remainingSec: 7200 }), '剩余 2 小时');
  assert.equal(formatGoalTiming({ reached: true, overtimeSec: 0 }), '已到点');
  assert.equal(formatGoalTiming({ reached: true, overtimeSec: 300 }), '已到点（已超时 5 分钟）');
});
