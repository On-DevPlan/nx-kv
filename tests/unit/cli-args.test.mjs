// CLI 参数解析的边界：正文长得像 flag 时不能被当成 flag。
//
// 任务正文常以 markdown frontmatter 开头（`---\nboard: …`），面板的组面板草稿
// 就是这个形状。解析器若把 `---` 当 flag，用户第一次提交带 frontmatter 的正文
// 就会撞上「未知参数 ---」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRest, resolveCommand } from '../../src/runtime/cli.js';

const cmd = { flags: { board: { type: 'string' }, global: { type: 'boolean' } } };

test('parseRest：以 --- 开头的正文当位置参数，不当 flag', () => {
  const r = parseRest(['---\nboard: b_1\n---\n# 标题', '--board', 'nx'], cmd);
  assert.equal(r.positionals.length, 1);
  assert.match(r.positionals[0], /^---\nboard: b_1/);
  assert.equal(r.flags.board, 'nx');
});

test('parseRest：flag 的值以 --- 开头时仍算值', () => {
  const r = parseRest(['--text', '---\n正文'], cmd);
  assert.equal(r.flags.text, '---\n正文');
  assert.deepEqual(r.positionals, []);
});

test('parseRest：-- 之后全是位置参数', () => {
  const r = parseRest(['--board', 'nx', '--', '--not-a-flag', '第二段'], cmd);
  assert.equal(r.flags.board, 'nx');
  assert.deepEqual(r.positionals, ['--not-a-flag', '第二段']);
});

test('parseRest：普通 flag 与布尔 flag 的老行为不变', () => {
  const r = parseRest(['hello', '--board', 'nx', '--global', 'world'], cmd);
  assert.deepEqual(r.positionals, ['hello', 'world']);
  assert.equal(r.flags.board, 'nx');
  assert.equal(r.flags.global, true);
});

test('resolveCommand：localtask add 之后的 frontmatter 正文留在 rest 里', () => {
  const m = resolveCommand(['localtask', 'add', '---\nboard: b_1\n---\n正文']);
  assert.ok(m, '命令能匹配上');
  assert.equal(m.cmd.id, 'localtask.add');
  assert.equal(m.rest.length, 1);
  assert.match(m.rest[0], /^---\nboard: b_1/);
});
