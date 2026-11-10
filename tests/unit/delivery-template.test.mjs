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
      peers: [{ name: 'beta', note: '仓库与技能登记', path: 'D:/repos/beta' }],
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

test('渲染器不再接受旧段落名（{{#repo}} / {{#group}} 已废弃）', () => {
  assert.throws(() => renderInstruction('A{{#repo}}B{{/repo}}C', { repo: { x: 1 } }), /旧区块语法/);
  assert.throws(() => renderInstruction('A{{#group}}B{{/group}}C', { group: { x: 1 } }), /旧区块语法/);
  assert.throws(() => renderInstruction('A{{#other}}B{{/other}}C', {}), /旧区块语法/);
});

test('deliveryCtxOf：补充文档 / 参考文件 / 成员是结构化数组（模板用循环）', () => {
  const frag = deliveryCtxOf(GROUP_CTX);
  assert.equal(frag.repo.docCount, 1);
  assert.equal(frag.repo.docs[0].path, 'D:/vault/qa.md');
  assert.equal(frag.repo.docs[0].tag, 'qa');
  assert.equal(frag.group.docCount, 1);
  assert.match(frag.group.docs[0].path, /waitgoal\.md/);
  assert.equal(frag.group.peerCount, frag.group.peers.length);
  assert.ok(frag.group.peers.some((p) => p.name === 'beta'));
  // #163：成员带本机路径，默认模板渲染在括号说明之后，agent 直接定位兄弟仓库
  assert.equal(frag.group.peers[0].path, 'D:/repos/beta');
  const peersOut = renderDelivery(
    DEFAULT_DELIVERY_TEMPLATE,
    buildDeliveryCtx({ task: { id: 3, text: 'x' }, groupCtx: GROUP_CTX })
  );
  assert.match(peersOut, /- beta：仓库与技能登记（D:\/repos\/beta）/);
  // 旧闸门键（repoDocs / groupPeers）已删除，不再作为变量提供
  assert.equal(frag.repoDocs, undefined);
  assert.equal(frag.groupPeers, undefined);
});

// #81：空壳组（只有成员名单、全员无描述）不该渲染——喷一排空标签还让
// 「单独仓库」看着像被归了组。内置模板的 {{#if group}} 是「键在不在」，
// 所以在 deliveryCtxOf 里把空壳组过滤成 null。
test('空壳组不渲染：无定位/介绍/位置、成员全无描述 → ctx.group 为 null（#81）', () => {
  // fr/mobile 形态：唯一「内容」是成员名单，且全员（无组内描述）
  const shell = {
    repo: { name: 'fr', key: 'local/fr' },
    groups: [
      { name: 'mobile', key: 'board/mobile', desc: '', intro: null, note: '', peers: [{ name: 'mn-rt', note: '' }] },
    ],
  };
  const ctx = buildDeliveryCtx({ task: { id: 1, text: 'x' }, groupCtx: shell });
  assert.equal(ctx.group, null);
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx);
  assert.doesNotMatch(out, /项目组上下文/);
  assert.doesNotMatch(out, /组定位：/);
  assert.doesNotMatch(out, /组内成员/);

  // ve/workspace 形态：独苗成员，连 peers 都没有
  const bare = {
    repo: { name: 've', key: 'local/ve' },
    groups: [{ name: 'workspace', key: 'board/workspace', desc: '', intro: null, note: '' }],
  };
  const ctx2 = buildDeliveryCtx({ task: { id: 2, text: 'x' }, groupCtx: bare });
  assert.equal(ctx2.group, null);
  assert.doesNotMatch(renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx2), /项目组上下文/);
});

test('多组：空壳组被跳过，第一个有料的当主组', () => {
  const multi = {
    repo: { name: 'x', key: 'local/x' },
    groups: [
      { name: 'shell', desc: '', intro: null, note: '', peers: [{ name: 'p', note: '' }] },
      { name: 'real', desc: '真有料', note: '占个位', peers: [] },
    ],
  };
  const ctx = buildDeliveryCtx({ task: { id: 3, text: 'x' }, groupCtx: multi });
  assert.equal(ctx.group.name, 'real');
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx);
  assert.doesNotMatch(out, /shell/);
  assert.match(out, /组定位：真有料/);
  assert.match(out, /本项目在组里的位置：占个位/);
});

