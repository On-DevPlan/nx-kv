// templates.add —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput, type ActionRunMeta } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import {  } from 'node:path';
import { parseScope, topicFromCwd } from '../support.js';
const service: any = serviceNs;

/** templates.add 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
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

export class TemplatesAddAction extends ActionBase<typeof input> {
  @action({
    id: 'templates.add',
    cli: ['template', 'add'],
    http: ['POST', '/api/templates'],
    summary: '新增任务模板（--body 给 Markdown 正文；多行正文用 --body-file <文件> 或 --body - 读管道；--setDefault 同时设为默认；--scope 设可见域、--topic 记创建主题并默认仅该主题可见）',
    args: ['name'],
    input,
    render: (d: any) =>
        `已新增模板「${d.template.name}」（${d.template.id}）${d.defaultId === d.template.id ? '，并设为默认' : ''}${
          Array.isArray(d.template.scope) && !d.template.scope.includes('*')
            ? `，可见域 ${JSON.stringify(d.template.scope)}`
            : ''
        }`,
  })
  override async run(ctx: ActionInput<this['_input']>, opts: ActionRunMeta = {}) {

      return service.addTemplate({
            name: ctx.name,
            body: ctx.body,
            bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']),
            setDefault: ctx.setDefault ?? ctx['set-default'],
            scope: parseScope(ctx.scope),
            topic: ctx.topic || topicFromCwd(ctx.cwd),
          });
  
  }
}
