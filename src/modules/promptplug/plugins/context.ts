// context 插件（order 10）：组 / 项目上下文。
// data() 搬自 claim/assemble.ts 的 deliveryCtxOf（原文件随 S1 删除），
// 口径注释一并迁入——#81 空壳组过滤、#104 已登记无介绍可见、参考仓库去重并集。
import { z } from 'zod';
import { PromptPlugin, supplied, type Supply, type TemplateText } from '../base.js';

// ── schema = 变量目录的唯一真相 ─────────────────────────────────────────
// 每个字段的 .describe() 就是设置页「可使用变量」里显示的含义（schema-bridge 把
// describe 读成 FieldDecl.label）。写清楚「这个变量是什么」，模板作者不用翻代码。
const docItemShape = z.looseObject({
  refId: z.string().describe('文档 id（nx-kv docs get --ref 用）'),
  desc: z.string().describe('一句话描述（列表里的定位标签）'),
  title: z.string().describe('文档标题（正文首行 # 标题）'),
  hasBody: z.boolean().describe('是否已写正文（false = 只有条目，没有内容）'),
});

const refRepoShape = z.looseObject({
  key: z.string().describe('参考仓库 key（仓库清单里的唯一标识）'),
  name: z.string().describe('参考仓库名'),
  path: z.string().describe('本地绝对路径（可直接读）'),
});

const peerShape = z.looseObject({
  name: z.string().describe('成员仓库名'),
  note: z.string().describe('组内描述：它在组里的角色与配合关系'),
  path: z.string().describe('本地绝对路径'),
  hasNote: z.boolean().describe('是否写了组内描述'),
});

const repoShape = z.looseObject({
  name: z.string().describe('项目名（登记名；未填时回落 key）'),
  key: z.string().describe('项目 key（本机组内唯一标识）'),
  intro: z.string().describe('项目介绍正文（主篇全文）'),
  introPath: z.string().describe('项目介绍文档路径（本地 md；没有为空串）'),
  introRefId: z.string().describe('项目介绍文档 id（docs get --ref 用）'),
  introDesc: z.string().describe('项目介绍的一句话描述'),
  docs: z.array(docItemShape).describe('项目文档清单（refId / desc / title）'),
  docCount: z.number().describe('项目文档数'),
  refRepos: z.array(refRepoShape).describe('绑定到本项目的参考仓库清单'),
  refRepoCount: z.number().describe('参考仓库数'),
});

const groupShape = z.looseObject({
  name: z.string().describe('项目组名'),
  key: z.string().describe('项目组 key（组内唯一标识）'),
  desc: z.string().describe('组定位：这个组是干什么的（一句话）'),
  intro: z.string().describe('组介绍正文（主篇全文）'),
  introPath: z.string().describe('组介绍文档路径（本地 md；没有为空串）'),
  introRefId: z.string().describe('组介绍文档 id（docs get --ref 用）'),
  introDesc: z.string().describe('组介绍的一句话描述'),
  note: z.string().describe('组内描述：本项目在组里的位置（角色 / 协作关系）'),
  position: z.string().describe('= note（旧字段名，新模板用 note）'),
  peers: z.array(peerShape).describe('组内成员（name / note / path）'),
  peerCount: z.number().describe('组内成员数'),
  docs: z.array(docItemShape).describe('组文档清单'),
  docCount: z.number().describe('组文档数'),
  refRepos: z.array(refRepoShape).describe('组级绑定的参考仓库清单'),
  refRepoCount: z.number().describe('组级参考仓库数'),
});

const schema = z.strictObject({
  repo: repoShape.nullable().describe('本项目（工作目录对应的登记仓库）；未登记 → null，整段换「未登记」提示'),
  group: groupShape.nullable().describe('本次任务所属的项目组；没有组 / 空壳组 → null'),
  refRepos: z
    .looseObject({
      list: z.array(refRepoShape).describe('项目绑定 ∪ 组级绑定（去重，项目在前）'),
      count: z.number().describe('去重后的总数'),
    })
    .describe('可直接读取的参考仓库（交付里单列一段）'),
  groups: z
    .array(z.looseObject({ name: z.string(), desc: z.string(), path: z.string() }))
    .describe('其它有内容的项目组概览（主组之外）'),
  // 可见 seed 变量（{{cwd}}），data() 不返回它
  cwd: z.string().optional().describe('工作目录绝对路径（seed，宿主传入）'),
});

