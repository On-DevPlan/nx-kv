// 仓库上下文模块：action 声明是 CLI 命令、HTTP 路由、help 文案的唯一来源。
// 加一条操作 = 在 actions 里加一项，三端同时获得它。
//
// **来历**：这套命令原本长在 nx-rh（`src/modules/repos/`），2026-10-23 整体迁到 nx-kv
// （远程清单 topic=goal 的 #72）。迁过来的理由：仓库登记是本机事实，而它的价值在于
// 给「本地任务管理」当上下文——所以它该跟着任务走。
//
// 本模块只管**登记**：路径、名称、描述、备注。
// git 边界（2026-10-27 随参考仓库一并声明）：开发仓库（type=dev）的 git 状态 / diff /
// pull / push 一律不做——git 客户端是无底洞，面板里做不出比 IDE 更好的体验。
// 参考仓库（type=ref）例外，只做 clone / sync / check 三件事（见 ref.* 命令族）——
// 它的价值就是「把远程仓库抓到本机参考并保持新鲜」，不做这个它就没存在意义。
import * as service from './service.js';
import * as boards from './boards.js';
import * as ref from './ref.js';
import * as keys from './keys.js';
import * as transfer from './transfer.js';
import { gitOrigin } from './git.js';
import { badInput } from '../../core/errors.js';

// ---- 看板的 CLI 人读渲染 ----
// 用户要的「快速判断看板里的 repo 和 desc」：按主题分组，一行 = 仓库名 + 一句话描述。
function renderBoardList(d) {
  const lines = [];
  for (const b of d.boards) {
    lines.push(`【${b.name}】${b.repos.length} 个仓库${b.desc ? ` —— ${b.desc}` : ''}`);
    for (const r of b.repos) lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}`);
  }
  if (d.unassigned.length) {
    lines.push('【未分组】');
    for (const r of d.unassigned) lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}`);
  }
  if (!lines.length) return '（还没有看板与仓库，用 board add <名称> 建主题、repo add 登记仓库）';
  return lines.join('\n');
}

function renderBoard(b) {
  const lines = [`【${b.name}】${b.desc || ''} —— ${b.repos.length} 个仓库`];
  for (const r of b.repos) lines.push(`  ${r.name.padEnd(18)} ${r.desc || '-'}`);
  return lines.join('\n');
}

const lastSeg = (p) => String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).slice(-1)[0] || '';

// import / import --diff 两个 action 共用的取 JSON 逻辑：
// CLI 给文件路径（- = stdin），面板直接 POST {json}。两条入口同一个 action 声明。
async function readLayoutJson(ctx) {
  let json = typeof ctx.json === 'string' ? ctx.json : '';
  if (!json && ctx.file) {
    const { readFileSync } = await import('node:fs');
    json = readFileSync(ctx.file === '-' ? 0 : ctx.file, 'utf8');
  }
  if (!json) throw badInput('请给布局 JSON 文件路径（- 读 stdin），或在面板里粘贴 JSON');
  return json;
}

// ---- CLI 人读渲染（Web 端拿 JSON，用不到这些） ----

function renderRepoList(list) {
  if (!list.length) return '（暂无仓库，用 repo add <path> 登记）';
  const lines = [`共 ${list.length} 个仓库`];
  for (const r of list) {
    const tag = r.type === 'ref' ? ' [参考]' : '';
    lines.push(`${r.name.padEnd(18)} ${r.key}${tag}`);
    lines.push(`  ${' '.repeat(16)} ${r.path}`);
  }
  return lines.join('\n');
}

