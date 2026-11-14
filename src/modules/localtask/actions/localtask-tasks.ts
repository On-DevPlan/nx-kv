// localtask.tasks —— 一个主题的**任务清单**（只回轻量视图，不含正文）。
//
// 为什么另开一条而不再给 localtask.list 加 `tasks`：
//   list 的语义是「主题总览」，每个主题都挂着它的全部任务（实测某主题 194 条、
//   单条正文 200KB 量级），把这些一起塞进总览，端侧每次刷首页都要吞几 MB，
//   而首页真正要的只是「几个主题、各几条待领」。
//   要看某个主题的清单时**点名去看这一个**，并只回列表需要的字段：
//   标题、状态、第几轮、可不可领 —— 正文留给 localtask.get。
//
// 这是给端侧（fr 的 nx-kv 原生界面）用的读接口，CLI 上也顺手给了 `localtask tasks`：
// 一条命令看清某个队列里有什么，不必先 list 再在几 MB JSON 里翻。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';

const service: any = serviceNs;

/** localtask.tasks 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  key: z.string().optional().describe('主题键（board/xxx 或 group/xxx）'),
  cwd: z.string().optional().describe('主题绑定的工作目录（不给 --key 时用它定位；都不给=当前目录）'),
  status: z.string().optional().describe('只看某个状态：pending / claimed / done / cancelled'),
});

/**
 * 清单里的一行：够 UI 画出一个列表 + 点进详情，**不含正文**。
 */
const row = z.object({
  id: z.int().describe('任务编号'),
  status: z.string().describe('pending / claimed / done / cancelled'),
  title: z.string().describe('正文首个标题行（没有标题就取首行，已截断）'),
  round: z.int().describe('第几轮'),
  ready: z.boolean().describe('当前是否可领取'),
  reopenCount: z.int(),
  createdAt: z.string(),
  consumedAt: z.string().describe('被领取的时间；未领取为空串'),
  completedAt: z.string(),
  claimedByName: z.string(),
  roundSummary: z.string().describe('本轮完成总结；未完成时为空串'),
});

const output = z.object({
  key: z.string().describe('主题键'),
  name: z.string().describe('主题名'),
  cwd: z.string().describe('主题绑定的工作目录'),
  total: z.int().describe('本主题任务总数（未过滤前）'),
  tasks: z.array(row),
});

/** 取正文里的标题：跳过 frontmatter，首个 `#` 标题优先，否则首行；按 80 字截断。 */
function titleOf(text: unknown): string {
  const raw = String(text ?? '');
  // frontmatter：文件以 --- 开头时，跳到第二个 --- 之后
  let body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) body = raw.slice(end + 4);
  }
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l));
  const line = (heading ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '');
  return line.length > 80 ? line.slice(0, 80) + '…' : line;
}

export class LocaltaskTasksAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.tasks',
    cli: ['localtask', 'tasks'],
    http: ['GET', '/api/localtasks/tasks'],
    summary: '看一个主题的任务清单（按 --key 或 --cwd 定位）：只回列表需要的字段（标题/状态/轮次/可领），不含正文',
    input,
    output,
    render: (d: any) => {
      const head = `${d.name}（${d.key}）· ${d.tasks.length}/${d.total} 条`;
      const rows = d.tasks.map(
        (t: any) => `  #${t.id} [${t.status}] 第${t.round}轮 ${t.title}`,
      );
      return [head, ...rows].join('\n');
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const { resolveTopicKey } = await (import('../paths.js') as any);
    const key = resolveTopicKey({ key: ctx.key, cwd: ctx.cwd });
    const list: any = await service.listTasks();
    const topic = (list.topics as any[]).find((t) => t.key === key);
    if (!topic) {
      const { badInput } = await (import('../../../core/errors.js') as any);
      throw badInput(`主题不存在: ${key}`);
    }
    const all = (topic.tasks ?? []).filter((t: any) => !t.deletedAt && !t.archivedAt);
    const filtered = ctx.status ? all.filter((t: any) => t.status === ctx.status) : all;
    return {
      key: topic.key,
      name: topic.name,
      cwd: topic.cwd,
      total: all.length,
      tasks: filtered.map((t: any) => ({
        id: t.id,
        status: t.status,
        title: titleOf(t.text),
        round: t.round ?? 1,
        ready: !!t.ready,
        reopenCount: t.reopenCount ?? 0,
        createdAt: t.createdAt ?? '',
        consumedAt: t.consumedAt ?? '',
        completedAt: t.completedAt ?? '',
        claimedByName: t.claimedByName ?? '',
        roundSummary: t.roundSummary ?? '',
      })),
    };
  }
}
