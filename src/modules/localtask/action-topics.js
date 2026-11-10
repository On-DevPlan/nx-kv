// 主题管理 action（自 index.js 拆出）：目录登记 / 主题删除（单个 / 批量）。
import * as service from './service.js';
import { renderRemoveMany } from './action-render.js';

export const topicActions = [
  {
    id: 'localtask.topic.add',
    cli: ['localtask', 'topic', 'add'],
    http: ['POST', '/api/localtasks/topic'],
    summary: '登记一个工作目录：空目录也常驻（prune 不清）；--summary 顺带写「现状摘要」（面板顶栏摘要的编辑入口）',
    flags: { cwd: { type: 'string', required: true, hint: '工作目录（绝对路径或可解析的相对路径）' }, summary: { type: 'string', hint: '现状摘要（可选；已登记目录即更新）' } },
    run: (ctx) => service.addTopic({ cwd: ctx.cwd, summary: ctx.summary }),
    render: (d) =>
      `${d.existed ? '已更新' : '已登记'}目录「${d.name}」${d.cwd}` +
      (d.existed ? '（原先已存在）' : ''),
  },
  {
    id: 'localtask.topic.remove',
    cli: ['localtask', 'topic', 'remove'],
    http: ['DELETE', '/api/localtasks/topic'],
    summary: '删除整个主题（含全部任务；按 --cwd 或 --key，等待中需 --force）',
    flags: {
      cwd: { type: 'string', hint: '工作目录（与 --key 二选一）' },
      key: { type: 'string', hint: '主题 key（与 --cwd 二选一）' },
      force: { type: 'boolean', hint: '连等待中的主题也删（agent 将超时收尾）' },
    },
    run: (ctx) => service.removeTopic({ cwd: ctx.cwd, key: ctx.key, force: ctx.force }),
    render: (d) =>
      `已删除主题「${d.name}」（待领取/共 ${d.topic.pending}/${d.topic.total} 条任务一并删除）`,
  },
  {
    id: 'localtask.topic.removeMany',
    cli: ['localtask', 'topic', 'remove-many'],
    http: ['POST', '/api/localtasks/topics/remove'],
    summary: '批量删除主题（--keys/--cwds 逗号分隔，或 --all；等待中默认跳过，--force 连等待中删）',
    flags: {
      keys: { type: 'array', hint: '主题 key，逗号分隔' },
      cwds: { type: 'array', hint: '工作目录，逗号分隔' },
      all: { type: 'boolean', hint: '清空全部主题（等待中仍跳过，除非 --force）' },
      force: { type: 'boolean', hint: '连等待中的主题一起删' },
    },
    run: (ctx) =>
      service.removeTopics({ keys: ctx.keys, cwds: ctx.cwds, all: ctx.all, force: ctx.force }),
    render: renderRemoveMany,
  },
];
