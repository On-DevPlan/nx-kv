// 布局导入导出与队列绑定的 action：export / import.diff / import / bind-topics。
import * as transfer from '../transfer.js';
import * as service from '../service.js';
import { readLayout } from './render.js';

export const transferActions = [
  // ---- 布局导入导出（v2）：remote 为 key，不带本地路径 ----
  {
    id: 'repo.export',
    cli: ['repo', 'export'],
    http: ['GET', '/api/repos/export'],
    summary: '导出仓库布局 JSON（全局 key + 分组 + 参考关系；不含本地路径）；--zip 打包成 zip',
    flags: {
      zip: { type: 'string', hint: '打包成 zip 写到这个路径（含 layout.json + README）' },
      repos: { type: 'array', hint: '只导出这些仓库 key（逗号分隔；空 = 全部）' },
      boards: { type: 'array', hint: '只导出这些看板 key（逗号分隔；空 = 全部）' },
      'no-unassigned': { type: 'boolean', hint: '不带未分组的仓库' },
    },
    run: async (ctx) => {
      const opts = {
        repoKeys: ctx.repos,
        boardKeys: ctx.boards,
        includeUnassigned: ctx['no-unassigned'] !== true,
      };
      if (ctx.zip) return transfer.writeExportZip(ctx.zip, opts);
      return transfer.repoExport(opts);
    },
    render: (d) => (d && d.file
      ? `已导出 zip: ${d.file}（${d.bytes} 字节）\n包含 layout.json + README.txt + docs/（自有文档树），可回灌 repo import`
      : JSON.stringify(d, null, 2)),
  },
  {
    // --diff：只算差异不执行（面板先展示的就是这份数据）
    id: 'repo.import.diff',
    cli: ['repo', 'import', '--diff'],
    http: ['POST', '/api/repos/import/diff'],
    summary: '导入前的差异检查：逐条给出 新增/有差异/一致/本地未拥有（零副作用）',
    // 与 repo import 同款双入口：CLI 给文件路径，面板直接 POST {json}。
    // CLI 上 --diff 是路径 token 的一部分（最长匹配），不是 flag。
    args: [{ name: 'file', required: false }],
    flags: { json: { type: 'string', hint: '（面板）直接给布局 JSON' } },
    run: async (ctx) => {
      const { json, docsFiles } = await readLayout(ctx);
      return transfer.diffImport(json, docsFiles);
    },
    render: (d) => transfer.renderDiff(d),
  },
  {
    id: 'repo.import',
    cli: ['repo', 'import'],
    http: ['POST', '/api/repos/import'],
    summary: '导入仓库布局（--strategy ours|overwrite|duplicate；--select 按 key 挑；--clone 选克隆范围）',
    args: [{ name: 'file', required: false }],
    flags: {
      json: { type: 'string', hint: '（面板）直接给布局 JSON' },
      strategy: {
        type: 'string',
        enum: ['ours', 'overwrite', 'duplicate'],
        default: 'ours',
        hint: '冲突方案：保留本地 / 覆盖 / 另存 key-import-N',
      },
      select: { type: 'array', hint: '只处理这些仓库 key（逗号分隔；空 = 全部）' },
      boards: { type: 'array', hint: '只处理这些看板 key（逗号分隔；空 = 全部）' },
      clone: { type: 'string', enum: ['all', 'dev', 'ref', 'none'], hint: '要克隆哪些（默认 none = 只登记）' },
    },
    run: async (ctx) => {
      const { json, docsFiles } = await readLayout(ctx);
      return transfer.repoImport({
        json,
        docsFiles,
        selection: ctx.select,
        boardSelection: ctx.boards,
        strategy: ctx.strategy || 'ours',
        clone: ctx.clone || 'none',
      });
    },
    render: (d) => transfer.renderResult(d),
  },

  // ---- 队列绑定（T05）：哨兵上的「未绑定」队列按路径前缀挂到真实仓库 ----
  {
    id: 'repo.bind-topics',
    cli: ['repo', 'bind-topics'],
    http: ['POST', '/api/repos/bind-topics'],
    summary: '把「未绑定」队列按路径前缀绑到真实仓库（先建 refs 再绑；默认预览，--apply 落盘）',
    flags: {
      repo: { type: 'string', hint: '仓库 id / key / 路径 / 名称（缺省 = 全部登记仓库）' },
      apply: { type: 'boolean', hint: '真正落盘（省略 = 只预览命中计划）' },
    },
    run: (ctx) => service.bindTopicsToRepos({ repo: ctx.repo, apply: !!ctx.apply }),
    render: (d) => {
      const lines = [
        `${d.apply ? '已绑定' : '绑定预览（未落盘）'}: 扫描 ${d.scanned} 条未绑定队列，命中 ${d.bound.length} 条`,
      ];
      for (const b of d.bound) lines.push(`  ${b.topicKey}  ${b.cwd || b.name} → ${b.repoName}（${b.repoKey}）`);
      if (d.left.length) {
        lines.push(`留在哨兵（对不上任何仓库路径）: ${d.left.length} 条`);
        for (const t of d.left.slice(0, 10)) lines.push(`  ${t.topicKey}  ${t.cwd || '(全局池)'}`);
      }
      if (d.refs) lines.push(`refs 索引: 新增 ${d.refs.refs} / 约定绑定 ${d.refs.bindings}`);
      if (!d.apply && d.bound.length) lines.push('', '落盘: nx-kv repo bind-topics --apply');
      return lines.join('\n');
    },
  },
];
