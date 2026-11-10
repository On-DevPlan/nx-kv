// 任务删除/取消/收口/恢复 action（自 index.js 拆出）：删除均可恢复（软删除），取消为终态。
import * as service from './service.js';
import { CWD, KEY } from './action-flags.js';

export const removalActions = [
  {
    id: 'localtask.remove',
    cli: ['localtask', 'remove'],
    http: ['DELETE', '/api/localtasks/item'],
    summary: '删除一条任务（按 --id，定位到 --cwd 主题或 --key）；删除是**可恢复**的（软删除），加 --purge 彻底清除',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      cwd: CWD,
      key: KEY,
      purge: { type: 'boolean', hint: '彻底删除（不可恢复）；不加就是软删除，可 restore 回来' },
    },
    run: (ctx) => service.removeTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge }),
    render: (d) =>
      d.purged
        ? `已彻底删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（不可恢复）`
        : `已删除主题「${d.name}」#${d.removed.id}: ${d.removed.text}（可用 localtask task restore 恢复）`,
  },
  {
    id: 'localtask.removeMany',
    cli: ['localtask', 'remove-many'],
    http: ['DELETE', '/api/localtasks/items'],
    summary:
      '批量删除任务（按 --ids，定位到 --cwd 主题或 --key）：一次落盘，逐条软删除（可 restore 恢复）；缺失的编号不阻断其余删除',
    flags: {
      ids: { type: 'array', required: true, hint: '任务编号，逗号分隔或给多次' },
      cwd: CWD,
      key: KEY,
      purge: { type: 'boolean', hint: '彻底删除（不可恢复）；不加就是软删除' },
    },
    run: (ctx) => service.removeTasks({ ids: ctx.ids, cwd: ctx.cwd, key: ctx.key, purge: ctx.purge }),
    render: (d) => {
      const done = d.removed.map((x) => `#${x.id}`).join(' ');
      const head = d.count
        ? `${d.purged ? '已彻底删除' : '已删除'}主题「${d.name}」${d.count} 条（${done}）`
        : `主题「${d.name}」没有可删的任务`;
      const tail = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      const how = d.count && !d.purged ? '；可用 localtask task restore 恢复' : '';
      return head + tail + how;
    },
  },
  {
    id: 'localtask.cancelMany',
    cli: ['localtask', 'cancel-many'],
    http: ['POST', '/api/localtasks/items/cancel'],
    summary:
      '批量取消待领取任务（按 --ids，定位到 --cwd 主题或 --key）：只处理 pending，已领取/已交付/已取消跳过；取消为终态，原文留档',
    flags: {
      ids: { type: 'array', required: true, hint: '任务编号，逗号分隔或给多次' },
      cwd: CWD,
      key: KEY,
    },
    run: (ctx) => service.cancelTasks({ ids: ctx.ids, cwd: ctx.cwd, key: ctx.key }),
    render: (d) => {
      const done = d.cancelled.map((x) => `#${x.id}`).join(' ');
      const head = d.count
        ? `已在主题「${d.name}」取消 ${d.count} 条待领取任务（${done}）`
        : `主题「${d.name}」没有可取消的待领取任务`;
      const skip = d.skipped.length
        ? `；跳过 ${d.skipped.map((x) => `#${x.id}(${x.status})`).join(' ')}`
        : '';
      const miss = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      return head + skip + miss;
    },
  },
  {
    id: 'localtask.closeMany',
    cli: ['localtask', 'close-many'],
    http: ['POST', '/api/localtasks/items/close'],
    summary:
      '批量收口待领取任务（按 --ids，定位到 --cwd 主题或 --key）：不要求先领取；--status done 写完成总结，cancelled 只改状态；已领取/已交付跳过',
    flags: {
      ids: { type: 'array', required: true, hint: '任务编号，逗号分隔或给多次' },
      cwd: CWD,
      key: KEY,
      status: { type: 'string', hint: 'done（标为完成，默认）或 cancelled（取消）' },
      summary: { type: 'string', hint: '完成总结（status=done 时可选）' },
    },
    run: (ctx) =>
      service.closeTasks({
        ids: ctx.ids,
        cwd: ctx.cwd,
        key: ctx.key,
        status: ctx.status,
        summary: ctx.summary,
      }),
    render: (d) => {
      const done = d.closed.map((x) => `#${x.id}`).join(' ');
      const verb = d.closeStatus === 'cancelled' ? '取消' : '标为完成';
      const head = d.count
        ? `已在主题「${d.name}」${verb} ${d.count} 条待领取任务（${done}）`
        : `主题「${d.name}」没有可${verb}的待领取任务`;
      const skip = d.skipped.length
        ? `；跳过 ${d.skipped.map((x) => `#${x.id}(${x.status})`).join(' ')}`
        : '';
      const miss = d.missing.length ? `；未找到 #${d.missing.join(' #')}` : '';
      return head + skip + miss;
    },
  },
  {
    id: 'localtask.task.restore',
    cli: ['localtask', 'task', 'restore'],
    http: ['POST', '/api/localtasks/tasks/restore'],
    summary: '恢复一条被删除（软删除）的任务（撤销删除）',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: (ctx) => service.restoreTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key }),
    render: (d) =>
      d.restored
        ? `已恢复主题「${d.name}」#${d.task.id}: ${d.task.text}`
        : `主题「${d.name}」#${d.task.id} 本来就没被删除，无需恢复。`,
  },
];