function renderRepo(r) {
  const lines = [
    `${r.name}${r.type === 'ref' ? '  [参考]' : ''}${r.desc ? '  ' + r.desc : ''}`,
    `  id:    ${r.id}`,
    `  key:   ${r.key}${r.keyCustom ? '（自定义）' : ''}`,
    `  路径:  ${r.path}`,
  ];
  if (r.remote) lines.push(`  远程:  ${r.remote}`);
  if (r.remotes?.length > 1) lines.push(`  全部远程: ${r.remotes.join(' , ')}`);
  lines.push(
    `  登记:  ${(r.addedAt || '').slice(0, 10)}`,
    `  更新:  ${(r.updatedAt || '').slice(0, 10)}`
  );
  if (r.boards?.length) {
    lines.push(`  看板:  ${r.boards.map((b) => b.name).join('、')}`);
  }
  if (r.notes) lines.push('  备注:  ' + r.notes);
  return lines.join('\n');
}

// ---- 参考仓库的人读渲染 ----

function renderClone(r) {
  const lines = [`已克隆并登记参考仓库: ${r.name}`, `  目录: ${r.dest || r.path}`, `  远程: ${r.url || r.remote}`];
  if (r.linked?.length) {
    lines.push(`  绑定: ${r.linked.map((l) => (l.kind === 'board' ? `看板 ${l.id}` : `仓库 ${l.id}`)).join('、')}`);
  }
  return lines.join('\n');
}

function renderRefSync(d) {
  const word = { updated: '已更新', upToDate: '已是最新', conflict: '冲突（需人工处理，不自动 merge）', missing: '目录缺失', error: '失败' };
  const lines = [`同步 ${d.synced} 个参考仓库:`];
  for (const r of d.results) {
    lines.push(`  ${word[r.status] || r.status}  ${r.name}${r.output && r.status !== 'upToDate' ? '  — ' + r.output.split('\n')[0] : ''}`);
  }
  if (!d.synced) lines.push('（还没有参考仓库，用 repo ref clone <url>）');
  return lines.join('\n');
}

function renderRefCheck(d) {
  if (!d.total) return '（还没有参考仓库 —— clone 一个: repo ref clone <url>）';
  const lines = [`检查 ${d.total} 个参考仓库${d.problems ? `，${d.problems} 个有问题` : '，全部正常'}:`];
  for (const r of d.refs) {
    lines.push(`  ${r.ok ? '✓' : '✗'}  ${r.name}  ${r.remote || '(无远程地址)'}`);
    for (const i of r.issues) lines.push(`      ${i}`);
  }
  return lines.join('\n');
}

function renderBind(d) {
  return d.removed
    ? `已摘除绑定: ${d.name}（${d.count} 条；剩 ${d.linked.length} 条）`
    : `已绑定 ${d.name} → ${d.added.length ? d.added.join('、') : '（已存在）'}（共 ${d.linked.length} 条绑定）`;
}

// 分层查询的人读渲染：第一层自己的参考，第二层按看板命名空间分组。
function renderRefsOf(d) {
  const line = (r) => `  ${r.name}${r.note ? `  （${r.note.split('\n')[0]}）` : ''}  ${r.remote || ''}`;
  const out = [`【${d.repo.name}】${d.repo.path}`];
  if (d.direct.length) {
    out.push('  本仓库直接绑定:');
    for (const r of d.direct) out.push(line(r));
  } else {
    out.push('  本仓库直接绑定:（无）');
  }
  if (d.boards.length) {
    for (const b of d.boards) {
      out.push(`  ◇ 看板「${b.name}」${b.desc ? ` —— ${b.desc.split('\n')[0]}` : ''}`);
      if (b.refs.length) for (const r of b.refs) out.push(line(r));
      else out.push('    （该组暂无绑定的参考仓库）');
    }
  } else {
    out.push('  （该仓库不属于任何看板 —— 没有组级参考可继承）');
  }
  return out.join('\n');
}