test('组只要有一项真内容就照给：仅成员带描述也算', () => {
  const g = {
    repo: { name: 'x', key: 'local/x' },
    groups: [
      { name: 'g1', desc: '', intro: null, note: '', peers: [{ name: 'p', note: '干活的' }] },
    ],
  };
  const ctx = buildDeliveryCtx({ task: { id: 4, text: 'x' }, groupCtx: g });
  assert.notEqual(ctx.group, null);
  assert.match(renderDelivery(DEFAULT_DELIVERY_TEMPLATE, ctx), /- p：干活的/);
});

// #86：参考仓库（repos 里 type=ref，不是文档库 refs）——交付只给
// 「本仓库直接绑定 ∪ 本次任务所属组」的去重并集，不给无关组；一条都没有时整段不出现。
const REF_REPO_CTX = {
  repo: {
    name: 'alpha',
    key: 'local/alpha',
    intro: { body: 'intro', path: 'C:/docs/repo/alpha.md' },
    docLinks: [],
    refRepos: [
      { key: 'github.com/x/shared', name: 'shared', path: 'D:/refs/shared', note: '' },
      { key: 'github.com/x/own', name: 'own', path: 'D:/refs/own', note: '本仓库专用' },
    ],
  },
  groups: [
    {
      name: 'nx',
      key: 'board/nx',
      desc: 'nx 组',
      intro: null,
      note: '',
      peers: [],
      docLinks: [],
      refRepos: [
        { key: 'github.com/x/own', name: 'own', path: 'D:/refs/own', note: '组级也绑了' },
        { key: 'github.com/x/grouped', name: 'grouped', path: 'D:/refs/grouped', note: '组级参考' },
      ],
    },
    {
      name: 'other',
      key: 'board/other',
      desc: '无关组',
      intro: null,
      note: '',
      peers: [],
      docLinks: [],
      refRepos: [{ key: 'github.com/x/unrelated', name: 'unrelated', path: 'D:/refs/unrelated', note: '' }],
    },
  ],
};

test('参考仓库段：直接绑定 ∪ 组级绑定（去重、不含无关组、名字与路径齐全）', () => {
  const frag = deliveryCtxOf(REF_REPO_CTX);
  assert.equal(frag.repo.refRepos.length, 2);
  assert.equal(frag.group.refRepos.length, 2);
  assert.deepEqual(frag.refRepos.list.map((x) => x.name), ['shared', 'own', 'grouped'], '去重并集，本仓库在前');
  assert.equal(frag.refRepos.count, 3);

  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, buildDeliveryCtx({ task: { id: 9, text: 'x' }, groupCtx: REF_REPO_CTX }));
  assert.match(out, /参考仓库（可直接读取，共 3 个）：/);
  const refLines = out.split('\n').filter((l) => /^ {2}- .*（D:\/refs\//.test(l));
  assert.deepEqual(refLines.map((l) => l.match(/^ {2}- ([^（]+)/)[1]), ['shared', 'own', 'grouped']);
  assert.match(out, /- own（D:\/refs\/own）/);
  assert.match(out, /组级也绑了|本仓库专用/, '去重后保留一条描述');
  assert.doesNotMatch(out, /unrelated/, '无关组的参考仓库不出现');
});

test('参考仓库段：没有任何绑定时整段不出现', () => {
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, buildDeliveryCtx({ task: { id: 10, text: 'x' }, groupCtx: GROUP_CTX }));
  assert.doesNotMatch(out, /参考仓库（可直接读取/);
  assert.equal(deliveryCtxOf(GROUP_CTX).refRepos.count, 0);
});

test('参考仓库段：仓库没有项目介绍也照给（repo 主段仍按 intro 收敛）', () => {
  const ctx = {
    repo: { name: 'bare', key: 'local/bare', refRepos: [{ key: 'k', name: 'r1', path: 'D:/refs/r1', note: '' }] },
    groups: [],
  };
  const out = renderDelivery(DEFAULT_DELIVERY_TEMPLATE, buildDeliveryCtx({ task: { id: 11, text: 'x' }, groupCtx: ctx }));
  assert.doesNotMatch(out, /〔项目介绍/, '没有 intro 不渲染项目介绍段');
  assert.match(out, /参考仓库（可直接读取，共 1 个）：/);
  assert.match(out, /- r1（D:\/refs\/r1）/);
});
