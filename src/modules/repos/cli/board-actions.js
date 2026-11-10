// board.* 的 action 声明（含按前缀归组的一次性命令）。
import * as boards from '../boards.js';
import { badInput } from '../../../core/errors.js';
import { renderBoardList, renderBoard } from './render.js';

export const boardActions = [
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
    summary: '把仓库聚合进看板（可同时在多个看板；--remove 移出；--before 插位；仓库给 id / key / 路径）',
    args: ['id'],
    flags: {
      board: { type: 'string', hint: '目标看板 id / key / 名称' },
      before: { type: 'string', hint: '插到这张卡片之前（按 key）' },
      remove: { type: 'boolean', hint: '移出：带 --board 从该板移出，不带则从所有看板移出' },
    },
    run: (ctx) => boards.assignRepo(ctx),
    render: (d) => (d.removed
      ? `已移出: ${d.key}（${d.count} 个看板）`
      : `${d.added ? '已聚合' : '已在（位次已调）'}: ${d.key} → ${d.board}`),
  },
  {
    // 占位成员的自救：把组里的假 key 换成真 key。
    // 不是「改仓库的 key 去迁就占位」——那样真实身份会被降级成 local/xxx 并传染给导出物。
    id: 'board.rekey',
    cli: ['board', 'rekey'],
    http: ['POST', '/api/boards/rekey'],
    summary: '把组里的占位 key 重绑到本机仓库（关系改、登记不动；组内描述与文档绑定跟着搬）',
    args: ['from'],
    flags: {
      to: { type: 'string', required: true, hint: '本机仓库：id / key / 路径 / 名称' },
      board: { type: 'string', hint: '只在这张看板里重绑（省略 = 自动找包含它的看板）' },
    },
    run: (ctx) => boards.rekeyMember({ from: ctx.from, to: ctx.to, board: ctx.board }),
    render: (d) => {
      const where = d.boards.length > 1 ? `${d.boards.length} 个看板（${d.boards.join('、')}）` : `组「${d.boardName}」`;
      return `已重绑 ${d.from} → ${d.to}（${where}${d.merged ? '，与已有成员合并' : ''}${d.movedNote ? '，组内描述已跟随' : ''}${d.relinked ? `，${d.relinked} 条绑定已改指` : ''}）`;
    },
  },
  {
    // 待初始化队列的出口：没有远程地址的占位永远转不了正（clone 不回来），
    // 只能清掉。默认预览，--apply 才落盘。
    id: 'board.prune',
    cli: ['board', 'prune'],
    http: ['POST', '/api/boards/prune'],
    summary: '清理占位成员：组里引用、本机没登记且没有远程地址的仓库（默认预览，--apply 落盘；带 remote 的加 --all 才清）',
    flags: {
      board: { type: 'string', hint: '只清这张看板（省略 = 全部看板）' },
      all: { type: 'boolean', hint: '连带远程地址的占位一起清（它们本来可以 clone 回来）' },
      apply: { type: 'boolean', hint: '真正落盘（省略 = 只预览）' },
    },
    run: (ctx) => boards.prunePlaceholders({ board: ctx.board, all: !!ctx.all, apply: !!ctx.apply }),
    render: (d) => {
      const lines = [`${d.apply ? '已清理' : '可清理'} ${d.total} 个占位成员${d.apply ? '' : '（未落盘）'}`];
      for (const it of d.items) lines.push(`  ${it.name}  ${it.key}  —— 组「${it.board}」${it.remote ? '（有 remote，--all 才会清）' : '（无来源）'}`);
      if (!d.apply && d.total) lines.push('', '落盘: nx-kv board prune --apply');
      return lines.join('\n');
    },
  },
  {
    // 组内描述：同一个仓库在不同看板里的角色各不相同，描述挂在成员关系上而非登记上。
    // 登记的 desc = 「这个仓库是干什么的」；组内描述 = 「它在这个组里占什么位置、怎么配合」。
    id: 'board.note',
    cli: ['board', 'note'],
    http: ['POST', '/api/boards/note'],
    summary: '写/清组内描述：仓库在看板里的角色与配合关系（--note 留空 = 清除；仓库给 id / key / 绝对路径）',
    args: ['id'],
    flags: {
      board: { type: 'string', required: true, hint: '看板 id / key / 名称' },
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

  // ---- 按前缀归组：一次性命令，命中的仓库固化成看板的显式成员 ----
  // 规则不驻留（2026-11-02 起废除常驻规则）：之后新登记的仓库要再跑一次。
  {
    id: 'board.prefix',
    cli: ['board', 'prefix'],
    http: ['POST', '/api/boards/prefix'],
    summary: '按前缀归组：把名字以 <prefix> 开头的仓库一次性挂进看板（--board 给目标看板；不给就按前缀名自动建同名看板）',
    args: ['prefix'],
    flags: { board: { type: 'string', hint: '目标看板（id / key / 名称；缺省 = 与前缀同名，自动新建）' } },
    run: (ctx) => boards.applyPrefixGroup(ctx),
    render: (d) =>
      `已把「${d.prefix}*」的 ${d.added} 个仓库挂进看板「${d.boardName}」` +
      `${d.boardCreated ? '（已自动新建该看板）' : ''}，看板现有 ${d.total} 个成员`,
  },
];