export default {
  id: 'repos',
  title: '仓库上下文（= Web「仓库」页；本地任务的主题会带上这里的上下文）',
  order: 10,
  view: () => import('./view.jsx'),

  // CRUD 完备性声明：本模块管理的是一组「仓库」实体，因此必须齐备五个操作，
  // 且每个都要能从 CLI 与 HTTP 两端调用。
  //   增 repo.add    查(列表) repo.list   查(单条) repo.get
  //   改 repo.update 删 repo.remove
  // tests/unit/registry.test.mjs 据此断言——漏一个、或某个操作缺了某端，直接测试失败。
  resource: 'repo',

  actions: [
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
        desc: { type: 'string' },
        notes: { type: 'string' },
        type: { type: 'string', enum: ['dev', 'ref'], hint: 'dev=开发仓库（默认），ref=参考仓库' },
        remote: { type: 'string', hint: '远程 git 地址（key 的来源；导出时导它）' },
        key: { type: 'string', hint: '自定义全局唯一 key（缺省按 remote/名字派生）' },
        'key-custom': { type: 'boolean', hint: '把 key 标记为自定义（不跟随 remote 变化）' },
      },
      run: (ctx) => service.addRepo({
        ...ctx,
        // 给了 --key 就视为自定义；否则用显式的 --key-custom（缺省 false = 跟随 remote）
        keyCustom: ctx.key ? true : ctx['key-custom'] === true,
      }),
      render: (r) => `已登记: ${r.name} -> ${r.path}（key: ${r.key}）`,
    },
    {
      id: 'repo.update',
      cli: ['repo', 'update'],
      http: ['PATCH', '/api/repos/:id'],
      summary: '修改仓库路径 / 名称 / 描述 / 备注 / 类型 / 远程地址 / key',
      args: ['id'],
      flags: {
        path: { type: 'string' },
        name: { type: 'string' },
        desc: { type: 'string' },
        notes: { type: 'string' },
        type: { type: 'string', enum: ['dev', 'ref'], hint: 'dev=开发仓库，ref=参考仓库' },
        remote: { type: 'string', hint: '远程 git 地址' },
        key: { type: 'string', hint: '自定义 key（给了就视为 keyCustom）' },
        'key-custom': { type: 'boolean', hint: 'key 是否自定义（true=不跟随 remote）' },
      },
      run: (ctx) => service.updateRepo(ctx.id, { ...ctx, keyCustom: ctx['key-custom'] === undefined ? undefined : ctx['key-custom'] === true }),
      render: (r) => `已更新: ${r.name}（key: ${r.key}）`,
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
        ? `已导出 zip: ${d.file}（${d.bytes} 字节）\n包含 layout.json + README.txt，可回灌 repo import`
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
      run: async (ctx) => transfer.diffImport(await readLayoutJson(ctx)),
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
      run: async (ctx) => transfer.repoImport({
        json: await readLayoutJson(ctx),
        selection: ctx.select,
        boardSelection: ctx.boards,
        strategy: ctx.strategy || 'ours',
        clone: ctx.clone || 'none',
      }),
      render: (d) => transfer.renderResult(d),
    },

    // ---- 看板（主题容器）：多项目编排层，面板与 CLI 同源 ----
    {
      id: 'board.list',
      cli: ['board', 'list'],
      http: ['GET', '/api/boards'],
      summary: '看板清单：每个主题里有哪些仓库、各自的一句话描述',
      run: () => boards.listBoards(),
      render: renderBoardList,
    },
    {
      id: 'board.get',
      cli: ['board', 'get'],
      http: ['GET', '/api/boards/:id'],
      summary: '查看单个看板（含成员仓库与描述）',
      args: ['id'],
      run: (ctx) => boards.getBoard(ctx.id),
      render: renderBoard,
    },
    {
      id: 'board.add',
      cli: ['board', 'add'],
      http: ['POST', '/api/boards'],
      summary: '新建看板（主题容器）',
      args: ['name'],
      flags: { desc: { type: 'string' } },
      run: (ctx) => boards.createBoard(ctx),
      render: (b) => `已新建看板: ${b.name}`,
    },
    {
      id: 'board.update',
      cli: ['board', 'update'],
      http: ['PATCH', '/api/boards/:id'],
      summary: '改看板名称 / 描述',
      args: ['id'],
      flags: {
        name: { type: 'string' },
        desc: { type: 'string' },
      },
      run: (ctx) => boards.updateBoard(ctx.id, ctx),
      render: (b) => `已更新看板: ${b.name}`,
    },
    {
      id: 'board.remove',
      cli: ['board', 'remove'],
      http: ['DELETE', '/api/boards/:id'],
      summary: '删看板（里面的仓库回到未分组，登记不动）',
      args: ['id'],
      run: (ctx) => boards.removeBoard(ctx.id),
      render: (d) => `已删除看板: ${d.removed}（${d.released} 个仓库回到未分组）`,
    },
    {
      id: 'board.assign',
      cli: ['board', 'assign'],
      http: ['POST', '/api/boards/assign'],
      summary: '把仓库聚合进看板（可同时在多个看板；--remove 移出；--before 插位）',
      args: ['id'],
      flags: {
        board: { type: 'string', hint: '目标看板 id' },
        before: { type: 'string', hint: '插到这张卡片之前' },
        remove: { type: 'boolean', hint: '移出：带 --board 从该板移出，不带则从所有看板移出' },
      },
      run: (ctx) => boards.assignRepo(ctx),
      render: (d) => (d.removed
        ? `已移出: ${d.name}（${d.count} 个看板）`
        : `${d.added ? '已聚合' : '已在（位次已调）'}: ${d.name} → ${d.board}`),
    },
    {
      // 组内描述：同一个仓库在不同看板里的角色各不相同，描述挂在成员关系上而非登记上。
      // 登记的 desc = 「这个仓库是干什么的」；组内描述 = 「它在这个组里占什么位置、怎么配合」。
      id: 'board.note',
      cli: ['board', 'note'],
      http: ['POST', '/api/boards/note'],
      summary: '写/清组内描述：仓库在看板里的角色与配合关系（--note 留空 = 清除；仓库给 id 或绝对路径）',
      args: ['id'],
      flags: {
        board: { type: 'string', required: true, hint: '看板 id' },
        note: { type: 'string', hint: '组内描述（多行可含关键路径/关键词；留空 = 清除）' },
      },
      run: (ctx) => boards.setBoardRepoNote({ id: ctx.id, board: ctx.board, note: ctx.note }),
      render: (d) => (d.note
        ? `已写组内描述: ${d.name} @ 「${d.boardName}」`
        : `已清除组内描述: ${d.name} @ 「${d.boardName}」`),
    },
    {
      id: 'board.import',
      cli: ['board', 'import'],
      http: ['POST', '/api/boards/import'],
      summary: '导入看板 JSON（一个看板 = 一个主题；按 path/name 匹配已登记仓库）',
      // 两种入口同一条 action：CLI 给文件路径（- = stdin），面板直接 POST {json}。
      // file 因此不能是必填——否则面板那条路会先被「缺少参数」拦掉。
      args: [{ name: 'file', required: false }],
      run: async (ctx) => {
        let json = typeof ctx.json === 'string' ? ctx.json : '';
        if (!json && ctx.file) {
          const { readFileSync } = await import('node:fs');
          json = readFileSync(ctx.file === '-' ? 0 : ctx.file, 'utf8');
        }
        if (!json) throw badInput('请给看板 JSON 文件路径（- 读 stdin），或在面板里粘贴 JSON');
        return boards.importBoards({ json });
      },
      render: (d) => {
        const lines = [`新建 ${d.created} 个看板，合并 ${d.merged} 个，匹配仓库 ${d.matched} 个`];
        if (d.unmatched.length) {
          lines.push('未匹配（登记里找不到，未导入）:');
          for (const u of d.unmatched) lines.push(`  [${u.board}] ${u.entry}`);
        }
        return lines.join('\n');
      },
    },
    {
      id: 'board.export',
      cli: ['board', 'export'],
      http: ['GET', '/api/boards/export'],
      summary: '导出看板 JSON（可回灌给 board import）',
      run: () => boards.exportBoards(),
      render: (d) => JSON.stringify(d, null, 2),
    },
  ],
};
