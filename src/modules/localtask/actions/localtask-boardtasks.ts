// localtask.boardtasks —— 全部项目组的「本组任务」，一次拿全。
//
// 为什么需要这条（而不是让端侧自己拼）：
//
//   #197 起组归属是**库内关联**：tasks.group_topic_id → 组队列 topic。
//   本命令直接 SQL 查 `WHERE gtp.group_key = ?` 一次取完（走 ix_tasks_group 索引），
//   不再全量拉任务 + 逐条解析正文 frontmatter。
//
//   端侧（fr 手机界面）不持有全量主题快照：
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
import * as boardsNs from '../../repos/boards.js';
import { db } from '../infra/repo/index.js';

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

/** epoch ms → 时间戳串（与任务视图同格式：YYYY-MM-DD HH:MM:SS）。 */
function stampOf(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString().replace('T', ' ').slice(0, 19) : '';
}

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

    const conn = db();
    const boards = picked.map((b) => {
      // #197：组任务 = group_topic_id 指向「本组队列」的任务（一条 SQL，走索引）
      const rows: any[] = conn
        .all(
          `SELECT t.seq, t.status, t.round, t.body, t.created_at AS createdAtMs,
                  t.claimed_at AS claimedAtMs, t.done_at AS doneAtMs, t.feedback,
                  rtp.key AS topicKey, rtp.name AS topicName
             FROM tasks t
             JOIN topics gtp ON gtp.id = t.group_topic_id
             JOIN topics rtp ON rtp.id = t.repo_topic_id
            WHERE gtp.group_key = :gk AND t.deleted_at IS NULL AND rtp.deleted_at IS NULL`,
          { gk: String(b.key) },
        )
        .map((r: any) => ({
          id: Number(r.seq),
          status: String(r.status),
          title: titleOf(r.body),
          round: Number(r.round) || 1,
          ready: String(r.status) === 'pending',
          project: String(r.topicName || r.topicKey),
          topicKey: String(r.topicKey),
          createdAt: stampOf(r.createdAtMs),
          consumedAt: stampOf(r.claimedAtMs),
          completedAt: stampOf(r.doneAtMs),
          claimedByName: '',
          roundSummary: String(r.feedback || ''),
        }));
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
