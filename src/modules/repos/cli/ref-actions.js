// 参考仓库（type=ref）与绑定关系的 action：ref.* / bind / note / of / knowledge。
import * as ref from '../ref.js';
import { repoKnowledge } from '../../docs/knowledge.js';
import { renderClone, renderRefSync, renderRefCheck, renderBind, renderRefsOf } from './render.js';

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
    summary: '检查参考仓库完整性：目录/.git/origin 一致性 + 绑定死链（零副作用）',
    run: () => ref.checkRefs(),
    render: renderRefCheck,
  },
  {
    id: 'repo.bind',
    cli: ['repo', 'bind'],
    http: ['POST', '/api/repos/bind'],
    summary: '绑定参考仓库到开发仓库/看板（多对多；--remove 摘除；目标可多个，逗号分隔）',
    args: ['id'],
    flags: {
      repo: { type: 'array', hint: '绑定的开发仓库（id/路径/名称，逗号分隔）' },
      board: { type: 'array', hint: '绑定的看板 id（逗号分隔）' },
      remove: { type: 'boolean', hint: '摘除：带 --repo/--board 摘指定目标，都不带 = 清空全部绑定' },
    },
    run: (ctx) => ref.bindTarget(ctx),
    render: renderBind,
  },
  {
    // 绑定描述：同一条绑定在「本仓库参考什么」与「这个组参考什么」两个语境里
    // 意义可以不同，描述挂在**绑定关系**上（与看板组内描述 board.note 同一哲学）。
    id: 'repo.ref.note',
    cli: ['repo', 'ref', 'note'],
    http: ['POST', '/api/repos/ref/note'],
    summary: '写/清绑定描述：这个参考在该仓库/看板里参考什么（--note 留空 = 清除）',
    args: ['id'],
    flags: {
      repo: { type: 'string', hint: '开发仓库（id/路径/名称；与 --board 二选一）' },
      board: { type: 'string', hint: '看板 id（与 --repo 二选一）' },
      note: { type: 'string', hint: '绑定描述（多行可含关键路径/关键词；留空 = 清除）' },
    },
    run: (ctx) => ref.setLinkNote(ctx),
    render: (d) => (d.note
      ? `已写绑定描述: ${d.name} @ ${d.kind === 'board' ? '看板 ' : '仓库 '}${d.target}`
      : `已清除绑定描述: ${d.name} @ ${d.kind === 'board' ? '看板 ' : '仓库 '}${d.target}`),
  },
  {
    // 分层查询：问「这个目录/仓库有什么参考」时，第一层是它直接绑定的，
    // 第二层是它所在的看板（命名空间）上的——组级参考沿看板继承下来。
    id: 'repo.ref.of',
    cli: ['repo', 'ref', 'of'],
    http: ['GET', '/api/repos/ref/of'],
    summary: '查某仓库（缺省当前目录）的参考仓库：第一层直接绑定，第二层按看板分组（命名空间）',
    args: [{ name: 'id', required: false }],
    run: (ctx) => ref.refsForRepo(ctx.id || process.cwd()),
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
      if (d.refs.length) {
        lines.push('  参考仓库:');
        for (const r of d.refs) lines.push(`    ${r.name}${r.remote ? `（${r.remote}）` : ''}${r.note ? ` —— ${r.note.split('\n')[0]}` : ''}`);
      }
      for (const w of d.warnings) lines.push(`⚠ ${w}`);
      return lines.join('\n');
    },
  },
];
