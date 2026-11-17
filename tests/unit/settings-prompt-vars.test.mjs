// 提示词变量目录的分组 / 过滤（设置页左栏「可使用变量」）。
//
// 钉两件事：
//   1. `[]` 记法与模板写法的对应——目录里 `attach.list[].file.localPath`，
//      模板里在 `{{#each attach.list}}` 内部写 `{{file.localPath}}`；
//   2. 近百个变量必须能按关键词收窄（附件的 6 种 kind 全列出来会很长）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { varGroupsOf } from '../../src/web/frontend/page/settings/prompt-vars.ts';

const FIELDS = [
  { key: 'attach.count', kind: 'number', label: '附件总数' },
  { key: 'attach.list', kind: 'list', label: '结构化清单' },
  { key: 'attach.list[].kind', kind: 'string', label: '附件类型：file / url / task' },
  { key: 'attach.list[].name', kind: 'string', label: '展示名' },
  { key: 'attach.list[].file.localPath', kind: 'string', label: '本机绝对路径', desc: '本机附件仓的盘上副本' },
  { key: 'attach.list[].task.showCmd', kind: 'string', label: '读最新正文的命令' },
];

test('普通字段归到空组，数组元素归到 `x[]` 组（相对名去掉前缀）', () => {
  const groups = varGroupsOf(FIELDS, '');
  assert.deepEqual(
    groups.map((g) => g.group),
    ['', 'attach.list[]'],
    '普通段在前，[] 域在后',
  );
  const main = groups[0];
  assert.deepEqual(main.rows.map((r) => r.rel), ['attach.count', 'attach.list']);

  const each = groups[1];
  assert.deepEqual(each.rows.map((r) => r.full), [
    'attach.list[].kind',
    'attach.list[].name',
    'attach.list[].file.localPath',
    'attach.list[].task.showCmd',
  ]);
  // 模板里的写法：each 内部相对域
  assert.deepEqual(each.rows.map((r) => r.rel), [
    'kind',
    'name',
    'file.localPath',
    'task.showCmd',
  ]);
});

test('过滤：命中 key / label / desc 任一即可，大小写不敏感', () => {
  const byKey = varGroupsOf(FIELDS, 'localpath');
  assert.equal(byKey.length, 1);
  assert.deepEqual(byKey[0].rows.map((r) => r.rel), ['file.localPath']);

  const byLabel = varGroupsOf(FIELDS, '展示名');
  assert.deepEqual(byLabel[0].rows.map((r) => r.full), ['attach.list[].name']);

  const byDesc = varGroupsOf(FIELDS, '盘上副本');
  assert.deepEqual(byDesc[0].rows.map((r) => r.full), ['attach.list[].file.localPath']);

  const none = varGroupsOf(FIELDS, 'zzz');
  assert.deepEqual(none, [], '无命中返回空数组（UI 显示「没有匹配」）');
});

test('边界：空目录 / 只有数组元素 / 重复前缀不串组', () => {
  assert.deepEqual(varGroupsOf([], ''), []);
  assert.deepEqual(varGroupsOf([], 'x'), []);

  const onlyArr = varGroupsOf([{ key: 'a[].b', kind: 'string', label: 'b' }]);
  assert.deepEqual(onlyArr.map((g) => g.group), ['a[]']);
  assert.deepEqual(onlyArr[0].rows.map((r) => r.rel), ['b']);

  const two = varGroupsOf([
    { key: 'a[].b', kind: 'string', label: 'a.b' },
    { key: 'c[].d', kind: 'string', label: 'c.d' },
    { key: 'e', kind: 'string', label: 'e' },
  ]);
  assert.deepEqual(two.map((g) => g.group), ['', 'a[]', 'c[]'], '多个 [] 域各自成组');
  assert.deepEqual(two[1].rows.map((r) => r.rel), ['b']);
  assert.deepEqual(two[2].rows.map((r) => r.rel), ['d']);
});
