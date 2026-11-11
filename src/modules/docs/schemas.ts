// docs 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- doc.list ----
export const docListInput = z.object({
  external: z.boolean().optional().describe("附带外部绑定闭包内的文档与绑定清单"),
});

// ---- doc.get ----
export const docGetInput = z.object({
  ref: z.string(),
});

// ---- doc.add ----
export const docAddInput = z.object({
  rel: z.string(),
  body: z.string().optional().describe("Markdown 正文"),
  bodyFile: z.string().optional().describe("从文件读正文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
});

// ---- doc.update ----
export const docUpdateInput = z.object({
  ref: z.string(),
  body: z.string().optional().describe("Markdown 全文"),
  bodyFile: z.string().optional().describe("从文件读全文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
});

// ---- doc.remove ----
export const docRemoveInput = z.object({
  ref: z.string(),
});

// ---- doc.attachments ----
export const docAttachmentsInput = z.object({
  ref: z.string(),
});

// ---- doc.attach ----
export const docAttachInput = z.object({
  ref: z.string(),
  path: z.string().optional().describe("本机文件路径（落本机附件仓）"),
  fileId: z.string().optional().describe("已有附件 id"),
  url: z.string().optional().describe("外部链接（http/https）"),
  task: z.string().optional().describe("任务全局 id（kind=task）"),
  doc: z.string().optional().describe("另一篇文档的 ref/path（kind=ref）"),
  name: z.string().optional().describe("显示名（默认取文件名/原名）"),
  note: z.string().optional().describe("附件区备注"),
  noEmbed: z.boolean().optional().describe("只写 ref_attach（role=attach），不改正文"),
  'no-embed': z.boolean().optional().describe("同 --noEmbed"),
});

// ---- doc.attach-note ----
export const docAttachNoteInput = z.object({
  ref: z.string(),
  attachment: z.string().describe("资源 id（见 docs attachments）"),
  note: z.string().optional().describe("说明文字（留空 = 清掉）"),
});

// ---- doc.detach ----
export const docDetachInput = z.object({
  ref: z.string(),
  attachment: z.string().describe("资源 id（见 docs attachments）"),
  purge: z.boolean().optional().describe("连资源与字节一起删（仍被引用时拒绝）"),
});

// ---- docs.seed ----
export const docsSeedInput = z.object({
  apply: z.boolean().optional().describe("执行播种（缺省只预览）"),
});

// ---- docs.bind ----
export const docsBindInput = z.object({
  repo: z.string().optional().describe("仓库（id / key / 路径 / 名称）"),
  board: z.string().optional().describe("看板（id / key / 名称）"),
  rel: z.string().optional().describe("自有树内路径（如 repo/github.com/me/x.md）"),
  path: z.string().optional().describe("外部文件/目录绝对路径（如 Obsidian vault；只读，不进 zip）"),
  reset: z.boolean().optional().describe("拆掉覆盖，回到约定路径"),
});

// ---- docs.notebind ----
export const docsNotebindInput = z.object({
  board: z.string(),
  repo: z.string().describe("仓库（id / key / 路径 / 名称）"),
  rel: z.string().optional().describe("自有树内路径"),
  path: z.string().optional().describe("外部文件/目录绝对路径（只读）"),
  reset: z.boolean().optional().describe("拆掉覆盖，回到约定路径"),
});

// ---- docs.link ----
export const docsLinkInput = z.object({
  board: z.string(),
  doc: z.string().optional().describe("自有树路径 = 自有文档；盘符/绝对路径 = 外部只读引用"),
  note: z.string().optional().describe("条目说明"),
  tag: z.string().optional().describe("分类标签（如 qa；简介行渲染成小 chip；空串 = 清掉）"),
  remove: z.number().optional().describe("移除第 N 条（1 起）"),
  before: z.number().optional().describe("插到第 N 条之前（缺省追加到末尾）"),
});

// ---- docs.index ----
export const docsIndexInput = z.object({

});
