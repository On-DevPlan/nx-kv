// 路由等价判定（App.onNavigate 的 setRoute 用它决定「要不要换路由」）。
//
// 这条判定的历史 bug（#153 验收反馈）：只比 view/key/task，于是同一视图内
// 带不同 mode/id 的跳转被判成「没变」→ setRoute 把新路由丢掉 → 目标页不出现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameRoute } from '../../src/web/frontend/routes/route-eq.ts';

const base = { view: 'templates', key: '', task: '', mode: '', id: '' };

test('同一位置（含缺省字段）判为相等', () => {
  assert.equal(sameRoute({ view: 'dir', key: 'k1', task: '' }, { view: 'dir', key: 'k1', task: '' }), true);
  assert.equal(sameRoute({ ...base }, { ...base, mode: undefined, id: undefined }), true, 'undefined ≡ 空串');
  assert.equal(sameRoute({ view: 'dir', key: 'k', task: 't', mode: 'x' }, { view: 'dir', key: 'k', task: 't' }), false, 'mode 有值 vs 空串不算同位置');
});

test('模板视图内的跳转必须判为不同（否则目标页不出现）', () => {
  const list = { view: 'templates', key: '', task: '', mode: '', id: '' };
  const edit = { view: 'templates', key: '', task: '', mode: 'edit', id: 's_1' };
  const manage = { view: 'templates', key: '', task: '', mode: 'manage', id: 's_1' };
  assert.equal(sameRoute(list, edit), false, '列表 → 编辑页');
  assert.equal(sameRoute(edit, manage), false, '编辑页 → 管理页');
  assert.equal(sameRoute(edit, { ...edit, id: 's_2' }), false, '换一个模板 id 也是新位置');
});

test('key / task / repoKey / boardKey 任一变化都算新位置', () => {
  const a = { view: 'dir', key: 'k1', task: 't1', repoKey: 'r1', boardKey: 'b1' };
  for (const patch of [{ key: 'k2' }, { task: 't2' }, { repoKey: 'r2' }, { boardKey: 'b2' }, { view: 'group' }]) {
    assert.equal(sameRoute(a, { ...a, ...patch }), false, JSON.stringify(patch));
  }
});
