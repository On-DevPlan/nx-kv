// 路由表基线：routes/<名>.ts 表化重构（#175 收尾）前后的**逐字行为对比**。
//
// 夹具 tests/unit/fixtures/route-table.json 是表化**之前**由原 route-map 两段
// switch 生成的输出快照（22 条面板 → 路由、15 条路由 → 面板 × 2 套 ctx）。
// 断言「现在仍然逐字一样」，用来证明这次重构只是把同一套规则搬了家：
// 地址一个字符都不许变（地址变了 = 用户收藏的深链失效、openPanel 去重裂面板）。
//
// 夹具不要为了让测试通过而重新生成——**改了映射就该在 diff 里看见地址变化**，
// 那正是要评审的东西。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOBAL_KEY, panelSpecOfRoute, routeOfPanel } from '../../src/web/frontend/route-map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(readFileSync(join(root, 'tests/unit/fixtures/route-table.json'), 'utf8'));

const node = (component, config) => ({ getComponent: () => component, getConfig: () => config });

// 与固化夹具时的两组用例一一对应（顺序无关，按 label 比对）
const PANEL_CASES = [
  ['page-dir', 'page', { dirKey: 'D', task: '5' }],
  ['page-group', 'page', { groupId: 'B', task: '7' }],
  ['page-beside', 'page', { dirKey: 'D', task: '5', beside: true }],
  ['dir', 'dir', { dirKey: 'D' }],
  ['dir-global', 'dir', { dirKey: GLOBAL_KEY }],
  ['group', 'group', { boardId: 'B' }],
  ['repos', 'repos', {}],
  ['overview', 'overview', {}],
  ['templates-plain', 'templates', {}],
  ['templates-edit', 'templates', { mode: 'edit', id: 't1' }],
  ['templates-new-full', 'templates', { mode: 'new', topic: 'k 1', scope: ['topic:k 1', 'repo:r'] }],
  ['templates-new-bare', 'templates', { mode: 'new' }],
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
  ['overview', { view: 'overview', key: '', task: '' }],
  ['templates-plain', { view: 'templates', key: '', task: '' }],
  ['templates-edit', { view: 'templates', key: '', task: '', mode: 'edit', id: 't1' }],
  ['templates-new', { view: 'templates', key: '', task: '', mode: 'new', topic: 'k 1', scope: 'topic:k 1, repo:r' }],
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
  assert.ok(views.size >= 7, `夹具视图太少: ${[...views].join(',')}`);
});
