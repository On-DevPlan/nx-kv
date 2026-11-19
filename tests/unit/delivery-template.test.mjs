// **交付上下文插件化**（原 delivery-template.test，S1 起 deliveryCtxOf 住
// promptplug/plugins/context.ts，经 ContextPlugin.data() 变换）：
//
//   交付提示词 = 原始提示词（task.text 原文）+ 组 / 项目的关键路径（本地 md 路径）
//   ——这段封装是一份**模板 + 占位符**，可在设置里改（面板可见）。
//   本文件钉住 context 插件的 ctx 变换口径（#81 / #104 / #163 / #86 各裁决不变）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextPlugin } from '../../src/modules/promptplug/plugins/context.js';
import { parseParams } from '../../src/modules/claim/params.js';
import { renderInstruction } from '../../src/core/instruction-template.js';
import { templatesOf } from '../../src/modules/promptplug/index.js';

// #152 起正文在插件类里：context 段的内置模板 = templates[0]
const TPL = templatesOf('context')[0].text;

/** 与 wait.ts 同构的最小组装：seed + context 插件写回段。 */
async function ctxOf(groupCtx, extra = {}) {
  const p = new ContextPlugin(TPL, { groupCtx });
  const data = await p.get('data');
  return { task: null, cwd: '', source: '', summary: '', name: '', params: {}, ...data, ...extra };
}
const renderCtx = (ctx) => renderInstruction(TPL, ctx);

const GROUP_CTX = {
  repo: {
    name: 'alpha',
    key: 'local/alpha',
    intro: { body: '# alpha\n\n管清单的', path: 'C:/docs/repo/alpha.md', refId: 'ref_alpha', desc: '项目总览' },
    introSet: { count: 1, main: {}, extras: [] },
    docLinks: [{ refId: 'ref_qa', desc: '问答集', title: 'QA', hasBody: true, note: '问答集' }],
  },
  groups: [
    {
      name: 'nx系列',
      key: 'board/nx',
      desc: 'nx 工具链组合',
      intro: {
        body: '# nx系列\n\n本机 nx- 前缀工具链的组合',
        path: 'C:/docs/board/nx.md',
        refId: 'ref_group',
        desc: '组介绍描述',
        title: 'nx系列',
      },
      introSet: { count: 1, main: {}, extras: [] },
      note: '组里的任务出入口',
      peers: [{ name: 'beta', note: '仓库与技能登记', path: 'D:/repos/beta' }],
      docLinks: [{ refId: 'ref_wait', desc: 'waitgoal 设计', title: 'waitgoal', hasBody: true, note: '阻塞窗口' }],
    },
  ],
};

