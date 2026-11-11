// todo 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- todo.list ----
export const todoListInput = z.object({
  topic: z.string().optional().describe("只看某个主题"),
  status: z.enum(["open", "done", "freeze", "all"]).default('all'),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.get ----
export const todoGetInput = z.object({
  ref: z.string().describe("任务内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.add ----
export const todoAddInput = z.object({
  text: z.string(),
  topic: z.string().describe("主题，路由维度"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.update ----
export const todoUpdateInput = z.object({
  ref: z.string().describe("要改的那条的内容（整串）"),
  topic: z.string().optional().describe("改成这个主题"),
  text: z.string().optional().describe("改成这个内容"),
  note: z.string().optional(),
  matchTopic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.remove ----
export const todoRemoveInput = z.object({
  ref: z.string().describe("要删的那条的内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.attach ----
export const todoAttachInput = z.object({
  ref: z.string().describe("要挂附件的那条任务的内容（整串）"),
  path: z.string().optional().describe("本机文件路径（先上传再嵌入）"),
  fileId: z.string().optional().describe("已上传附件的 id（32 位 hex，可带扩展名）"),
  name: z.string().optional().describe("嵌入文字与本地文件名（默认取原文件名）"),
  kind: z.enum(["image", "file"]).optional().describe("用图片语法还是链接语法（默认按扩展名判断）"),
  accessLevel: z.enum(["public", "private", "protected"]).default('public'),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.attachments ----
export const todoAttachmentsInput = z.object({
  ref: z.string().describe("任务内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.done ----
export const todoDoneInput = z.object({
  ref: z.string().describe("要完成的那条的内容（整串）"),
  result: z.string().optional().describe("完成结果摘要"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.freeze ----
export const todoFreezeInput = z.object({
  ref: z.string().describe("要冻结的那条的内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.unfreeze ----
export const todoUnfreezeInput = z.object({
  ref: z.string().describe("要解冻的那条的内容（整串）"),
  topic: z.string().optional().describe("消歧：同内容有多条时用主题收窄"),
  pick: z.number().optional().describe("消歧：同内容多条时按编号选（配合报错里的列表）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- todo.archive ----
export const todoArchiveInput = z.object({
  before: z.string().optional().describe("截止日期，如 2026-08-01"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- topic.list ----
export const topicListInput = z.object({
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- topic.add ----
export const topicAddInput = z.object({
  name: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- topic.remove ----
export const topicRemoveInput = z.object({
  name: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- prompt.get ----
export const promptGetInput = z.object({
  topic: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- prompt.set ----
export const promptSetInput = z.object({
  topic: z.string(),
  text: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- prompt.remove ----
export const promptRemoveInput = z.object({
  topic: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- group.list ----
export const groupListInput = z.object({

});

// ---- group.get ----
export const groupGetInput = z.object({
  id: z.string(),
});

// ---- group.add ----
export const groupAddInput = z.object({
  name: z.string(),
  description: z.string().optional().describe("描述"),
});

// ---- group.update ----
export const groupUpdateInput = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名称"),
  description: z.string().optional().describe("新描述"),
});

// ---- group.remove ----
export const groupRemoveInput = z.object({
  id: z.string(),
});

// ---- group.current ----
export const groupCurrentInput = z.object({

});

// ---- group.use ----
export const groupUseInput = z.object({
  locator: z.string(),
});

// ---- group.members ----
export const groupMembersInput = z.object({
  id: z.string(),
});
