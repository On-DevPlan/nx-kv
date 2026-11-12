// 持续 get（waitgoal）内文的取值口径。
//
// #182 起这条链只有**一个**出处：
//   仓库侧配置 = { enabled, waitMinutes }（开关 + 阻塞分钟），不再有 template；
//   交付里那段「继续 get」的文案 = 设置 → 提示词模板 → 持续 get 区块的模板，
//   而该区块的**内置模板**就是 src/shared/prompt-blocks.js 的
//   DEFAULT_GETLOOP_TEMPLATE（getLoopInstruction 交出的正是这一份）。
//
// 所以这里钉两件事：
//   1. 默认内文与共享层同源（前后端单一真相源，不再有第二份副本）；
//   2. 仓库就算还留着历史 template 字段，也**不再影响**交付文本（老数据读入即忽略）。
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

test('开启 → 交出共享层那份内文（可直接当模板渲染）', () => {
  assert.equal(getLoopInstruction({ enabled: true, waitMinutes: 5 }), DEFAULT_GETLOOP_INSTRUCTION);
  assert.match(DEFAULT_GETLOOP_INSTRUCTION, /\{\{getloop\.waitMinutes\}\}/, '阻塞分钟数是模板槽位，不是写死的值');
  assert.match(DEFAULT_GETLOOP_INSTRUCTION, /\{\{task\.id\}\}/, '任务编号同理');
});

test('仓库级 template 已下线：老数据里带着也忽略（文案归全局区块）', () => {
  assert.equal(getLoopInstruction({ enabled: true, template: '老的一条' }), DEFAULT_GETLOOP_INSTRUCTION);
  assert.equal(getLoopInstruction({ enabled: true, template: ['第一条', '第二条'] }), DEFAULT_GETLOOP_INSTRUCTION);
});

test('未开启时返回空串（不投递该段）', () => {
  assert.equal(getLoopInstruction({ enabled: false, template: ['不该出现'] }), '');
  assert.equal(getLoopInstruction({ enabled: false }), '');
  assert.equal(getLoopInstruction(null), '');
  assert.equal(getLoopInstruction(undefined), '');
});