test('context 默认模板：只内嵌项目主篇；组介绍 / 其余文档只给 desc + 取用指令', async () => {
  const ctx = await ctxOf(GROUP_CTX, { task: { id: 3, text: '# 改登录页' }, cwd: 'D:/work/alpha' });
  const out = renderCtx(ctx);
  assert.match(out, /〔项目介绍 · alpha〕/);
  assert.match(out, /管清单的/, '项目主篇正文内嵌');
  // v13：文档列表 title 优先、desc 作副行（note 不再持久化到 ref 绑定上）
  assert.match(out, /- QA/, '项目文档按 title 展示');
  assert.match(out, /问答集/, '项目文档副行是 desc');
  assert.match(out, /nx-kv docs get --ref ref_qa/);
  assert.match(out, /〔项目组上下文 · nx系列〕/);
  assert.match(out, /组定位：nx 工具链组合/);
  assert.match(out, /本项目在组里的位置：组里的任务出入口/);
  assert.match(out, /组介绍：组介绍描述/);
  assert.match(out, /nx-kv docs get --ref ref_group/);
  assert.match(out, /- waitgoal\n/, '组文档按 title 展示');
  assert.match(out, /waitgoal 设计/, '组文档副行是 desc');
  assert.match(out, /nx-kv docs get --ref ref_wait/);
  assert.match(out, /组内成员：/);
  assert.match(out, /- beta：仓库与技能登记/);
  // 组介绍正文不再内嵌（只有项目主篇内嵌）；也不再出现任何路径
  assert.doesNotMatch(out, /本机 nx- 前缀工具链的组合/);
  assert.doesNotMatch(out, /C:\/docs\//);
});

test('没有组时：组段落整段不出现（项目介绍仍在）', async () => {
  const ctx = await ctxOf({ repo: GROUP_CTX.repo, groups: [] });
  const out = renderCtx(ctx);
  assert.match(out, /〔项目介绍 · alpha〕/);
  assert.doesNotMatch(out, /项目组上下文/);
  assert.doesNotMatch(out, /组内成员/);
});

test('原始提示词可以进交付（{{task.text}}）——模板层变量，ctx.task 由 seed 提供', async () => {
  const ctx = await ctxOf(GROUP_CTX, { task: { id: 7, text: '# 原始提示词\n\n照这做' } });
  const out = renderInstruction('原文：{{task.text}}\n组：{{group.name}}', ctx);
  assert.match(out, /原文：# 原始提示词/);
  assert.match(out, /照这做/);
  assert.match(out, /组：nx系列/);
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

test('deliveryCtxOf：文档 / 参考文件 / 成员是结构化数组（模板用循环）', async () => {
  const frag = await ctxOf(GROUP_CTX);
  assert.equal(frag.repo.docCount, 1);
  assert.equal(frag.repo.docs[0].refId, 'ref_qa');
  assert.equal(frag.repo.docs[0].desc, '问答集');
  assert.equal(frag.repo.docs[0].hasBody, true);
  assert.equal(frag.group.docCount, 1);
  assert.equal(frag.group.docs[0].refId, 'ref_wait');
  assert.equal(frag.group.docs[0].desc, 'waitgoal 设计');
  assert.equal(frag.group.peerCount, frag.group.peers.length);
  assert.ok(frag.group.peers.some((p) => p.name === 'beta'));
  // #163：成员带本机路径，默认模板渲染在括号说明之后，agent 直接定位兄弟仓库
  assert.equal(frag.group.peers[0].path, 'D:/repos/beta');
  const peersOut = renderCtx(await ctxOf(GROUP_CTX, { task: { id: 3, text: 'x' } }));
  assert.match(peersOut, /- beta：仓库与技能登记（D:\/repos\/beta）/);
  // 旧闸门键（repoDocs / groupPeers）已删除，不再作为变量提供
  assert.equal(frag.repoDocs, undefined);
  assert.equal(frag.groupPeers, undefined);
});

// #81：空壳组（只有成员名单、全员无描述）不该渲染——喷一排空标签还让
// 「单独仓库」看着像被归了组。内置模板的 {{#if group}} 是「键在不在」，
// 所以在 deliveryCtxOf 里把空壳组过滤成 null。
test('空壳组不渲染：无定位/介绍/位置、成员全无描述 → ctx.group 为 null（#81）', async () => {
  // fr/mobile 形态：唯一「内容」是成员名单，且全员（无组内描述）
  const shell = {
    repo: { name: 'fr', key: 'local/fr' },
    groups: [
      { name: 'mobile', key: 'board/mobile', desc: '', intro: null, note: '', peers: [{ name: 'mn-rt', note: '' }] },
    ],
  };
  const ctx = await ctxOf(shell, { task: { id: 1, text: 'x' } });
  assert.equal(ctx.group, null);
  const out = renderCtx(ctx);
  assert.doesNotMatch(out, /项目组上下文/);
  assert.doesNotMatch(out, /组定位：/);
  assert.doesNotMatch(out, /组内成员/);

  // ve/workspace 形态：独苗成员，连 peers 都没有
  const bare = {
    repo: { name: 've', key: 'local/ve' },
    groups: [{ name: 'workspace', key: 'board/workspace', desc: '', intro: null, note: '' }],
  };
  const ctx2 = await ctxOf(bare, { task: { id: 2, text: 'x' } });
  assert.equal(ctx2.group, null);
  assert.doesNotMatch(renderCtx(ctx2), /项目组上下文/);
});

test('多组：空壳组被跳过，第一个有料的当主组', async () => {
  const multi = {
    repo: { name: 'x', key: 'local/x' },
    groups: [
      { name: 'shell', desc: '', intro: null, note: '', peers: [{ name: 'p', note: '' }] },
      { name: 'real', desc: '真有料', note: '占个位', peers: [] },
    ],
  };
  const ctx = await ctxOf(multi, { task: { id: 3, text: 'x' } });
  assert.equal(ctx.group.name, 'real');
  const out = renderCtx(ctx);
  assert.doesNotMatch(out, /shell/);
  assert.match(out, /组定位：真有料/);
  assert.match(out, /本项目在组里的位置：占个位/);
});

test('组只要有一项真内容就照给：仅成员带描述也算', async () => {
  const g = {
    repo: { name: 'x', key: 'local/x' },
    groups: [
      { name: 'g1', desc: '', intro: null, note: '', peers: [{ name: 'p', note: '干活的' }] },
    ],
  };
  const ctx = await ctxOf(g, { task: { id: 4, text: 'x' } });
  assert.notEqual(ctx.group, null);
  assert.match(renderCtx(ctx), /- p：干活的/);
});

// #104：context 段不能静默消失。两种「没有上下文」都必须在交付文本里说清原因，
// 并给可执行的修复命令——否则用户只看到「这条任务没有 nx-kv.context」，无从判断
// 是目录没登记、还是登记了没写介绍（旧实现两种都是空串，整块消失）。
test('#104 目录未登记：context 段给出原因 + repo add 命令（不需要 .git）', async () => {
  const ctx = await ctxOf(null, { task: { id: 9, text: 'x' }, cwd: 'D:/work/unregistered' });
  const out = renderCtx(ctx);
  assert.match(out, /未登记为本机仓库/);
  assert.match(out, /D:\/work\/unregistered/);
  assert.match(out, /nx-kv repo add "D:\/work\/unregistered" --key <key>/);
  assert.match(out, /不需要 \.git/);
});

test('#104 已登记但没写项目介绍：repo 进 ctx，context 段给 repo doc add 提示', async () => {
  const groupCtx = { repo: { name: 'nx-kn', key: 'github.com/on-devplan/nx-kn', intro: null, docLinks: [] }, groups: [] };
  const ctx = await ctxOf(groupCtx, { task: { id: 10, text: 'x' }, cwd: 'D:/a_js/js_proj/nx-kn' });
  assert.notEqual(ctx.repo, null, '已登记的仓库必须进 ctx（不再要求有介绍正文）');
  assert.equal(ctx.repo.name, 'nx-kn');
  const out = renderCtx(ctx);
  assert.match(out, /〔项目上下文 · nx-kn〕已登记为本机仓库/);
  assert.match(out, /nx-kv repo doc add github\.com\/on-devplan\/nx-kn --ref <refId>/);
  assert.doesNotMatch(out, /未登记为本机仓库/);
});

test('#104 全局池（cwd 为空）不出「未登记」噪音', async () => {
  const ctx = await ctxOf(null, { task: { id: 11, text: 'x' }, cwd: '' });
  const out = renderCtx(ctx);
  assert.doesNotMatch(out, /项目上下文/);
  assert.doesNotMatch(out, /未登记/);
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

test('参考仓库段：直接绑定 ∪ 组级绑定（去重、不含无关组、名字与路径齐全）', async () => {
  const frag = await ctxOf(REF_REPO_CTX);
  assert.equal(frag.repo.refRepos.length, 2);
  assert.equal(frag.group.refRepos.length, 2);
  assert.deepEqual(frag.refRepos.list.map((x) => x.name), ['shared', 'own', 'grouped'], '去重并集，本仓库在前');
  assert.equal(frag.refRepos.count, 3);

  const out = renderCtx(await ctxOf(REF_REPO_CTX, { task: { id: 9, text: 'x' } }));
  assert.match(out, /参考仓库（可直接读取，共 3 个）：/);
  const refLines = out.split('\n').filter((l) => /^ {2}- .*（D:\/refs\//.test(l));
  assert.deepEqual(refLines.map((l) => l.match(/^ {2}- ([^（]+)/)[1]), ['shared', 'own', 'grouped']);
  assert.match(out, /- own（D:\/refs\/own）/);
  // v13：参考仓库绑定上的 note 不再持久化，渲染只给「名字 + 本机路径」
  assert.doesNotMatch(out, /组级也绑了|本仓库专用/, '去重后只留名字与路径，绑定 note 不再出现');
  assert.doesNotMatch(out, /unrelated/, '无关组的参考仓库不出现');
});

test('参考仓库段：没有任何绑定时整段不出现', async () => {
  const out = renderCtx(await ctxOf(GROUP_CTX, { task: { id: 10, text: 'x' } }));
  assert.doesNotMatch(out, /参考仓库（可直接读取/);
  assert.equal((await ctxOf(GROUP_CTX)).refRepos.count, 0);
});

test('参考仓库段：仓库没有项目介绍也照给（repo 主段仍按 intro 收敛）', async () => {
  const groupCtx = {
    repo: { name: 'bare', key: 'local/bare', refRepos: [{ key: 'k', name: 'r1', path: 'D:/refs/r1', note: '' }] },
    groups: [],
  };
  const out = renderCtx(await ctxOf(groupCtx, { task: { id: 11, text: 'x' } }));
  assert.doesNotMatch(out, /〔项目介绍/, '没有 intro 不渲染项目介绍段');
  assert.match(out, /参考仓库（可直接读取，共 1 个）：/);
  assert.match(out, /- r1（D:\/refs\/r1）/);
});
