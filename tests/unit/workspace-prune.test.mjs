// 工作区空壳剪枝：空 tabset / 空 border / 空浮窗(subLayout) 都不该占位。
//
// 背景：FlexLayout 0.11 的「浮窗」路径会把 tabset 连锅端进子布局，原位置留下
// 一个没有标题栏、没有关闭按钮的空 tabset——渲染成一块删不掉的空白面板；
// 空 border 恢复后同样渲染成无关闭按钮的空白竖条。这类壳必须剪：
// 存盘前剪（不再产生）、读盘时剪（老布局自愈）、运行时剪（当场消失）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneEmptyTabsets,
  pruneBlankChrome,
  pruneBlankTabsets,
  healSidebarLayout,
  openBesideMain,
  closeBesidePanels,
  clearMainPanels,
  findOpenPanel,
  initialLayoutJson,
} from '../../src/web/frontend/workspace.js';
import { Model, Actions, DockLocation } from 'flexlayout-react';

const layoutWithEmptySet = {
  type: 'row',
  children: [
    { type: 'tabset', id: 'ts_a', weight: 50, children: [{ type: 'tab', id: 't1', name: 'A', component: 'welcome' }] },
    { type: 'tabset', id: 'ts_empty', weight: 50, children: [] },
  ],
};

test('pruneEmptyTabsets：剪掉空 tabset 与剪后变空的 row', () => {
  const json = { type: 'row', children: [structuredClone(layoutWithEmptySet)] };
  const out = pruneEmptyTabsets(json);
  assert.equal(out, json); // 就地修改
  // json.children[0] 是内层 row，它的空 tabset 被剪、只剩 ts_a
  assert.equal(json.children.length, 1);
  assert.equal(json.children[0].type, 'row');
  assert.deepEqual(json.children[0].children.map((c) => c.id), ['ts_a']);
});

test('pruneEmptyTabsets：根被剪空返回 null（调用方回退初始布局）', () => {
  const json = { type: 'row', children: [{ type: 'tabset', id: 'ts_x', children: [] }] };
  assert.equal(pruneEmptyTabsets(json), null);
});

test('pruneBlankChrome：剪掉空 border', () => {
  const json = {
    borders: [
      { type: 'border', location: 'left', size: 180, children: [] },
      { type: 'border', location: 'right', size: 180, children: [{ type: 'tab', id: 't', name: 'x', component: 'welcome' }] },
    ],
    layout: structuredClone(layoutWithEmptySet),
  };
  pruneBlankChrome(json);
  assert.equal(json.borders.length, 1);
  assert.equal(json.borders[0].location, 'right');
});

test('pruneBlankChrome：剪掉空浮窗（subLayout）', () => {
  const json = {
    borders: [],
    layout: structuredClone(layoutWithEmptySet),
    subLayouts: {
      keep_me: { type: 'float', layout: { type: 'row', children: [{ type: 'tabset', children: [{ type: 'tab', id: 't2', name: 'B', component: 'welcome' }] }] } },
      empty_float: { type: 'window', layout: { type: 'row', children: [] } },
      empty_tabset_float: { type: 'window', layout: { type: 'row', children: [{ type: 'tabset', id: 'z', children: [] }] } },
    },
  };
  pruneBlankChrome(json);
  assert.deepEqual(Object.keys(json.subLayouts), ['keep_me']);
});

test('pruneBlankChrome：subLayout 全空时连同容器一起移除', () => {
  const json = { borders: [], layout: structuredClone(layoutWithEmptySet), subLayouts: {} };
  pruneBlankChrome(json);
  assert.equal('subLayouts' in json, false);
});

test('pruneBlankChrome：borders / subLayouts 缺省时安全 no-op', () => {
  const json = { layout: structuredClone(layoutWithEmptySet) };
  pruneBlankChrome(json);
  assert.equal('borders' in json, false);
  assert.equal('subLayouts' in json, false);
});

test('pruneBlankTabsets：空模型 / null 安全', () => {
  assert.equal(pruneBlankTabsets(null), 0);
});

// 说明：pruneBlankTabsets 的运行时行为（浮窗路径留下的空 tabset 当场被删）
// 无法在纯 Node 里构造——Model.fromJson 内部会 tidy，空 tabset 在加载时就被库删了，
// 而 float 路径是库 UI 层的内部操作、没有公开 action。该行为由真实浏览器探针覆盖
// （temp/probe-blank4.cjs：float 侧栏后主布局立即无空 tabset、无空白占位）。

