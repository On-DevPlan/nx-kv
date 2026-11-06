// 主区 tabset 丢失的读盘愈合（maincontent 白板的直接病因）。
//
// 背景：主区最后一个页签被关/清的瞬间，FlexLayout 会把空 tabset 从活模型里
// 自动删除；saveModel 存盘时它已经不在了。这样的布局读回来，主区永远白板——
// openPanel 的主区分支找不到落点，点什么都开不出来（#86 修复窗口期存坏过
// 一批这样的布局）。healMainTabset = 读盘时补回带「开始」页的 ts_main。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from 'flexlayout-react';
import { healMainTabset, initialLayoutJson } from '../../src/web/frontend/workspace.js';

// 存坏布局的典型形态：只剩右栏（空），主区 tabset 已被库删掉
const deadLayout = () => ({
  global: {},
  borders: [],
  layout: {
    type: 'row',
    children: [{ type: 'tabset', id: 'ts_right', weight: 16, enableTabStrip: false, children: [] }],
  },
});

test('healMainTabset：主区没了 → 补回带「开始」页的 ts_main，插在 ts_right 之前', () => {
  const json = deadLayout();
  assert.equal(healMainTabset(json), true);
  const kids = json.layout.children;
  assert.deepEqual(kids.map((c) => c.id), ['ts_main', 'ts_right']);
  const main = kids[0];
  assert.equal(main.enableTabStrip, false);
  assert.equal(main.children.length, 1);
  assert.equal(main.children[0].component, 'welcome');
  assert.equal(main.children[0].name, '开始');
});

test('healMainTabset：没有 ts_right 时补在行尾', () => {
  const json = { layout: { type: 'row', children: [] } };
  assert.equal(healMainTabset(json), true);
  assert.equal(json.layout.children.length, 1);
  assert.equal(json.layout.children[0].id, 'ts_main');
});

test('healMainTabset：只剩目录 tabset 的布局也算「无主区」→ 愈合', () => {
  const json = {
    layout: {
      type: 'row',
      children: [{
        type: 'tabset',
        id: 'ts_sidebar',
        weight: 16,
        children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar' }],
      }],
    },
  };
  assert.equal(healMainTabset(json), true);
  assert.deepEqual(json.layout.children.map((c) => c.id), ['ts_sidebar', 'ts_main']);
});

test('healMainTabset：主区还在（任意自定义 id、装着内容页）→ 不动', () => {
  const json = {
    layout: {
      type: 'row',
      children: [{
        type: 'tabset',
        id: 'ts_user_moved_this',
        weight: 84,
        children: [{ type: 'tab', id: 't1', name: '#8', component: 'page' }],
      }],
    },
  };
  assert.equal(healMainTabset(json), false);
  assert.equal(json.layout.children.length, 1);
  assert.equal(json.layout.children[0].id, 'ts_user_moved_this');
});

test('healMainTabset：目录+内容混装的老 tabset 算主区 → 不动', () => {
  const json = {
    layout: {
      type: 'row',
      children: [{
        type: 'tabset',
        id: 'ts_mixed',
        children: [
          { type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar' },
          { type: 'tab', id: 't_page', name: '#8', component: 'page' },
        ],
      }],
    },
  };
  assert.equal(healMainTabset(json), false);
});

test('healMainTabset：坏输入安全返回 false', () => {
  assert.equal(healMainTabset(null), false);
  assert.equal(healMainTabset({}), false);
  assert.equal(healMainTabset({ layout: { type: 'border', children: [] } }), false);
  assert.equal(healMainTabset({ layout: { type: 'row', children: 'nope' } }), false);
});

test('healMainTabset：愈合后的 JSON 能被 FlexLayout 吃出可用主区（端到端护栏）', () => {
  const json = deadLayout();
  healMainTabset(json);
  const model = Model.fromJson(json);
  const first = model.getFirstTabSet();
  assert.ok(first, '主区 tabset 恢复存在');
  assert.equal(first.getId(), 'ts_main');
  const tabIds = [];
  model.visitNodes((n) => {
    if (n.getType() === 'tab') tabIds.push(n.getId());
  });
  assert.ok(tabIds.includes('t_welcome'), '「开始」页回到主区');
});

test('healMainTabset：初始布局本身不需要愈合（no-op 护栏）', () => {
  const json = initialLayoutJson();
  assert.equal(healMainTabset(json), false);
});
