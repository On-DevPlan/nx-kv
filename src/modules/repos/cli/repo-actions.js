// repo.* CRUD / 文档集 / 扫描 / 打开 的 action 声明。
import * as service from '../service.js';
import * as remote from '../remote.js';
import { listRepoDocs, addRepoDoc, removeRepoDoc } from '../../docs/refs.js';
import { renderRepoList, renderRepo, lastSeg } from './render.js';

export const repoActions = [
  {
    id: 'repo.list',
    cli: ['repo', 'list'],
    http: ['GET', '/api/repos'],
    summary: '仓库清单（本地任务的主题会按路径匹配到这里，取它的上下文）',
    flags: {
      type: { type: 'string', enum: ['dev', 'ref'], hint: '只看某类：dev=开发仓库，ref=参考仓库' },
    },
    run: (ctx) => service.listRepos().then((list) => (ctx.type ? list.filter((r) => (r.type || 'dev') === ctx.type) : list)),
    render: renderRepoList,
  },
  {
    id: 'repo.get',
    cli: ['repo', 'get'],
    http: ['GET', '/api/repos/:id'],
    summary: '查看单个仓库的登记信息',
    args: ['id'],
    run: (ctx) => service.getRepo(ctx.id),
    render: renderRepo,
  },
  {
    id: 'repo.add',
    cli: ['repo', 'add'],
    http: ['POST', '/api/repos'],
    summary: '登记一个仓库',
    args: ['path'],
    flags: {
      name: { type: 'string' },
      icon: { type: 'string', hint: '项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）' },
      desc: { type: 'string', hint: '初始描述（写成项目主篇文档；之后描述以文档为准）' },
      notes: { type: 'string' },
      type: { type: 'string', enum: ['dev', 'ref'], hint: 'dev=开发仓库（默认），ref=参考仓库' },
      remote: { type: 'string', hint: '远程 git 地址（key 的来源；导出时导它）' },
      key: { type: 'string', hint: '全局唯一 key（必填：有 remote 可省略并按 host/owner/repo 归一化；无 remote 时必须给）' },
      'key-custom': { type: 'boolean', hint: '把 key 标记为自定义（显式给 --key 时默认就是自定义，不跟随 remote 变化）' },
    },
    run: (ctx) => service.addRepo({
      ...ctx,
      // 给了 --key 就视为自定义；否则用显式的 --key-custom（缺省 false = 跟随 remote）
      keyCustom: ctx.key ? true : ctx['key-custom'] === true,
    }),
    render: (r) => `已登记: ${r.name} -> ${r.path}（key: ${r.key}）`,
  },
  {
    // 登记前探测：面板填完路径就调它，把 git remote 自动填进「远程 git 地址」。
    // 只读；不登记、不改库。
    id: 'repo.detect',
    cli: ['repo', 'detect'],
    http: ['POST', '/api/repos/detect'],
    summary: '探测目录的 git remote（添加仓库前自动填充远程地址；只读）',
    args: ['path'],
    run: (ctx) => remote.detectRemote(ctx.path),
    render: (d) => {
      if (!d.exists) return `目录不存在: ${d.path}`;
      if (!d.isGit) return `不是 git 仓库: ${d.path}`;
      if (!d.recommended) return `git 仓库没有配置 remote: ${d.path}`;
      return [
        `远程地址: ${d.recommended}（key: ${d.key}）`,
        ...d.remotes.filter((x) => x.url !== d.recommended).map((x) => `  其它候选: ${x.name} ${x.url} [${x.kind}]`),
      ].join('\n');
    },
  },
  {
    id: 'repo.update',
    cli: ['repo', 'update'],
    http: ['PATCH', '/api/repos/:id'],
    summary:
      '修改仓库路径 / 名称 / 备注 / 类型 / 远程地址 / key；--get-loop* 配置项目级「持续 get」（waitgoal：该项目 get 无任务时阻塞等人回填 + 交付文本带继续 get 模板）。描述已改为文档，不再经这里改',
    args: ['id'],
    flags: {
      path: { type: 'string' },
      name: { type: 'string' },
      icon: { type: 'string', hint: '项目图标（emoji 或单字符，≤8 字；留空 = 用默认图标）' },
      desc: { type: 'string', hint: '（已废弃）描述是文档：改正文用 docs set，换绑用 docs bind —— 传了会报错' },
      notes: { type: 'string' },
      type: { type: 'string', enum: ['dev', 'ref'], hint: 'dev=开发仓库，ref=参考仓库' },
      remote: { type: 'string', hint: '远程 git 地址' },
      key: { type: 'string', hint: '自定义 key（给了就视为 keyCustom）' },
      'key-custom': { type: 'boolean', hint: 'key 是否自定义（true=不跟随 remote）' },
      'get-loop': { type: 'string', enum: ['on', 'off'], hint: '持续 get 开关' },
      'get-loop-minutes': { type: 'number', hint: '无任务时的阻塞窗口（分钟，默认 10，上限 600s 夹制）' },
      'get-loop-template': {
        type: 'string',
        hint: '领到任务时追加的「继续 get」模板——整体替换为这一条（多条在设置面板按条增删；占位符 {{task.id}}/{{task.text}} 等；置空 = 用默认模板）',
      },
    },
    run: (ctx) => {
      const patch = { ...ctx, keyCustom: ctx['key-custom'] === undefined ? undefined : ctx['key-custom'] === true };
      if (ctx['get-loop'] !== undefined || ctx['get-loop-minutes'] !== undefined || ctx['get-loop-template'] !== undefined) {
        patch.getLoop = {
          ...(ctx['get-loop'] !== undefined ? { enabled: ctx['get-loop'] === 'on' } : {}),
          ...(ctx['get-loop-minutes'] !== undefined ? { waitMinutes: ctx['get-loop-minutes'] } : {}),
          ...(ctx['get-loop-template'] !== undefined ? { template: ctx['get-loop-template'] } : {}),
        };
      }
      return service.updateRepo(ctx.id, patch);
    },
    render: (r) => `已更新: ${r.name}（key: ${r.key}）`,
  },
  {
    // 项目介绍文档集：主篇 + 多篇其余（自有树 / 外部路径 / 参考仓库内文件）
    id: 'repo.doc.list',
    cli: ['repo', 'doc', 'list'],
    http: ['GET', '/api/repos/docs'],
    summary: '列出项目的介绍文档集（主篇 + 其余各篇，含来源形态：自有树 / 外部 / ref 仓库）',
    args: ['id'],
    run: (ctx) => listRepoDocs(ctx.id),
    render: (d) => {
      const one = (x, i) => `  ${i}. ${x.rel ? '自有 ' + x.rel : x.ref ? 'ref  ' + x.ref + '/' + x.rel : '外部 ' + x.path}${x.tag ? `  [${x.tag}]` : ''}${x.note ? `  # ${x.note}` : ''}`;
      const lines = [`【${d.repo.name}】介绍文档 ${d.count} 篇`];
      // 描述是**列表**：主篇 + 介绍目录里的其余 + 登记的补充（#58）
      let n = 0;
      if (d.main) lines.push(one(d.main, ++n));
      for (const x of d.extras || []) lines.push(one(x, ++n));
      for (const x of d.links || []) lines.push(one(x, ++n));
      return lines.join('\n');
    },
  },
  {
    id: 'repo.doc.add',
    cli: ['repo', 'doc', 'add'],
    http: ['POST', '/api/repos/docs'],
    summary: '给项目加一篇介绍文档：--rel 自有树路径 / --path 外部绝对路径 / --ref <参考仓库key> --file <仓库内相对路径>（同 rel/path 重复添加 = 更新）',
    args: ['id'],
    flags: {
      rel: { type: 'string', hint: '自有树内相对路径（如 repo/github.com/me/x.md）' },
      path: { type: 'string', hint: '外部绝对路径（只读引用）' },
      ref: { type: 'string', hint: '参考仓库 key（type=ref 的本机仓库）' },
      file: { type: 'string', hint: '参考仓库内的相对路径（配合 --ref）' },
      note: { type: 'string', hint: '这篇的说明' },
      tag: { type: 'string', hint: '分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）' },
    },
    run: (ctx) => addRepoDoc(ctx.id, { rel: ctx.rel, path: ctx.path, ref: ctx.ref, file: ctx.file, note: ctx.note, tag: ctx.tag }),
    render: (d) => `已加一篇介绍文档（共 ${d.count} 篇）`,
  },
  {
    id: 'repo.doc.remove',
    cli: ['repo', 'doc', 'remove'],
    http: ['DELETE', '/api/repos/docs'],
    summary: '从项目的介绍文档集里摘掉一篇（--index 从 1 起，1 = 主篇）',
    args: ['id'],
    flags: { index: { type: 'number', required: true, hint: '序号（1 = 主篇）' } },
    run: (ctx) => removeRepoDoc(ctx.id, ctx.index),
    render: () => `已摘掉一篇介绍文档`,
  },
  {
    id: 'repo.remove',
    cli: ['repo', 'remove'],
    http: ['DELETE', '/api/repos/:id'],
    summary: '移除登记（不动磁盘文件）',
    args: ['id'],
    run: (ctx) => service.removeRepo(ctx.id),
    render: (r) => `已移除登记: ${r.name}（磁盘文件未动）`,
  },
  {
    id: 'repo.scan',
    cli: ['repo', 'scan'],
    http: ['POST', '/api/repos/scan'],
    summary: '扫描目录发现 git 仓库；--dry-run 只列出（发现模式，不登记）',
    // root 缺省当前目录：最常见的用法就是「看看我现在这个目录下面都有些什么仓库」
    args: [{ name: 'root', required: false }],
    flags: {
      depth: { type: 'number', default: 3 },
      'dry-run': { type: 'boolean', hint: '只列出发现的仓库，不登记' },
    },
    run: (ctx) => service.scanRepos(ctx.root || process.cwd(), ctx.depth, { dryRun: ctx['dry-run'] === true }),
    render: (d) => {
      const head = `${d.dryRun ? '发现（未登记）' : '扫描'} ${d.root}: ${d.scanned} 个 git 仓库`;
      if (!d.scanned) return `${head}\n（这个深度下没有找到）`;
      const lines = [head];
      for (const r of d.found) {
        lines.push(`  ${r.known ? '已登记' : '未登记'}  ${r.path}${r.name && r.name !== lastSeg(r.path) ? `  (${r.name})` : ''}`);
      }
      if (d.dryRun) {
        lines.push('', `确认要收进来的用: nx-kv repo add <path> --desc "一句话描述"`);
        lines.push('（`repo scan` 不带 --dry-run 会直接登记全部）');
      } else {
        lines.push('', `新登记 ${d.added.length} 个${d.skipped ? `，已在册 ${d.skipped} 个` : ''}`);
      }
      return lines.join('\n');
    },
  },
  {
    id: 'repo.open',
    cli: ['repo', 'open'],
    http: ['POST', '/api/repos/open'],
    summary: '在系统文件管理器中打开',
    args: ['id'],
    run: (ctx) => service.repoOpen(ctx.id),
    render: (d) => `已打开: ${d.opened}`,
  },
];
