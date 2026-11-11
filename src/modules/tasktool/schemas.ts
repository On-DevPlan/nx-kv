// tasktool 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- timegoal.set ----
export const timegoalSetInput = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
  duration: z.string().describe("持续时长（10800 秒 / 5h / 90m / 2d / 5小时）"),
  prompt: z.string().describe("完整全局提示词（≤20000 字，每轮 check 会原文回显）"),
});

// ---- timegoal.update ----
export const timegoalUpdateInput = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
  prompt: z.string().describe("新版提示词（≤20000 字）"),
  duration: z.string().optional().describe("同时改时长（10800 / 5h / 90m / 2d）；省略则时长不变"),
});

// ---- timegoal.show ----
export const timegoalShowInput = z.object({
  cwd: z.string().optional().describe("工作目录（与 --task 二选一）"),
  task: z.string().optional().describe("任务级 goal key（task:<topicKey>:<taskId>）"),
});

// ---- timegoal.check ----
export const timegoalCheckInput = z.object({
  cwd: z.string().optional().describe("工作目录（与 --task 二选一）"),
  task: z.string().optional().describe("任务级 goal key（task:<topicKey>:<taskId>；带时长任务领取时自带）"),
  summary: z.string().describe("当前现状（每次 check 记录到日志，≤2000 字）"),
});

// ---- timegoal.clear ----
export const timegoalClearInput = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
});

// ---- timegoal.list ----
export const timegoalListInput = z.object({

});

// ---- timegoal.log ----
export const timegoalLogInput = z.object({
  cwd: z.string().describe("工作目录（与 timegoal 一对一）"),
});

// ---- timegoal.prune ----
export const timegoalPruneInput = z.object({

});
