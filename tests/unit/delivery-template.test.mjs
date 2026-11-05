// **交付提示词模板化 + 外部参数平面扩展**（任务 #62）：
//
//   交付提示词 = 原始提示词（task.text 原文）+ 组 / 项目的关键路径（本地 md 路径）
//   ——这段封装是一份**模板 + 占位符**，可在设置里改（面板可见），
//   领取引擎支持**平面扩展**（--param k=v → ctx 顶层与 {{params.*}}）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DELIVERY_TEMPLATE,
  buildDeliveryCtx,
  deliveryCtxOf,
  renderDelivery,
} from '../../src/modules/tasktool/delivery-template.js';
import { parseParams } from '../../src/modules/tasktool/params.js';
import { renderInstruction } from '../../src/core/instruction-template.js';

const GROUP_CTX = {
  repo: {
    name: 'alpha',
    key: 'local/alpha',
    intro: { body: '# alpha\n\n管清单的', path: 'C:/docs/repo/alpha.md' },
    introSet: { count: 1, main: {}, extras: [] },
    docLinks: [{ abs: 'D:/vault/qa.md', tag: 'qa', note: '问答集' }],
  },
  groups: [
    {
      name: 'nx系列',
      key: 'board/nx',
      desc: 'nx 工具链组合',
      intro: { body: '# nx系列\n\n本机 nx- 前缀工具链的组合', path: 'C:/docs/board/nx.md' },
      introSet: { count: 1, main: {}, extras: [] },
      note: '组里的任务出入口',
      peers: [{ name: 'beta', note: '仓库与技能登记' }],
      docLinks: [{ rel: 'notes/waitgoal.md', abs: 'C:/docs/notes/waitgoal.md', note: '阻塞窗口' }],
    },
  ],
};

test('默认模板：复现「项目介绍 + 组上下文」两段', () => {
  const ctx = buildDeliveryCtx({
    task: { id: 3, text: '# 改登录页' },
    goal: null,
    source: 'local',
    summary: '开干',
    cwd: 'D:/work/alpha',
    name: 'alpha',
    groupCtx: GROUP_CTX,
  });
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx);
  assert.match(out, /〔项目介绍 · alpha〕（C:\/docs\/repo\/alpha\.md）：/);
  assert.match(out, /管清单的/);
  assert.match(out, /〔项目组上下文 · nx系列〕/);
  assert.match(out, /组定位：nx 工具链组合/);
  assert.match(out, /本项目在组里的位置：组里的任务出入口/);
  assert.match(out, /组内成员：/);
  assert.match(out, /- beta：仓库与技能登记/);
  assert.match(out, /组绑定参考文件（可直接读取）：/);
  assert.match(out, /waitgoal\.md/);
});

test('没有组时：组段落整段不出现（项目介绍仍在）', () => {
  const ctx = buildDeliveryCtx({
    task: { id: 1, text: 'x' },
    groupCtx: { repo: GROUP_CTX.repo, groups: [] },
  });
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx);
  assert.match(out, /〔项目介绍 · alpha〕/);
  assert.doesNotMatch(out, /项目组上下文/);
  assert.doesNotMatch(out, /组内成员/);
});

test('原始提示词可以进交付（{{task.text}}）', () => {
  const ctx = buildDeliveryCtx({ task: { id: 7, text: '# 原始提示词\n\n照这做' }, groupCtx: GROUP_CTX });
  const out = renderDelivery('原文：{{task.text}}\n组：{{group.name}}', ctx);
  assert.match(out, /原文：# 原始提示词/);
  assert.match(out, /照这做/);
  assert.match(out, /组：nx系列/);
});

test('外部参数：顶层平铺 + params 归拢，内建键不被覆盖', () => {
  const ctx = buildDeliveryCtx({
    task: { id: 1, text: 'x' },
    groupCtx: GROUP_CTX,
    params: { lane: 'payment', task: 'hijack' },
  });
  assert.equal(ctx.lane, 'payment', '顶层平铺');
  assert.equal(ctx.params.lane, 'payment', 'params 归拢');
  assert.notEqual(ctx.task, 'hijack', '内建键不被外部参数覆盖');
  assert.equal(ctx.task.id, 1);
});

test('parseParams：k=v 可重复 / 逗号分隔，坏项忽略', () => {
  assert.deepEqual(parseParams(['a=1', 'b=2, c=3']), { a: '1', b: '2', c: '3' });
  assert.deepEqual(parseParams(['a=']), { a: '' });
  assert.deepEqual(parseParams(['坏项', '=无键', 'k=v']), { k: 'v' });
  assert.deepEqual(parseParams(undefined), {});
});

test('渲染器支持任意段落名（{{#repo}} / {{#group}}）', () => {
  assert.equal(renderInstruction('A{{#repo}}B{{/repo}}C', { repo: { x: 1 } }), 'ABC');
  assert.equal(renderInstruction('A{{#repo}}B{{/repo}}C', { repo: null }), 'AC');
  // 未给这个键 = 未知标记：内容保留（与旧语义一致）
  assert.equal(renderInstruction('A{{#other}}B{{/other}}C', {}), 'ABC');
});

test('deliveryCtxOf：补充文档 / 参考文件给可读路径', () => {
  const frag = deliveryCtxOf(GROUP_CTX);
  assert.match(frag.repo.docs, /D:\/vault\/qa\.md/);
  assert.match(frag.repo.docs, /\[qa\]/);
  assert.match(frag.group.docs, /waitgoal\.md/);
  assert.match(frag.group.peers, /beta/);
});
