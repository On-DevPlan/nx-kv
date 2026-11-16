// 只读段四插件（timecheck 30 / goalhint 40 / doneguard 50 / ack 70）：
// writes=[]，data() 返回空对象——它们只消费 seed（goal / task），
// schema 声明本段模板可见的变量目录（goal.* / task.*），全部 optional +
// nullable：strictObject 对「缺失的 optional」放行、data() 返回 {} 合法。
import { z } from 'zod';
import { PromptPlugin } from '../base.js';

const goalShape = z.looseObject({
  name: z.string().optional(),
  deadline: z.string().optional(),
  prompt: z.string().optional(),
  durationHuman: z.string().optional(),
  elapsedHuman: z.string().optional(),
  remainingHuman: z.string().optional(),
  elapsedSec: z.number().optional(),
  durationSec: z.number().optional(),
  remainingSec: z.number().optional(),
  overtimeSec: z.number().optional(),
  reached: z.boolean().optional(),
  blocked: z.boolean().optional(),
  goalKey: z.string().optional(),
  extra: z.string().optional(),
  check: z.string().optional(),
  statusLine: z.string().optional(),
}).optional().nullable();

const taskShape = z.looseObject({ id: z.number(), text: z.string() }).optional().nullable();

export class TimecheckPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'timecheck';
  readonly order = 30;
  readonly tag = 'nx-kv.timecheck';
  readonly label = '时间目标检查';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape });

  constructor(template: string) { super(template); }
  protected data() { return {} as never; }
}

export class GoalhintPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'goalhint';
  readonly order = 40;
  readonly tag = 'nx-kv.goalhint';
  readonly label = '特殊功能提示（timegoal）';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape, task: taskShape });

  constructor(template: string) { super(template); }
  protected data() { return {} as never; }
}

export class DoneguardPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'doneguard';
  readonly order = 50;
  readonly tag = 'nx-kv.doneguard';
  readonly label = '完成门禁提示（timegoal）';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ goal: goalShape, task: taskShape });

  constructor(template: string) { super(template); }
  protected data() { return {} as never; }
}

export class AckPlugin extends PromptPlugin<z.ZodObject<z.ZodRawShape>> {
  readonly id = 'ack';
  readonly order = 70;
  readonly tag = 'nx-kv.ack';
  readonly label = 'ack 完成总结';
  override readonly writes: readonly string[] = [];
  readonly dataSchema = z.strictObject({ task: taskShape });

  constructor(template: string) { super(template); }
  protected data() { return {} as never; }
}
