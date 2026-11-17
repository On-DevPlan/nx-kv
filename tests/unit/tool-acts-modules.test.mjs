import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLayout,
  inMoreOf,
  modulesOf,
  normalizeLayout,
  onBarOf,
  setVisible,
  moveItem,
} from '../../src/web/frontend/components/tool-acts/modules.js';
import { moveModule, nudgeModule, setFlag } from '../../src/web/frontend/components/tool-acts/dnd.js';

test('dir default: bar has new/import/progress/orch/plan/more; refs in more (#126 草稿 + #161 tpl 并入新建钮箭头)', () => {
  const layout = defaultLayout('dir');
  const bar = layout.filter((x) => onBarOf('dir', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('dir', x)).map((x) => x.id);
  assert.deepEqual(bar, ['new', 'import', 'progress', 'orch', 'plan', 'more']);
  assert.deepEqual(more, ['refs']);
  // 旧布局里存过的 tpl id 会被 normalizeLayout 丢掉（未知模块）
  const norm = normalizeLayout('dir', [...layout, { id: 'tpl', visible: true }]);
  assert.ok(!norm.some((x) => x.id === 'tpl'));
});

test('group default: bar has new/progress/addMember/orch/more; refs in more', () => {
  const layout = defaultLayout('group');
  const bar = layout.filter((x) => onBarOf('group', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('group', x)).map((x) => x.id);
  assert.deepEqual(bar, ['new', 'progress', 'addMember', 'orch', 'more']);
  // #180：两页都去掉了「已删除任务」入口，更多里只剩「查看列表」
  assert.deepEqual(more, ['refs']);
});

test('task default: bar has new/submit/more; secondary actions in more', () => {
  const layout = defaultLayout('task');
  const bar = layout.filter((x) => onBarOf('task', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('task', x)).map((x) => x.id);
  assert.deepEqual(bar, ['new', 'submit', 'more']);
  assert.ok(more.includes('prog'));
  assert.ok(more.includes('preview'));
  assert.ok(more.includes('delete'));
  assert.equal(more.includes('new'), false);
});

test('task: promote prog to bar; hide leaves more', () => {
  let layout = defaultLayout('task');
  layout = setVisible(layout, 'prog', true, 'task');
  assert.equal(onBarOf('task', layout.find((x) => x.id === 'prog')), true);
  assert.equal(inMoreOf('task', layout.find((x) => x.id === 'prog')), false);
  layout = setVisible(layout, 'prog', false, 'task');
  assert.equal(inMoreOf('task', layout.find((x) => x.id === 'prog')), true);
});

test('doc default: bar has save/more; mode/rename/delete/list in more', () => {
  const layout = defaultLayout('doc');
  const bar = layout.filter((x) => onBarOf('doc', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('doc', x)).map((x) => x.id);
  assert.deepEqual(bar, ['save', 'more']);
  assert.deepEqual(more, ['mode', 'rename', 'delete', 'list']);
});

test('hide bar item → appears in more; show more item → appears on bar', () => {
  let layout = defaultLayout('dir');
  layout = setVisible(layout, 'progress', false, 'dir');
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'progress')), false);
  assert.equal(inMoreOf('dir', layout.find((x) => x.id === 'progress')), true);

  layout = setVisible(layout, 'refs', true, 'dir');
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'refs')), true);
  assert.equal(inMoreOf('dir', layout.find((x) => x.id === 'refs')), false);
});

test('noHide cannot be hidden; normalize appends unknown-missing modules', () => {
  let layout = setVisible(defaultLayout('dir'), 'new', false, 'dir');
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'new')), true);
  layout = normalizeLayout('dir', [{ id: 'tpl', visible: true }]);
  assert.ok(layout.some((x) => x.id === 'new'));
  assert.ok(layout.some((x) => x.id === 'more'));
});

test('moveItem swaps neighbors', () => {
  const layout = defaultLayout('group');
  const next = moveItem(layout, 'progress', 1);
  const i = next.findIndex((x) => x.id === 'progress');
  assert.equal(next[i - 1].id, 'addMember');
});

test('moveModule inserts before/after anchor and can promote from more', () => {
  let layout = defaultLayout('dir');
  layout = setFlag(layout, 'refs', { visible: false });
  layout = moveModule('dir', layout, { id: 'refs', anchorId: 'import', after: false, visible: true });
  const ids = layout.map((x) => x.id);
  assert.ok(ids.indexOf('refs') < ids.indexOf('import'));
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'refs')), true);
});

test('nudgeModule moves within bar segment', () => {
  const layout = defaultLayout('group');
  const next = nudgeModule('group', layout, 'progress', 1);
  const bar = next.filter((x) => onBarOf('group', x)).map((x) => x.id);
  const i = bar.indexOf('progress');
  assert.equal(bar[i - 1], 'addMember');
});

test('repos default (#147): bar has add/more only; boards/refs/transfer in more', () => {
  const layout = defaultLayout('repos');
  const bar = layout.filter((x) => onBarOf('repos', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('repos', x)).map((x) => x.id);
  assert.deepEqual(bar, ['add', 'more']);
  assert.deepEqual(more, ['boards', 'refs', 'transfer']);
  // 主按钮不可收起（noHide），显式藏也藏不掉
  const forced = setVisible(layout, 'add', false, 'repos');
  assert.equal(onBarOf('repos', forced.find((x) => x.id === 'add')), true);
});

test('repos-row default (#148): bar has edit/open/del/more; getloop/remote in more', () => {
  const layout = defaultLayout('repos-row');
  const bar = layout.filter((x) => onBarOf('repos-row', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('repos-row', x)).map((x) => x.id);
  assert.deepEqual(bar, ['edit', 'open', 'del', 'more']);
  assert.deepEqual(more, ['getloop', 'remote']);
  // 更多本身不可收纳；del 可收进更多（编排自由）
  const hidden = setVisible(layout, 'del', false, 'repos-row');
  assert.equal(inMoreOf('repos-row', hidden.find((x) => x.id === 'del')), true);
});

test('repos: hide transfer → it lands in more menu; restore puts it back on bar', () => {
  let layout = setVisible(defaultLayout('repos'), 'transfer', false, 'repos');
  assert.equal(inMoreOf('repos', layout.find((x) => x.id === 'transfer')), true);
  layout = setVisible(layout, 'transfer', true, 'repos');
  assert.equal(onBarOf('repos', layout.find((x) => x.id === 'transfer')), true);
});

// #131：任务页「更多」里必须能切 plan 态——用户在任务详情页就该有入口，
// 不必回目录页去勾选。（dir 页的「草稿」批量入口是另一条路。）
test('task 更多里有 plan 项（转草稿 / 转回待领取）', () => {
  const layout = defaultLayout('task');
  const more = layout.filter((x) => inMoreOf('task', x)).map((x) => x.id);
  assert.ok(more.includes('plan'), 'plan 必须默认进「更多」菜单');
  assert.ok(!onBarOf('task', { id: 'plan' }), 'plan 不占工具栏主位');

  // 老布局里没有 plan → normalizeLayout 要补上（否则老用户看不到入口）
  const norm = normalizeLayout('task', layout.filter((x) => x.id !== 'plan'));
  assert.ok(norm.some((x) => x.id === 'plan'), '老布局要自动补出 plan 项');
  assert.equal(norm.filter((x) => x.id === 'plan').length, 1, '只补一项，不重复');

  // 与「标为完成」同组（task 组），排在 fork 之后
  const mods = modulesOf('task');
  const plan = mods.find((m) => m.id === 'plan');
  assert.equal(plan.menuGroup, 'task');
  assert.equal(plan.section, 'more');
});