test('Actions.deleteTabset：空 tabset 删除后模型里不再有它（库行为护栏，防止升级后静默失效）', () => {
  // fromJson 的 tidy 会先删空 tabset，所以这里用「删光 tab 再 deleteTabset」构造
  const model = Model.fromJson({
    global: {},
    borders: [],
    layout: {
      type: 'row',
      children: [
        { type: 'tabset', id: 'ts_a', weight: 50, children: [{ type: 'tab', id: 't1', name: 'A', component: 'welcome' }] },
        { type: 'tabset', id: 'ts_b', weight: 50, children: [{ type: 'tab', id: 't2', name: 'B', component: 'welcome' }] },
      ],
    },
  });
  model.doAction(Actions.deleteTab('t1'));
  model.doAction(Actions.deleteTabset('ts_a'));
  const ids = [];
  model.visitNodes((n) => { if (n.getType() === 'tabset') ids.push(n.getId()); });
  assert.deepEqual(ids, ['ts_b']);
});

test('openBesideMain：主区右侧并排开页，不清掉左侧；beside 不重复堆', () => {
  const model = Model.fromJson(initialLayoutJson());
  const dock = DockLocation.getByName('center');
  // 主区先放评论页（替换 welcome）
  clearMainPanels(model);
  model.doAction(Actions.addTab(
    { type: 'tab', name: '#35', component: 'page', config: { dirKey: 'k', task: '35' } },
    'ts_main',
    dock,
    -1,
    true
  ));
  const r1 = openBesideMain(model, {
    component: 'page',
    name: '原文 #23',
    config: { dirKey: 'k', task: '23' },
  });
  assert.ok(r1.tabId);
  assert.equal(r1.reused, false);
  const beside = findOpenPanel(model, 'page', { dirKey: 'k', task: '23', beside: true });
  assert.ok(beside, '旁路面板带 beside:true');
  // 左侧评论还在
  assert.ok(findOpenPanel(model, 'page', { dirKey: 'k', task: '35' }));
  // 再开同款 → 复用
  const r2 = openBesideMain(model, {
    component: 'page',
    name: '原文 #23',
    config: { dirKey: 'k', task: '23' },
  });
  assert.equal(r2.reused, true);
  assert.equal(r2.tabId, r1.tabId);
  // 关旁路
  assert.equal(closeBesidePanels(model), 1);
  assert.equal(findOpenPanel(model, 'page', { dirKey: 'k', task: '23', beside: true }), null);
  assert.ok(findOpenPanel(model, 'page', { dirKey: 'k', task: '35' }), '关旁路不伤主区');
});

test('clearMainPanels：连旁路原文一起清', () => {
  const model = Model.fromJson(initialLayoutJson());
  const dock = DockLocation.getByName('center');
  clearMainPanels(model);
  model.doAction(Actions.addTab(
    { type: 'tab', name: '#35', component: 'page', config: { dirKey: 'k', task: '35' } },
    'ts_main',
    dock,
    -1,
    true
  ));
  openBesideMain(model, {
    component: 'page',
    name: '原文',
    config: { dirKey: 'k', task: '23' },
  });
  const n = clearMainPanels(model);
  assert.ok(n >= 2);
  assert.equal(findOpenPanel(model, 'page', { dirKey: 'k', task: '35' }), null);
  assert.equal(findOpenPanel(model, 'page', { dirKey: 'k', task: '23', beside: true }), null);
});

test('healSidebarLayout：目录与内容混在同一 tabset 时拆回左目录', () => {
  const json = {
    global: {},
    borders: [],
    layout: {
      type: 'row',
      children: [{
        type: 'tabset',
        id: 'ts_mixed',
        weight: 2.5,
        enableTabStrip: false,
        selected: 3,
        children: [
          { type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar' },
          { type: 'tab', id: 't_page', name: '#8', component: 'page' },
          { type: 'tab', id: 't_ov', name: '总览', component: 'overview' },
          { type: 'tab', id: 't_page2', name: '#4', component: 'page' },
        ],
      }],
    },
  };
  assert.equal(healSidebarLayout(json), true);
  assert.equal(json.layout.children.length, 2);
  const [side, main] = json.layout.children;
  assert.equal(side.id, 'ts_sidebar');
  assert.equal(side.children.length, 1);
  assert.equal(side.children[0].component, 'sidebar');
  assert.equal(side.children[0].enableClose, false);
  assert.equal(side.enableTabStrip, true);
  assert.equal(side.weight, 16);
  assert.equal(main.enableTabStrip, true);
  assert.equal(main.weight, 84);
  assert.deepEqual(main.children.map((c) => c.id), ['t_page', 't_ov', 't_page2']);
  assert.equal(main.selected, 2); // 原 selected=3，拆掉 index0 后变 2
});
