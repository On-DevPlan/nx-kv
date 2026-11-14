// 右栏面板被存进主内容区的读盘愈合（#115）。
//
// 现象：点「查看详情」，文档列表整块顶掉了项目组的 landing 页——因为老布局把
// refs 面板记在了 ts_main 里，openPanel 只是 selectTab，它就继续占着正文区域。
//
// 两道防线：
//   1) 读盘愈合 healRightPanelsInMain：把 refs/progress 从 ts_main 摘出来补进右栏；
//   2) rightTabsetId 不把「混在主区的 tabset」当右栏（否则 setRightSidebarVisible
//      会把主区压成 16% 宽）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from 'flexlayout-react';
import {
  healRightPanelsInMain,
  rightTabsetId,
} from '../../src/web/frontend/workspace.js';

/** 存坏的布局：refs 被塞进 ts_main，没有独立右栏。 */
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
