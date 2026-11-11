// 持续 get（waitgoal）内文模板的取值口径。
//
// 两条坑都在这里被钉住：
//   1. 落库形态是 **string[]**（v0.14 起多条），而渲染器 renderInstruction 会
//      `String(template)`——数组直接传进去会变成逗号相连（'A,B'），
//      而不是设计里说的「按空行拼接」。getLoopInstruction 是唯一的拼接点。
//   2. 默认内文必须是**共享层**那一份（src/shared/prompt-blocks.js）——
//      服务端渲染与前端弹窗展示同源；此前前端另存副本，文案已悄悄分叉。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getLoopInstruction,
  DEFAULT_GET_LOOP_TEMPLATE,
} from '../../src/modules/tasktool/getloop.js';
import { DEFAULT_GETLOOP_INSTRUCTION } from '../../src/shared/prompt-blocks.js';

test('默认内文与共享层是同一份（前后端单一真相源）', () => {
  assert.equal(DEFAULT_GET_LOOP_TEMPLATE, DEFAULT_GETLOOP_INSTRUCTION);
});

test('多条模板按空行拼接，不是逗号相连', () => {
  const tpl = getLoopInstruction({ enabled: true, template: ['第一条', '第二条'] });
  assert.equal(tpl, '第一条\n\n第二条');
  assert.ok(!tpl.includes(','), '不应出现逗号连接');
});

test('单条模板原样返回（去首尾空白）', () => {
  assert.equal(getLoopInstruction({ enabled: true, template: ['  只有一条  '] }), '只有一条');
});

test('空条目被丢弃，全空则回落默认内文', () => {
  assert.equal(getLoopInstruction({ enabled: true, template: ['', '   '] }), DEFAULT_GETLOOP_INSTRUCTION);
  assert.equal(getLoopInstruction({ enabled: true, template: [] }), DEFAULT_GETLOOP_INSTRUCTION);
  assert.equal(getLoopInstruction({ enabled: true }), DEFAULT_GETLOOP_INSTRUCTION);
});

test('未开启时返回空串（不投递该段）', () => {
  assert.equal(getLoopInstruction({ enabled: false, template: ['不该出现'] }), '');
  assert.equal(getLoopInstruction(null), '');
});

test('旧 string 单条形态照样读（v0.14 前的落库形态）', () => {
  assert.equal(getLoopInstruction({ enabled: true, template: '老的一条' }), '老的一条');
});
