// 右栏首开面板的现建路径（#91，2026-11-07）。
//
// 背景：flexlayout-react 0.11 的 Model 没有 getRoot()（只有 getRootRow()），
// 「ts_right 缺失现建」分支曾因 `model.getRoot ? ...` 恒为 null 而整段死代码——
// 全新会话（应用加载管线 pruneEmptyTabsets 剪掉空 tabset 后，ts_right 不存在）
// 首次开右栏面板会掉进兜底：dock 进 ts_main 右缘，页签条（enableTabStrip 默认
// true）和乱宽度全冒出来。这组测试钉住复活后的行为：现建 tabset 必须无页签条、
// 宽度 16；popout 全局开关落在运行时属性上（false == 库默认，toJson 不落盘）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from 'flexlayout-react';
import {
  initialLayoutJson,
  openPanel,
  rightTabsetId,
  applyGlobalAttrs,
} from '../../src/web/frontend/workspace.js';

// 应用加载管线的产物：空 tabset（ts_right）已被剪掉
function loadedModelWithoutRight() {
  const json = initialLayoutJson();
  json.layout.children = json.layout.children.filter((c) => c.id !== 'ts_right');
  return Model.fromJson(json);
}

function rightTabsetOf(model) {
  const id = rightTabsetId(model);
  return id ? model.getNodeById(id) : null;
}

test('ts_right 缺失时首开右栏面板：现建 tabset 并归一（无页签条、宽 16）', () => {
  const model = loadedModelWithoutRight();
  assert.equal(model.getNodeById('ts_right'), undefined, '前置：ts_right 不存在');

  const r = openPanel(model, {
    component: 'progress',
    name: '进程',
    config: { dirKey: 'k1' },
    location: 'right',
  });
  assert.ok(r.tabId, '面板页签已创建');
  assert.equal(r.reused, false);

  const ts = rightTabsetOf(model);
  assert.ok(ts, '右栏 tabset 按内容认回');
  assert.equal(ts.getAttr('enableTabStrip'), false, '页签条必须压掉');
  assert.equal(ts.getAttr('weight'), 16, '宽度归一');
});

test('首开右栏面板落点不在主区（ts_main）里', () => {
  const model = loadedModelWithoutRight();
  openPanel(model, { component: 'progress', name: '进程', config: {}, location: 'right' });
  const main = model.getNodeById('ts_main');
  const kids = main.getTabNodes ? main.getTabNodes() : [];
  assert.equal(
    kids.some((t) => t.getComponent() === 'progress'),
    false,
    '进程面板不许 dock 进主区'
  );
});

test('再开另一块右栏面板：单面板位清理，页签条状态不回归', () => {
  const model = loadedModelWithoutRight();
  openPanel(model, { component: 'progress', name: '进程', config: { dirKey: 'k1' }, location: 'right' });
  openPanel(model, { component: 'refs', name: '文档列表', config: {}, location: 'right' });

  const ts = rightTabsetOf(model);
  assert.equal(ts.getAttr('enableTabStrip'), false);
  const comps = ts.getTabNodes().map((t) => t.getComponent());
  assert.deepEqual(comps, ['refs'], '旧的进程面板被清掉，只留新面板');
});

test('applyGlobalAttrs 关闭 popout（浮窗头部原生「弹出到浏览器窗口」按钮的开关）', () => {
  const model = loadedModelWithoutRight();
  applyGlobalAttrs(model);
  // 运行时属性是真相：false == 库默认值，toJson 不写 global（继承解析靠它）
  assert.equal(model.attributes.tabEnablePopout, false, 'tabEnablePopout 必须为 false');
});
