// localtask.boardtasks —— 全部项目组的「本组任务」，一次拿全。
//
// 为什么需要这条（而不是让端侧自己拼）：
//
//   组任务**物理上落在成员项目的队列里**（agent 按目录领活，队列归属不变），
//   归属只由正文 frontmatter 的 `board` 说明 —— 就是面板里的「两种走向」
//   （board-view.ts 的 taskInBoard / projectPending）。面板自己有全量主题快照，
//   拼一下就有了；端侧（fr 手机界面）没有：
//
//     · 逐个成员队列去问 → 28 个队列 28 次请求，每次服务端还要把整份 store 读一遍；
//     · 去拉 /api/localtasks → 每个任务都带正文，一次几 MB（端侧只画 30 字标题）。
//
//   服务端本来就在同一个进程里同时握着「看板成员表」与「全部任务」，聚合放在这里
//   是一行的事，端侧一次请求拿到侧栏徽标 + 组页列表。
//
// 判据与面板逐字一致：`boardMark ∈ {看板 id, key, 名称}`，软删除 / 迁移 tombstone
// 不算；成员关系按仓库 key 对（与 `board.repos[].key` 同一键空间）。
// 项目标签取任务所在队列的仓库名（未登记目录取队列名），组页据此画项目 tag。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import * as boardsNs from '../../repos/boards.js';

const service: any = serviceNs;
const boardsSvc: any = boardsNs;

/** localtask.boardtasks 的入参契约：不给 board = 全部组。 */
const input = z.object({
  board: z.string().optional().describe('只看一个组（id / key / 名称）；不给 = 全部组'),
});

/** 组任务的一行：够画列表 + 点进详情，另带**归属项目**（组页的项目 tag）。 */
const taskRow = z.object({
  id: z.int().describe('任务编号'),
  status: z.string().describe('pending / claimed / done / cancelled'),
  title: z.string().describe('正文首个标题行（没有标题就取首行，已截断）'),
  round: z.int().describe('第几轮'),
  ready: z.boolean().describe('当前是否可领取'),
  project: z.string().describe('归属项目（任务所在队列的仓库名；未登记目录取队列名）'),
  topicKey: z.string().describe('物理落点：任务所在队列的主题键（领取按它定位）'),
  createdAt: z.string(),
  consumedAt: z.string().describe('被领取的时间；未领取为空串'),
  completedAt: z.string(),
  claimedByName: z.string(),
  roundSummary: z.string().describe('本轮完成总结；未完成时为空串'),
});

const output = z.object({
  boards: z.array(
    z.object({
      id: z.string().describe('看板 id（面板创建任务时写进 frontmatter 的就是它）'),
      key: z.string().describe('看板键（board/xxx）'),
      name: z.string().describe('看板名称'),
      pending: z.int().describe('本组待领取数（= side bar 徽标口径）'),
      total: z.int().describe('本组任务总数'),
      tasks: z.array(taskRow),
    })
  ),
});

/** 取正文里的标题：跳过 frontmatter，首个 `#` 标题优先，否则首行；按 80 字截断。 */
function titleOf(text: unknown): string {
  const raw = String(text ?? '');
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

export class LocaltaskBoardTasksAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.boardtasks',
    cli: ['localtask', 'boardtasks'],
    http: ['GET', '/api/localtasks/boardtasks'],
    summary: '全部项目组的本组任务（端侧组页 / 侧栏徽标一次拿全）：按 frontmatter 的 board 归属聚合，带归属项目',
    input,
    output,
    render: (d: any) => {
      const lines: string[] = [];
      for (const b of d.boards) {
        lines.push(`${b.name}（${b.key}）· ${b.pending} 待领 / ${b.total} 条`);
        for (const t of b.tasks) {
          lines.push(`  #${t.id} [${t.status}] 第${t.round}轮 ${t.project} · ${t.title}`);
        }
      }
      return lines.join('\n') || '（没有组任务）';
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {
    const want = String(ctx.board ?? '').trim();
    const boardList: any[] = ((await boardsSvc.listBoards())?.boards ?? []) as any[];
    // 定位 & 归一：id / key / 名称都认（面板写 id，手写 frontmatter 可能是 key/名）
    const picked = want
      ? boardList.filter((b) => [b.id, b.key, b.name].filter(Boolean).map(String).includes(want))
      : boardList;
    if (want && picked.length === 0) {
      const { badInput } = await (import('../../../core/errors.js') as any);
      throw badInput(`项目组不存在: ${want}`);
    }

    const list: any = await service.listTasks();
    const topics: any[] = (list.topics ?? []) as any[];

    const boards = picked.map((b) => {
      const ids = [b.id, b.key, b.name].filter(Boolean).map(String);
      const memberKeys = new Set<string>(
        ((b.repos ?? []) as any[]).map((m) => (m && m.key ? String(m.key) : '')).filter(Boolean)
      );
      const rows: any[] = [];
      for (const t of topics) {
        if (t.isGlobal) continue;
        const repoKey = t.repo && t.repo.key ? String(t.repo.key) : '';
        // 成员关系按仓库 key 对（与 board.repos[].key 同一键空间）；
        // 没登记仓库的目录队列不属于任何组，天然出局。
        if (!repoKey || !memberKeys.has(repoKey)) continue;
        const project = (t.repo && t.repo.name) || t.name || t.key;
        for (const x of t.tasks ?? []) {
          if (x.deletedAt || x.migratedTo) continue;
          if (!ids.includes(String(x.boardMark ?? ''))) continue;
          rows.push({
            id: x.id,
            status: x.status,
            title: titleOf(x.text),
            round: x.round ?? 1,
            ready: !!x.ready,
            project,
            topicKey: t.key,
            createdAt: x.createdAt ?? '',
            consumedAt: x.consumedAt ?? '',
            completedAt: x.completedAt ?? '',
            claimedByName: x.claimedByName ?? '',
            roundSummary: x.roundSummary ?? '',
          });
        }
      }
      // 待领在前、其余按编号倒序：组页最想看的是「还有什么没干」
      rows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || a.id - b.id);
      return {
        id: b.id,
        key: b.key,
        name: b.name,
        pending: rows.filter((r) => r.status === 'pending').length,
        total: rows.length,
        tasks: rows,
      };
    });

    return { boards };
  }
}