/** 「项目文档 / 组文档」→ 结构化数组（模板用 {{#each}} 组织行）。 */
// #216 合并远端 schema v12：ref 的「分类标签」tag 已整个退役，这里不再搬它。
function docItems(links: any) {
  return (links || []).map((d: any) => ({
    refId: d.refId || '',
    desc: d.desc || '',
    title: d.title || '',
    hasBody: d.hasBody !== false,
  }));
}

/** 组内成员 → 结构化数组（{{name}} / {{note}} / {{path}}——#163：路径方便直接访问）。 */
function peerItems(peers: any) {
  return (peers || []).map((p: any) => ({
    name: p.name || '',
    note: p.note || '',
    path: p.path || '',
    hasNote: !!p.note,
  }));
}

/** 参考仓库（repos 里 type=ref，不是文档库 refs）→ 结构化数组。 */
function refRepoItems(list: any) {
  return (list || []).map((r: any) => ({
    key: r.key || '',
    name: r.name || '',
    path: r.path || '',
  }));
}

/**
 * 组有没有值得交付的内容：定位 / 介绍 / 位置 / 参考文件 / 有描述的成员，任一即可。
 * 纯「成员名单（全员无描述）」不算——那只会喷出一排空标签（#81）。
 */
function groupHasContent(g: any): boolean {
  if (!g) return false;
  if (g.desc || g.note) return true;
  if (g.intro && g.intro.body) return true;
  if (g.docLinks && g.docLinks.length) return true;
  if (g.refRepos && g.refRepos.length) return true;
  return (g.peers || []).some((p: any) => p.note);
}

export function deliveryCtxOf(groupCtx: any) {
  const repo = groupCtx && groupCtx.repo ? groupCtx.repo : null;
  const allGroups = (groupCtx && groupCtx.groups) || [];
  // 闸门是「键在不在」，不是「内容空不空」——空壳组进了 ctx 就会印出空标签（#81）。
  // 多组时跳过空壳选第一个有料的当主组，其余有料的进 {{groups}} 概览。
  const groups = allGroups.filter(groupHasContent);
  const g = groups[0] || null;
  const repoDocs = docItems(repo && repo.docLinks);
  const peers = g ? peerItems(g.peers) : [];
  const gdocs = g ? docItems(g.docLinks) : [];
  const repoRefRepos = refRepoItems(repo && repo.refRepos);
  const groupRefRepos = g ? refRepoItems(g.refRepos) : [];
  // 交付口径：本仓库直接绑定 ∪ 本次任务所属组的组级绑定，去重后按本仓库在前排序。
  const seenRefRepoKeys = new Set<string>();
  const refRepoList: { key: string; name: string; path: string }[] = [];
  for (const r of [...repoRefRepos, ...groupRefRepos]) {
    const k = r.key || r.name;
    if (seenRefRepoKeys.has(k)) continue;
    seenRefRepoKeys.add(k);
    refRepoList.push(r);
  }
  const others = groups.slice(1).map((x: any) => ({
    name: x.name || '',
    desc: x.desc || '',
    path: (x.intro && x.intro.path) || '',
  }));
  return {
    // #104：只要目录**已登记**，repo 就进 ctx（哪怕没写介绍、没绑文档）。
    repo: repo
      ? {
          name: repo.name || repo.key || '',
          key: repo.key || '',
          intro: (repo.intro && repo.intro.body) || '',
          introPath: (repo.intro && repo.intro.path) || '',
          introRefId: (repo.intro && repo.intro.refId) || '',
          introDesc: (repo.intro && (repo.intro.desc || repo.intro.title)) || '',
          docs: repoDocs,
          docCount: repoDocs.length,
          refRepos: repoRefRepos,
          refRepoCount: repoRefRepos.length,
        }
      : null,
    group: g
      ? {
          name: g.name || '',
          key: g.key || '',
          desc: g.desc || '',
          intro: (g.intro && g.intro.body) || '',
          introPath: (g.intro && g.intro.path) || '',
          introRefId: (g.intro && g.intro.refId) || '',
          introDesc: (g.intro && (g.intro.desc || g.intro.title)) || '',
          note: g.note || '',
          position: g.note || '',
          peers,
          peerCount: peers.length,
          docs: gdocs,
          docCount: gdocs.length,
          refRepos: groupRefRepos,
          refRepoCount: groupRefRepos.length,
        }
      : null,
    refRepos: { list: refRepoList, count: refRepoList.length },
    groups: others,
  };
}

