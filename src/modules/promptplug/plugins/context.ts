// context 插件（order 10）：组 / 项目上下文。
// data() 搬自 tasktool/delivery-template.ts 的 deliveryCtxOf（原文件随 S1 删除），
// 口径注释一并迁入——#81 空壳组过滤、#104 已登记无介绍可见、参考仓库去重并集。
import { z } from 'zod';
import { PromptPlugin } from '../base.js';

const docItemShape = z.looseObject({
  refId: z.string(),
  desc: z.string(),
  title: z.string(),
  hasBody: z.boolean(),
  note: z.string(),
});
const refRepoShape = z.looseObject({ key: z.string(), name: z.string(), path: z.string(), note: z.string() });
const peerShape = z.looseObject({ name: z.string(), note: z.string(), path: z.string(), hasNote: z.boolean() });

const repoShape = z.looseObject({
  name: z.string(), key: z.string(),
  intro: z.string(), introPath: z.string(), introRefId: z.string(), introDesc: z.string(),
  docs: z.array(docItemShape), docCount: z.number(),
  refRepos: z.array(refRepoShape), refRepoCount: z.number(),
});
const groupShape = z.looseObject({
  name: z.string(), key: z.string(), desc: z.string(),
  intro: z.string(), introPath: z.string(), introRefId: z.string(), introDesc: z.string(),
  note: z.string(), position: z.string(),
  peers: z.array(peerShape), peerCount: z.number(),
  docs: z.array(docItemShape), docCount: z.number(),
  refRepos: z.array(refRepoShape), refRepoCount: z.number(),
});

const schema = z.strictObject({
  repo: repoShape.nullable(),
  group: groupShape.nullable(),
  refRepos: z.looseObject({ list: z.array(refRepoShape), count: z.number() }),
  groups: z.array(z.looseObject({ name: z.string(), desc: z.string(), path: z.string() })),
  // 可见 seed 变量（{{cwd}}），data() 不返回它
  cwd: z.string().optional(),
});

/** 「项目文档 / 组文档」→ 结构化数组（模板用 {{#each}} 组织行）。 */
// #216 合并远端 schema v12：ref 的「分类标签」tag 已整个退役，这里不再搬它。
function docItems(links: any) {
  return (links || []).map((d: any) => ({
    refId: d.refId || '',
    desc: d.desc || '',
    title: d.title || '',
    hasBody: d.hasBody !== false,
    note: d.note || '',
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
    note: r.note || '',
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
  const refRepoList: { key: string; name: string; path: string; note: string }[] = [];
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

export class ContextPlugin extends PromptPlugin<typeof schema> {
  readonly id = 'context';
  readonly order = 10;
  readonly tag = 'nx-kv.context';
  readonly label = '组 / 项目上下文';
  override readonly writes = ['repo', 'group', 'refRepos', 'groups'];
  readonly dataSchema = schema;

  constructor(template: string, private readonly deps: { groupCtx: unknown }) {
    super(template);
  }

  protected data() {
    return deliveryCtxOf(this.deps.groupCtx);
  }
}
