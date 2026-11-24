import {
  test,
} from 'node:test';
import assert from 'node:assert/strict';
import {
  Model,
} from 'flexlayout-react';
import {
  healMainTabset,
  initialLayoutJson,
  healRightPanelsInMain,
  rightTabsetId,
} from '../../src/web/frontend/workspace.js';
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

// ════ workspace-heal-main.test.mjs（#200 合并入本文件）════
const badLayout = () => ({
  global: {},
  borders: [],
  layout: {
    type: 'row',
    children: [
      { type: 'tabset', id: 'ts_sidebar', weight: 16, enableTabStrip: false, children: [{ type: 'tab', id: 't_sidebar', name: '目录', component: 'sidebar' }] },
      {
        type: 'tabset',
        id: 'ts_main',
        weight: 16, // 被 setRightSidebarVisible 误压过
        enableTabStrip: false,
        children: [
          { type: 'tab', id: 't_group', name: '项目组', component: 'group' },
          { type: 'tab', id: 't_refs', name: '文档列表', component: 'refs' },
        ],
      },
    ],
  },
});

test('#115 healRightPanelsInMain：refs 从主区搬出，补 ts_right，主区宽度修回 68', () => {
  const json = badLayout();
  assert.equal(healRightPanelsInMain(json), true);

  const ids = json.layout.children.map((c) => c.id);
  assert.deepEqual(ids, ['ts_sidebar', 'ts_main', 'ts_right'], '右栏被补回来');

  const main = json.layout.children.find((c) => c.id === 'ts_main');
  assert.deepEqual(main.children.map((c) => c.component), ['group'], '主区只剩正文面板');
  assert.equal(main.weight, 68, '被压扁的主区宽度修回默认');

  const right = json.layout.children.find((c) => c.id === 'ts_right');
  assert.deepEqual(right.children.map((c) => c.component), ['refs']);
  assert.equal(right.weight, 16);
  assert.equal(right.enableTabStrip, false, '右栏不显示页签条');
});

test('#115 主区只剩 refs 时：补回「开始」页，主区不留空', () => {
  const json = {
    global: {},
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'ts_main',
          weight: 68,
          enableTabStrip: false,
          children: [{ type: 'tab', id: 't_refs', name: '文档列表', component: 'refs' }],
        },
      ],
    },
  };
  healRightPanelsInMain(json);
  const main = json.layout.children.find((c) => c.id === 'ts_main');
  const right = json.layout.children.find((c) => c.id === 'ts_right');
  assert.deepEqual(main.children.map((c) => c.component), ['welcome']);
  assert.deepEqual(right.children.map((c) => c.component), ['refs']);
});

test('#115 rightTabsetId：含主区面板的 tabset 不算右栏', () => {
  const json = badLayout(); // 愈合前：ts_main 里混着 refs
  const model = Model.fromJson(json);
  assert.notEqual(rightTabsetId(model), 'ts_main', '主区 tabset 不能被当成右侧栏');

  healRightPanelsInMain(json);
  const healed = Model.fromJson(json);
  assert.equal(rightTabsetId(healed), 'ts_right', '愈合后右栏就是新补的那块');
});

test('#115 干净布局：healRightPanelsInMain 不动手', () => {
  const json = {
    global: {},
    layout: {
      type: 'row',
      children: [
        { type: 'tabset', id: 'ts_main', weight: 68, children: [{ type: 'tab', id: 't1', component: 'group' }] },
        { type: 'tabset', id: 'ts_right', weight: 16, children: [{ type: 'tab', id: 't2', component: 'refs' }] },
      ],
    },
  };
  assert.equal(healRightPanelsInMain(json), false);
  assert.equal(json.layout.children.find((c) => c.id === 'ts_main').children.length, 1);
});