/** 内置模板（#152：正文进代码，不再有 JSON 注册表 / DB seed）。 */
const BUILTIN: TemplateText = {
  id: 'builtin',
  name: '系统内置',
  text: `{{#if repo}}
{{#if repo.intro}}
〔项目介绍 · {{repo.name}}〕
{{repo.intro}}
{{/if}}
{{#if repo.docs}}
〔项目文档〕按需取用：nx-kv docs get --ref <refId>
{{#each repo.docs}}
  - {{#if title}}{{title}}{{else}}未命名文档{{/if}}{{#if desc}}
      {{desc}}{{/if}}
    取用：nx-kv docs get --ref {{refId}}
{{/each}}
{{/if}}
{{#if repo.intro}}{{else}}{{#if repo.docs}}{{else}}
〔项目上下文 · {{repo.name}}〕已登记为本机仓库（{{repo.key}}），但没有项目介绍文档：nx-kv repo doc add {{repo.key}} --ref <refId>
{{/if}}{{/if}}
{{/if}}
{{#if repo}}{{else}}{{#if cwd}}
〔项目上下文〕工作目录 {{cwd}} 未登记为本机仓库，本次交付没有项目介绍 / 组上下文。登记（不需要 .git，给 key 即可）：nx-kv repo add "{{cwd}}" --key <key>
{{/if}}{{/if}}
{{#if group}}
〔项目组上下文 · {{group.name}}〕
{{#if group.desc}}
组定位：{{group.desc}}
{{/if}}
{{#if group.note}}
本项目在组里的位置：{{group.note}}
{{/if}}
{{#if group.introRefId}}
组介绍：{{#if group.introDesc}}{{group.introDesc}}{{else}}（无描述）{{/if}}
  取用：nx-kv docs get --ref {{group.introRefId}}
{{/if}}
{{#if group.peers}}
组内成员：
{{#each group.peers}}
  - {{name}}：{{#if note}}{{note}}{{else}}（无组内描述）{{/if}}{{#if path}}（{{path}}）{{/if}}
{{/each}}
{{/if}}
{{#if group.docs}}
组文档（按需取用）：
{{#each group.docs}}
  - {{#if title}}{{title}}{{else}}未命名文档{{/if}}{{#if desc}}
      {{desc}}{{/if}}
    取用：nx-kv docs get --ref {{refId}}
{{/each}}
{{/if}}
{{/if}}
{{#if refRepos.count}}
参考仓库（可直接读取，共 {{refRepos.count}} 个）：
{{#each refRepos.list}}
  - {{name}}{{#if path}}（{{path}}）{{/if}}
{{/each}}
{{/if}}`,
};

export class ContextPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'context';
  readonly order = 10;
  readonly group = 'get' as const;
  readonly tag = 'nx-kv.context';
  readonly label = '组 / 项目上下文';
  readonly dataSchema = schema;
  readonly templates = [BUILTIN];

  constructor(template: string, private readonly deps: { groupCtx: Supply<unknown> }) {
    super(template);
  }

  protected async buildData() {
    return deliveryCtxOf(await supplied(this.deps.groupCtx));
  }
}
