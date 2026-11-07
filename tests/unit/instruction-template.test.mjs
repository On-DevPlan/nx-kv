// instruction-template 单测（v5：Handlebars 薄封装，只保留一套语法）。
// 钉死的契约：
//   - `{{var}}` 按路径取值，缺失一律 ''；不 HTML 转义；
//   - `{{#if}}` / `{{#each}}` 原生可用；
//   - 旧闸门（`{{#repo}}…{{/repo}}`）与旧占位符**已废弃**：保存校验拒绝，
//     运行期直接抛错（由上层回落内置模板 + 告警）；
//   - 单遍渲染：插入值里的 {{…}} 逐字保留；
//   - 语法错误可被 validateTemplate 检出（保存时拒绝）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInstruction,
  validateTemplate,
  formatDuration,
  formatGoalTiming,
} from '../../src/core/instruction-template.js';

// ─── 取值 ──────────────────────────────────────────────────────────────

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

test('占位符：缺失一律空串；路径两侧空格被忽略', () => {
  assert.equal(renderInstruction('[{{goal.name}}]', {}), '[]');
  assert.equal(renderInstruction('[{{task.text}}]', { task: null }), '[]');
  assert.equal(renderInstruction('[{{task.text}}]', { task: {} }), '[]');
  assert.equal(renderInstruction('[{{nope.deep}}]', { goal: {} }), '[]');
  assert.equal(renderInstruction('[{{ goal.name }}]', { goal: { name: 'x' } }), '[x]');
});

test('占位符：不 HTML 转义（提示词是纯文本）', () => {
  assert.equal(
    renderInstruction('{{x}}', { x: 'a < b & c "d" > e' }),
    'a < b & c "d" > e'
  );
});

test('占位符：原型链成员不可取（Handlebars 4.7 默认拦截）', () => {
  assert.equal(renderInstruction('[{{constructor}}]', {}), '[]');
  assert.equal(renderInstruction('[{{toString}}]', {}), '[]');
  assert.equal(renderInstruction('[{{goal.constructor}}]', { goal: { name: 'x' } }), '[]');
});

// ─── if / each ─────────────────────────────────────────────────────────

test('{{#if}}：真假分支（缺失键为假）', () => {
  assert.equal(renderInstruction('A{{#if goal}}G{{else}}N{{/if}}B', {}), 'ANB');
  assert.equal(renderInstruction('A{{#if goal}}G{{else}}N{{/if}}B', { goal: { name: 'x' } }), 'AGB');
  assert.equal(renderInstruction('{{#if x}}Y{{/if}}', { x: 0 }), '');
  assert.equal(renderInstruction('{{#if x}}Y{{/if}}', { x: '' }), '');
});

test('{{#each}}：数组 / 对象循环，@first / @index 可用', () => {
  const ctx = { group: { peers: [{ name: 'a', note: 'x' }, { name: 'b', note: '' }] } };
  assert.equal(
    renderInstruction('{{#each group.peers}}[{{@index}}:{{name}}{{#if note}}/{{note}}{{/if}}]{{/each}}', ctx),
    '[0:a/x][1:b]'
  );
  assert.equal(
    renderInstruction('{{#each list}}{{#if @first}}{{else}},{{/if}}{{this}}{{/each}}', { list: ['a', 'b', 'c'] }),
    'a,b,c'
  );
  assert.equal(renderInstruction('{{#each list}}x{{/each}}', { list: [] }), '');
  assert.equal(renderInstruction('{{#each nope}}x{{/each}}', {}), '');
  assert.equal(
    renderInstruction('{{#each list}}{{#if this}}Y{{/if}}{{/each}}', { list: [1, 0, 2] }),
    'YY'
  );
});

// ─── 旧语法已废弃（不兼容、不静默生效）────────────────────────────────

test('旧闸门：保存校验拒绝，运行期抛错（不再按旧语义生效）', () => {
  assert.equal(validateTemplate('A{{#repo}}B{{repo.name}}{{/repo}}C').ok, false);
  assert.equal(validateTemplate('{{#group}}G{{/group}}').ok, false);
  assert.equal(validateTemplate('{{#attachSync}}S{{/attachSync}}').ok, false);
  assert.equal(validateTemplate('{{#goalCheck}}G{{/goalCheck}}').ok, false);
  assert.throws(
    () => renderInstruction('A{{#repo}}B{{repo.name}}{{/repo}}C', { repo: { name: 'n' } }),
    /旧区块语法/
  );
  assert.throws(
    () => renderInstruction('A{{#goal}}G{{/goal}}B', { goal: { name: 'x' } }),
    /旧区块语法/
  );
});

test('旧占位符：保存校验拒绝，运行期抛错并提示新写法', () => {
  for (const tpl of [
    '{{group.peers}}',
    '{{repo.docs}}',
    '{{group.docs}}',
    '{{attach.list}}',
    '{{groups}}',
    '{{attach.sync}}',
    '{{attach.syncText}}',
    '{{block.content}}',
  ]) {
    const r = validateTemplate(tpl);
    assert.equal(r.ok, false, `${tpl} 必须拒绝`);
    assert.match(r.error, /已废弃/, `${tpl} 错误信息要说明废弃`);
  }
  assert.throws(() => renderInstruction('{{attach.list}}', { attach: { list: [] } }), /已废弃/);
  assert.throws(() => renderInstruction('{{attach.sync}}', { attach: { sync: {} } }), /已废弃/);
});

test('旧闸门：独立行标记不再保留/不再丢弃（直接判为坏模板）', () => {
  const tpl = ['头部', '{{#goal}}', '目标行 {{goal.name}}', '{{/goal}}', '尾部'].join('\n');
  assert.equal(validateTemplate(tpl).ok, false, '旧闸门模板不能保存');
  assert.throws(() => renderInstruction(tpl, {}), /旧区块语法/);
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

// ─── 语法校验（保存时拒绝坏模板）────────────────────────────────────

test('validateTemplate：合法模板 ok，语法错误返回 error', () => {
  assert.deepEqual(validateTemplate('{{#if repo}}x{{/if}}'), { ok: true });
  assert.deepEqual(validateTemplate('{{#each list}}{{name}}{{/each}}'), { ok: true });
  assert.deepEqual(validateTemplate('纯文本无标记'), { ok: true });
  const bad = validateTemplate('{{#if repo}}x{{/each}}');
  assert.equal(bad.ok, false);
  assert.ok(bad.error.length > 0, '错误信息非空');
  assert.equal(validateTemplate('{{ }}').ok, false, '空 mustache 是语法错误');
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
