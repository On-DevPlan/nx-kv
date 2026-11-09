import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLayout,
  inMoreOf,
  normalizeLayout,
  onBarOf,
  setVisible,
  moveItem,
} from '../../src/web/frontend/components/tool-acts/modules.js';
import { moveModule, nudgeModule, setFlag } from '../../src/web/frontend/components/tool-acts/dnd.js';

test('dir default: bar has new/tpl/import/progress/orch/more; deleted/refs in more', () => {
  const layout = defaultLayout('dir');
  const bar = layout.filter((x) => onBarOf('dir', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('dir', x)).map((x) => x.id);
  assert.deepEqual(bar, ['new', 'tpl', 'import', 'progress', 'orch', 'more']);
  assert.deepEqual(more, ['deleted', 'refs']);
});

test('group default: bar has new/progress/addMember/orch/more; refs in more', () => {
  const layout = defaultLayout('group');
  const bar = layout.filter((x) => onBarOf('group', x)).map((x) => x.id);
  const more = layout.filter((x) => inMoreOf('group', x)).map((x) => x.id);
  assert.deepEqual(bar, ['new', 'progress', 'addMember', 'orch', 'more']);
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

  layout = setVisible(layout, 'deleted', true, 'dir');
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'deleted')), true);
  assert.equal(inMoreOf('dir', layout.find((x) => x.id === 'deleted')), false);
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
  layout = setFlag(layout, 'deleted', { visible: false });
  layout = moveModule('dir', layout, { id: 'deleted', anchorId: 'tpl', after: false, visible: true });
  const ids = layout.map((x) => x.id);
  assert.ok(ids.indexOf('deleted') < ids.indexOf('tpl'));
  assert.equal(onBarOf('dir', layout.find((x) => x.id === 'deleted')), true);
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

test('repos: hide transfer → it lands in more menu; restore puts it back on bar', () => {
  let layout = setVisible(defaultLayout('repos'), 'transfer', false, 'repos');
  assert.equal(inMoreOf('repos', layout.find((x) => x.id === 'transfer')), true);
  layout = setVisible(layout, 'transfer', true, 'repos');
  assert.equal(onBarOf('repos', layout.find((x) => x.id === 'transfer')), true);
});
