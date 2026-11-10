// 参考仓库（type=ref）与绑定关系的 action：ref.* / bind / note / of / knowledge。
import * as ref from '../ref.js';
import * as refBackfill from '../ref-backfill.js';
import { repoKnowledge } from '../../docs/knowledge.js';
import { renderClone, renderRefSync, renderRefCheck, renderBind, renderRefsOf, renderBackfill } from './render.js';

export const refActions = [
  {
    id: 'repo.ref.clone',
    cli: ['repo', 'ref', 'clone'],
    http: ['POST', '/api/repos/ref/clone'],
    summary: '克隆远程仓库为参考仓库（落到 gitRepoRoot，登记 + 可选绑定当前目录的开发仓库）',
    args: ['url'],
    flags: {
      name: { type: 'string', hint: '名称（缺省取 URL 末段）' },
      desc: { type: 'string', hint: '一句话描述（它参考什么）' },
      notes: { type: 'string' },
      board: { type: 'array', hint: '顺手挂到看板（id 可多个，逗号分隔）' },
      bind: { type: 'array', hint: '绑定的开发仓库（id/路径/名称，可多个，逗号分隔）' },
      depth: { type: 'number', default: 1, hint: '浅克隆深度（默认 1）' },
      'no-bind': { type: 'boolean', hint: '关闭自动绑定（默认绑当前目录命中的开发仓库）' },
    },
    run: (ctx) =>
      ref.cloneRef({
        url: ctx.url,
        name: ctx.name,
        desc: ctx.desc,
        notes: ctx.notes,
        board: ctx.board,
        bind: ctx.bind,
        depth: ctx.depth,
        noBind: ctx['no-bind'] === true,
      }),
    render: renderClone,
  },
  {
    id: 'repo.ref.add',
    cli: ['repo', 'ref', 'add'],
    http: ['POST', '/api/repos/ref/add'],
    summary: '把一个已存在的 checkout 登记为参考仓库（不 clone；remote 缺省读 origin）',
    args: ['path'],
    flags: {
      remote: { type: 'string', hint: '远程地址（目录没有 origin 时必给）' },
      name: { type: 'string' },
      desc: { type: 'string' },
      notes: { type: 'string' },
    },
    run: (ctx) => ref.registerRef(ctx),
    render: (r) => `已登记参考仓库: ${r.name} -> ${r.path}`,
  },
  {
    id: 'repo.ref.sync',
    cli: ['repo', 'ref', 'sync'],
    http: ['POST', '/api/repos/ref/sync'],
    summary: '同步参考仓库（git pull --ff-only；--all 同步全部）',
    args: [{ name: 'id', required: false }],
    flags: {
      all: { type: 'boolean', hint: '同步全部参考仓库' },
    },
    run: (ctx) => (ctx.all ? ref.syncAllRefs() : ref.syncRef(ctx.id)),
    render: (d) => (d.results ? renderRefSync(d) : `已同步: ${d.name}（${d.status}${d.output ? ' — ' + d.output.split('\n')[0] : ''}）`),
  },
  {
    id: 'repo.ref.check',
    cli: ['repo', 'ref', 'check'],
    http: ['GET', '/api/repos/ref/check'],
    summary: '检查参考仓库完整性：目录/.git/origin 一致性 + 组级/仓库级绑定死链（零副作用）',
    run: () => ref.checkRefs(),
    render: renderRefCheck,
  },
  {
    // 一次性数据补录工具（不是迁移）：v4 迁移清掉的仓库级绑定，按 v3 快照恢复。
    // 幂等、可预演；只写 dev.ext.ext_linked，不碰 group_refs。
    id: 'repo.ref.backfill',
    cli: ['repo', 'ref', 'backfill'],
    http: null,
    summary: '从 v3 快照补录仓库级参考绑定（幂等、可重复；与组级绑定并存；--dry-run 只预览）',
    args: [{ name: 'from', required: true }],
    flags: {
      'dry-run': { type: 'boolean', hint: '只算差异，不落盘' },
    },
    run: (ctx) => refBackfill.backfillRepoLinks({ from: ctx.from, dryRun: ctx['dry-run'] === true }),
    render: renderBackfill,
  },
  {
    id: 'repo.bind',
    cli: ['repo', 'bind'],
    http: ['POST', '/api/repos/bind'],
    summary: '绑定参考仓库到组或单个开发仓库（两类并存；--board 组级、--repo 仓库级；--remove 摘除）',
    args: ['id'],
    flags: {
      repo: { type: 'array', hint: '开发仓库（id/路径/名称，逗号分隔）—— 写仓库级绑定（不折算成组）' },
      board: { type: 'array', hint: '组 id/key/名称（逗号分隔）—— 写组级绑定（组内共享）' },
      remove: { type: 'boolean', hint: '摘除：带 --repo/--board 摘指定维度，都不带 = 组 + 仓库全部摘除' },
    },
    run: (ctx) => ref.bindTarget(ctx),
    render: renderBind,
  },
  {
    // 绑定描述：描述挂在**组 ↔ 参考仓库**或**仓库 ↔ 参考仓库**这条关系上。
    id: 'repo.ref.note',
    cli: ['repo', 'ref', 'note'],
    http: ['POST', '/api/repos/ref/note'],
    summary: '写/清绑定描述：这个参考在该组/该仓库里参考什么（--note 留空 = 清除）',
    args: ['id'],
    flags: {
      repo: { type: 'string', hint: '开发仓库（id/路径/名称）—— 写仓库级绑定的描述' },
      board: { type: 'string', hint: '组 id/key/名称（与 --repo 二选一）—— 写组级绑定的描述' },
      note: { type: 'string', hint: '绑定描述（多行可含关键路径/关键词；留空 = 清除）' },
    },
    run: (ctx) => ref.setLinkNote(ctx),
    render: (d) => `${d.note ? '已写' : '已清除'}绑定描述: ${d.name} @ ${d.group ? `组「${d.group}」` : `仓库「${d.repo}」`}`,
  },
  {
    // 按仓库查参考：仓库级直接绑定 + 所属组的组级绑定，两类并列给出。
    id: 'repo.ref.of',
    cli: ['repo', 'ref', 'of'],
    http: ['GET', '/api/repos/ref/of'],
    summary: '查某仓库（缺省当前目录）的参考仓库：直接绑定到本仓库的 + 所属组绑定的，两类并列',
    args: [{ name: 'id', required: false }],
    run: (ctx) => ref.refReposOfRepo(ctx.id || process.cwd()),
    render: renderRefsOf,
  },
  {
    // 复合知识查询：get 封装的供料口。agent 领到某个仓库的任务后，
    // 一条命令拿到 项目介绍 + 所属组介绍 + 组内描述 + 组绑定文档 + 参考仓库，
    // 文档路径都是磁盘真实路径——拿到的就是可读的，不用再查第二遍。
    id: 'repo.knowledge',
    cli: ['repo', 'knowledge'],
    http: ['GET', '/api/repos/knowledge'],
    summary: '取仓库完整知识：项目介绍 + 所属组（介绍/组内描述/绑定文档）+ 参考仓库（--md 拼成单篇 markdown；缺省当前目录）',
    args: [{ name: 'id', required: false }],
    flags: {
      md: { type: 'boolean', hint: '输出拼装好的单篇 markdown（字段名 md），get 封装直接可用' },
    },
    run: (ctx) => repoKnowledge(ctx.id || process.cwd(), { md: ctx.md === true }),
    render: (d) => {
      if (d.md) return d.md;
      const lines = [`【${d.repo.name}】${d.repo.key}${d.repo.desc ? `  —— ${d.repo.desc}` : ''}`];
      if (d.intro && !d.intro.missing) lines.push(`  介绍: ${d.intro.docId}${d.intro.title ? `「${d.intro.title}」` : ''}`);
      else lines.push('  介绍:（还没有文档——desc 会在首次读取时播种为 md）');
      for (const b of d.boards) {
        lines.push(`  ◇ 组「${b.name}」`);
        if (b.intro && !b.intro.missing) lines.push(`    组介绍: ${b.intro.docId}`);
        if (b.note && !b.note.missing) lines.push(`    组内描述: ${b.note.docId}`);
        for (const l of b.docLinks) lines.push(`    绑定: ${l.docId}${l.tag ? `  [${l.tag}]` : ''}${l.note ? `  · ${l.note}` : ''}${l.missing ? '（缺失）' : ''}`);
        for (const x of b.externalDirs) lines.push(`    外部目录: ${x.path}（${x.files.length} 个文档，按需读盘）`);
      }
      if (d.refRepos.length) {
        lines.push('  参考仓库:');
        for (const r of d.refRepos) lines.push(`    ${r.name}${r.remote ? `（${r.remote}）` : ''}${r.note ? ` —— ${r.note.split('\n')[0]}` : ''}`);
      }
      for (const w of d.warnings) lines.push(`⚠ ${w}`);
      return lines.join('\n');
    },
  },
];
