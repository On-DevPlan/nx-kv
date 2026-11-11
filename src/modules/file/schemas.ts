// file 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- file.list ----
export const fileListInput = z.object({
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
  limit: z.number().default(100),
  offset: z.number().default(0),
});

// ---- file.upload ----
export const fileUploadInput = z.object({
  path: z.string().optional().describe("本机文件路径"),
  content: z.string().optional().describe("base64 内容（面板上传用，可为 data URL）"),
  name: z.string().optional().describe("文件名（content 上传时必填）"),
  contentType: z.string().optional().describe("覆盖 Content-Type（默认按扩展名猜）"),
  local: z.boolean().optional().describe("存本机附件仓（~/.nx-kv/attachments/local/），不碰云端"),
  accessLevel: z.enum(["public", "private", "protected"]).default('public').describe("出图权限；public 才能被 <img> 直接预览（--local 时无意义）"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- file.get ----
export const fileGetInput = z.object({
  fileId: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- file.remove ----
export const fileRemoveInput = z.object({
  fileId: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- file.content ----
export const fileContentInput = z.object({
  fileId: z.string(),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});

// ---- file.orphans ----
export const fileOrphansInput = z.object({

});

// ---- file.prune ----
export const filePruneInput = z.object({
  'dry-run': z.boolean().optional().describe("只列清单不删除"),
  dryRun: z.boolean().optional().describe("同 --dry-run（HTTP body 用）"),
});

// ---- file.sync ----
export const fileSyncInput = z.object({
  ids: z.array(z.string()).optional().describe("只同步这些 fileId（逗号分隔）"),
  dir: z.string().optional().describe("本地目录（默认 ~/.nx-kv/attachments/<工作空间>/）"),
  prune: z.boolean().optional().describe("删掉本地已不在后端的文件（仅全量同步时生效）"),
  dryRun: z.boolean().optional().describe("只列出将下载什么，不落盘"),
  group: z.number().optional().describe("工作空间 id（默认取当前）"),
});
