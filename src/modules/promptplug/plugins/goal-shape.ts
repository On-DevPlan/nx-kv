// 时间目标 / 当前任务 的共享 shape（timecheck · goalhint · doneguard · ack 共用）。
//
// 每个字段的 .describe() 就是设置页变量目录显示的含义（schema-bridge 读它当 label），
// 所以中文说明必须写在这里——别再单独维护一份变量表。
import { z } from 'zod';

export const goalShape = z
  .looseObject({
    name: z.string().optional().describe('时间目标名（如「验收窗口」）'),
    deadline: z.string().optional().describe('截止时刻（YYYY-MM-DD HH:mm:ss）'),
    prompt: z.string().optional().describe('目标的附加要求原文（领取时随 check 指令给出）'),
    durationHuman: z.string().optional().describe('总时长（人话，如「2 小时」）'),
    elapsedHuman: z.string().optional().describe('已过时长（人话）'),
    remainingHuman: z.string().optional().describe('剩余时长（人话）'),
    elapsedSec: z.number().optional().describe('已过秒数（给 helper 算比例用）'),
    durationSec: z.number().optional().describe('总秒数'),
    remainingSec: z.number().optional().describe('剩余秒数（到点后为 0）'),
    overtimeSec: z.number().optional().describe('超时秒数（未到点为 0）'),
    reached: z.boolean().optional().describe('是否已到点（到了就该收口）'),
    blocked: z.boolean().optional().describe('是否被时间挡在 done 之外（完成门禁用）'),
    goalKey: z.string().optional().describe('目标 id（timegoal check --task 用）'),
    extra: z.string().optional().describe('领取后追加的要求（可动态改）'),
    check: z.string().optional().describe('本轮检查指令整段文本（有任务级目标时才有）'),
    statusLine: z.string().optional().describe('目录级目标的状态行（「剩余 12 分钟」）'),
    checks: z
      .array(
        z.looseObject({
          at: z.string().describe('检查时刻（YYYY-MM-DD HH:mm:ss）'),
          elapsedSec: z.number().describe('那一刻已过秒数'),
          remainingSec: z.number().describe('那一刻剩余秒数'),
          overtimeSec: z.number().describe('那一刻超时秒数'),
          reached: z.boolean().describe('那一刻是否已到点'),
          summary: z.string().describe('那一轮汇报的现状'),
        }),
      )
      .optional()
      .describe('本轮之前的检查流水（旧→新，最后一条 = 最近一次；用 {{#each goal.checks}} 遍历）'),
    sinceLastCheckSec: z
      .number()
      .optional()
      .describe('距上次检查的秒数（首次检查时没有此值；小于 600 = 10 分钟内重复检查，该严重警告）'),
  })
  .optional()
  .nullable()
  .describe('时间目标（任务级或目录级）；没有目标 → null，三段都不输出');

export const taskShape = z
  .looseObject({ id: z.number().describe('任务号'), text: z.string().describe('任务正文原文') })
  .optional()
  .nullable()
  .describe('当前任务（seed，宿主传入）');
