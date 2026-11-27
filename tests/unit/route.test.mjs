import {
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  sameRoute,
} from '../../src/web/frontend/routes/route-eq.js';
import {
  readFileSync,
} from 'node:fs';
import {
  join,
  dirname,
} from 'node:path';
import {
  fileURLToPath,
} from 'node:url';
import {
  panelSpecOfRoute,
  routeOfPanel,
} from '../../src/web/frontend/route-map.js';
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

test('插件页之间切换必须判为不同（pluginId / pageId / sessionId）', () => {
  const manage = { view: 'plugin', key: '', task: '', pluginId: 'task-template', pageId: 'manage' };
  const settings = { view: 'plugin', key: '', task: '', pluginId: 'dir-annotate', pageId: 'settings' };
  assert.equal(sameRoute(manage, settings), false, '换插件/页面');
  assert.equal(sameRoute(manage, { ...manage, pageId: 'entry-form', sessionId: 'ps_1' }), false, '同插件换页面/会话');
  assert.equal(sameRoute(manage, { ...manage }), true);
});

test('key / task / repoKey / boardKey 任一变化都算新位置', () => {
  const a = { view: 'dir', key: 'k1', task: 't1', repoKey: 'r1', boardKey: 'b1' };
  for (const patch of [{ key: 'k2' }, { task: 't2' }, { repoKey: 'r2' }, { boardKey: 'b2' }, { view: 'group' }]) {
    assert.equal(sameRoute(a, { ...a, ...patch }), false, JSON.stringify(patch));
  }
});

// ════ route-eq.test.mjs（#200 合并入本文件）════
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(readFileSync(join(root, 'tests/unit/fixtures/route-table.json'), 'utf8'));

const node = (component, config) => ({ getComponent: () => component, getConfig: () => config });

// 与固化夹具时的两组用例一一对应（顺序无关，按 label 比对）
const PANEL_CASES = [
  ['page-dir', 'page', { dirKey: 'D', task: '5' }],
  ['page-group', 'page', { groupId: 'B', task: '7' }],
  ['page-beside', 'page', { dirKey: 'D', task: '5', beside: true }],
  ['dir', 'dir', { dirKey: 'D' }],
  ['group', 'group', { boardId: 'B' }],
  ['repos', 'repos', {}],
  ['plugin-page', 'plugin-page', { pluginId: 'task-template', pageId: 'manage' }],
  ['plugin-entry', 'plugin-page', { pluginId: 'task-template', pageId: 'entry-form', sessionId: 'ps_1' }],
  ['doc-repo', 'doc', { docId: 'ref:ref_0123456789abcdef', repoKey: 'r1' }],
  ['doc-board', 'doc', { docId: 'path:x/y.md', boardKey: 'b1', boardName: '组 一' }],
  ['doc-bare', 'doc', {}],
  ['sidebar', 'sidebar', {}],
  ['welcome', 'welcome', {}],
  ['progress', 'progress', { dirKey: 'D' }],
  ['compose', 'compose', { token: 't' }],
  ['settings', 'settings', {}],
  ['dag', 'dag', { dirKey: 'D' }],
];

const ROUTE_CASES = [
  ['dir-page', { view: 'dir', key: 'D', task: '5' }],
  ['dir-page-draft', { view: 'dir', key: 'D', task: 'draft-3' }],
  ['dir-plain', { view: 'dir', key: 'D', task: '' }],
  ['group-page', { view: 'group', key: 'B', task: '7' }],
  ['group-plain', { view: 'group', key: 'B', task: '' }],
  ['repos', { view: 'repos', key: '', task: '' }],
  ['plugin-page', { view: 'plugin', key: '', task: '', pluginId: 'task-template', pageId: 'manage' }],
  ['plugin-entry', { view: 'plugin', key: '', task: '', pluginId: 'task-template', pageId: 'entry-form', sessionId: 'ps_1' }],
  ['doc-repo', { view: 'doc', key: 'ref:ref_0123456789abcdef', task: '', repoKey: 'r1' }],
  ['doc-board', { view: 'doc', key: 'path:x/y.md', task: '', boardKey: 'b1', boardName: '组 一' }],
  ['doc-bare', { view: 'doc', key: '', task: '' }],
  ['unknown', { view: 'nope', key: '', task: '' }],
];

const CTXS = [
  ['empty', {}],
  ['named', { dirName: 'D名', pageTitle: '页标题', docTitle: '文档标题', boardName: '组名' }],
];

test('面板 → 路由：与表化前的输出逐字一致', () => {
  for (const [label, component, config] of PANEL_CASES) {
    assert.equal(routeOfPanel(node(component, config)), fixture.panels[label], `面板用例 ${label}`);
  }
});

test('路由 → 面板：与表化前的输出逐字一致（含两套 ctx）', () => {
  for (const [label, route] of ROUTE_CASES) {
    for (const [ctxLabel, ctx] of CTXS) {
      assert.deepEqual(
        panelSpecOfRoute(route, ctx),
        fixture.routes[label][ctxLabel],
        `路由用例 ${label}（ctx=${ctxLabel}）`,
      );
    }
  }
});

test('夹具覆盖了每个已登记视图', () => {
  // 防止「新增视图忘了补用例」——夹具里有、登记表里没有也算漏（那说明视图被删了）
  const views = new Set(ROUTE_CASES.map(([, r]) => r.view).filter((v) => v !== 'unknown'));
  // #174：overview 下线；现在 dir / group / repos / plugin / doc / unknown 仍有 6 个视图
  assert.ok(views.size >= 6, `夹具视图太少: ${[...views].join(',')}`);
});

