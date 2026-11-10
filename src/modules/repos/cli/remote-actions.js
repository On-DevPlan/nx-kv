// key 与远程地址相关的 action：repo remote / key.* / remote.* / clone。
import * as service from '../service.js';
import * as keys from '../keys.js';
import * as remote from '../remote.js';
import { gitOrigin } from '../git.js';
import { badInput } from '../../../core/errors.js';

export const remoteActions = [
  // ---- 参考仓库（type=ref）：clone / 同步 / 检查 / 绑定 ----
  // git 边界的例外区：只有参考仓库允许 clone/pull/读 origin（git.js 是唯一出口）。
  // 克隆目标 = config.gitRepoRoot（未设置会显式报错，绝不默默落进用户目录）。
  {
    // 登记的远程地址存档 + 刷新 key：无 --url = 从目录 origin 读（顺便重算 key）。
    id: 'repo.remote',
    cli: ['repo', 'remote'],
    http: ['POST', '/api/repos/remote'],
    summary: '登记/更新仓库的远程 git 地址（无 --url = 从目录 origin 读取存档并重算 key）',
    args: ['id'],
    flags: {
      url: { type: 'string', hint: '远程地址；缺省时 git remote get-url origin' },
      refresh: { type: 'boolean', hint: '同时扫描全部 remote 并提示可更新的 key（同 repo key refresh）' },
    },
    run: async (ctx) => {
      if (ctx.refresh) return keys.refreshKeys({ id: ctx.id, apply: false });
      let url = String(ctx.url || '').trim();
      if (!url) {
        const r = await service.getRepo(ctx.id);
        url = await gitOrigin(r.path);
        if (!url) throw badInput(`「${r.name}」目录没有 origin，也未给 --url —— 请手工给一个`);
      }
      return service.updateRepo(ctx.id, { remote: url });
    },
    render: (r) => (r.items ? keys.renderRefresh(r) : `已登记远程地址: ${r.name} -> ${r.remote}（key: ${r.key}）`),
  },
  {
    // key 刷新：扫本地 git remote，给出建议（--all 全部；--apply 才落盘）
    id: 'repo.key.refresh',
    cli: ['repo', 'key', 'refresh'],
    http: ['POST', '/api/repos/key/refresh'],
    summary: '刷新仓库 key：扫描 git remote（SSH 优先），提示可更新的 key/远程地址；--apply 落盘',
    args: [{ name: 'id', required: false }],
    flags: {
      all: { type: 'boolean', hint: '刷新全部仓库' },
      apply: { type: 'boolean', hint: '把建议写回（自定义 key 只更新 remote，不覆盖 key）' },
    },
    run: (ctx) => keys.refreshKeys({ id: ctx.id, all: ctx.all === true, apply: ctx.apply === true }),
    render: (d) => keys.renderRefresh(d),
  },
  {
    // 手工设 key：自定义身份（不跟随 remote）
    id: 'repo.key.set',
    cli: ['repo', 'key', 'set'],
    http: ['POST', '/api/repos/key'],
    summary: '设置自定义 key（全局唯一，不跟随远程地址自动变）；--follow 恢复为跟随 remote',
    args: ['id', { name: 'key', required: false }],
    flags: {
      follow: { type: 'boolean', hint: '取消自定义：key 重新跟随远程地址派生' },
    },
    run: async (ctx) => {
      if (ctx.follow) {
        await service.updateRepo(ctx.id, { keyCustom: false, key: '' });
      } else {
        if (!ctx.key) throw badInput('请给自定义 key，或 --follow 恢复跟随远程地址');
        await service.updateRepo(ctx.id, { key: ctx.key, keyCustom: true });
      }
      return service.getRepo(ctx.id);
    },
    render: (r) => `已设 key: ${r.name} -> ${r.key}${r.keyCustom ? '（自定义）' : '（跟随远程地址）'}`,
  },
  {
    // 关系迁移：随机 id → key（一次性、幂等）
    id: 'repo.key.migrate',
    cli: ['repo', 'key', 'migrate'],
    http: ['POST', '/api/repos/key/migrate'],
    summary: '把内部关系（看板成员/绑定）从随机 id 改写成 key（幂等；--apply 落盘）',
    flags: { apply: { type: 'boolean', hint: '写回磁盘（缺省只预览）' } },
    run: (ctx) => keys.migrateRelations({ apply: ctx.apply === true }),
    render: (d) => keys.renderMigrate(d),
  },

  // ---- remote 对齐：remote 才是协作的标准单位 ----
  // key 是本地身份，remote 是别人 clone 用的地址。自动的「SSH 优先」只是默认值，
  // 对齐的方向由人定 —— 所以给「列出候选 / 人工挑选 / 存在性检查」三件套。
  {
    id: 'repo.remote.list',
    cli: ['repo', 'remote', 'list'],
    http: ['GET', '/api/repos/remote/list'],
    summary: '列出仓库的全部 remote 候选（git remote -v），标出当前采纳的那条',
    // id 走 query（面板）或位置参数（CLI）都认
    args: [{ name: 'id', required: false }],
    run: (ctx) => remote.listRemotes(ctx.id),
    render: (d) => {
      const lines = [`「${d.name}」的 remote（当前采纳: ${d.current || '（无）'}）`];
      for (const r of d.remotes) {
        lines.push(`  ${r.current ? '●' : '○'} ${r.name.padEnd(10)} ${r.url}  [${r.kind}] → key ${r.derivedKey}`);
      }
      if (!d.remotes.length) lines.push('  （没有 remote —— 先 git remote add）');
      return lines.join('\n');
    },
  },
  {
    id: 'repo.remote.pick',
    cli: ['repo', 'remote', 'pick'],
    http: ['POST', '/api/repos/remote/pick'],
    summary: '人工指定采纳哪条 remote（key 随之重算；自定义 key 不动）',
    args: ['id', 'url'],
    run: (ctx) => remote.pickRemote(ctx.id, ctx.url),
    render: (d) => `已对齐 remote: ${d.key} → ${d.remote}${d.keyCustom ? '（自定义 key 不变）' : ''}`,
  },
  {
    id: 'repo.remote.check',
    cli: ['repo', 'remote', 'check'],
    http: ['GET', '/api/repos/remote/check'],
    summary: '检查 remote 是否存在（git ls-remote：存在 / 不存在 / 不可达，三种结论分清）',
    args: [{ name: 'id', required: false }],
    flags: { url: { type: 'string', hint: '要检查的地址；缺省 = 当前采纳的 remote' } },
    run: (ctx) => remote.checkRemote(ctx.id, ctx.url),
    render: (d) => {
      const mark = { exists: '✓ 存在', missing: '✗ 不存在', unreachable: '? 不可达' }[d.status] || d.status;
      return `${mark}  ${d.url} —— ${d.detail}`;
    },
  },
  {
    // clone 补齐：导入留下的「本地未拥有」占位，按 remote 克隆并用**占位的 key**登记，
    // 组里的位置自动转正。
    id: 'repo.clone',
    cli: ['repo', 'clone'],
    http: ['POST', '/api/repos/clone'],
    summary: '按 remote 克隆并登记（--key 指定占位 key → 组里位置自动补齐）',
    args: ['remote'],
    flags: {
      key: { type: 'string', hint: '登记时用的 key（补占位时填它）' },
      name: { type: 'string' },
      desc: { type: 'string' },
      type: { type: 'string', enum: ['dev', 'ref'], default: 'dev', hint: 'dev 落 gitDevRoot，ref 落 gitRepoRoot' },
      depth: { type: 'number', default: 1, hint: '浅克隆深度' },
    },
    run: (ctx) => remote.cloneRepo(ctx),
    render: (d) => `已克隆并登记: ${d.name}（key ${d.key}）→ ${d.path}`,
  },
];
