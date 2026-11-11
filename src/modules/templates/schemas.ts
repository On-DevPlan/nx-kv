// templates 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- templates.list ----
export const templatesListInput = z.object({
  topic: z.string().optional().describe("按队列 topics.key 过滤（可与 --group/--repo 组合；响应带 scoped:true）"),
  group: z.string().optional().describe("按项目组 repos.key 过滤（#132：组本身是可见主体，与 topic/repo 平级）"),
  repo: z.string().optional().describe("按项目 repos.key 过滤"),
});

// ---- templates.add ----
export const templatesAddInput = z.object({
  name: z.string(),
  body: z.string().optional().describe("模板正文（Markdown；首行写 `# 标题` 则提交时作为任务标题）"),
  bodyFile: z.string().optional().describe("从文件读模板正文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
  setDefault: z.boolean().optional().describe("新增后立即设为默认模板"),
  'set-default': z.boolean().optional().describe("同 --setDefault（连字符写法）"),
  scope: z.unknown().optional().describe("可见域（#128/#131）：* 全局 / topic:<key> 队列 / repo:<key> 项目 / group:<key> 组——JSON 数组或逗号短写；缺省空（未配置，不默认全局）；带 --topic 时默认仅该主题"),
  topic: z.string().optional().describe("创建主题锚（topics.key）：默认仅该主题可见，origin_topic 记它"),
  cwd: z.string().optional().describe("同 --topic，但给工作目录（按目录派生主题 key）"),
});

// ---- templates.update ----
export const templatesUpdateInput = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名字（不传保持不变）"),
  body: z.string().optional().describe("新正文（Markdown；不传保持不变）"),
  bodyFile: z.string().optional().describe("从文件读新正文（--body 优先）；`-` = 读标准输入"),
  'body-file': z.string().optional().describe("同 --bodyFile（连字符写法）"),
  scope: z.unknown().optional().describe("可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写（不传保持不变）"),
  values: z.string().optional().describe("槽位值 JSON（形如 {\"背景\":\"要做的事\"}）——老模板正文里的 {{槽位名}} 处填这段文字（新模板直接写正文即可）"),
});

// ---- templates.remove ----
export const templatesRemoveInput = z.object({
  id: z.string(),
});

// ---- templates.default ----
export const templatesDefaultInput = z.object({
  id: z.string(),
  name: z.string().optional().describe("新名字（配合 --body/--scope 时改默认模板本身）"),
  body: z.string().optional().describe("新正文（配合时改默认模板本身）"),
  values: z.unknown().optional().describe("槽位值 JSON（CLI 传 JSON 串；HTTP 可直接给对象）"),
  scope: z.unknown().optional().describe("可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写"),
});
