// localtask.config —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as serviceNs from '../service.js';
import { BLOCK_DEFS as _BLOCK_DEFS, resolveBlockTemplates as _resolveBlockTemplates } from '../../../shared/prompt-blocks.js';
import { badInput as _badInput } from '../../../core/errors.js';
const service: any = serviceNs;
const BLOCK_DEFS: any = _BLOCK_DEFS;
const resolveBlockTemplates: any = _resolveBlockTemplates;
const badInput: any = _badInput;

/** localtask.config 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  timeout: z.number().optional().describe("超时秒数（1-600）"),
  ack: z.string().optional().describe("ack 汇报要求（写入 ack 区块的「命令行」模板并启用；默认内置要求 agent 调 localtask done）。传空 = 恢复内置"),
  'ack-list': z.array(z.string()).optional().describe("整体替换 ack 完成总结提示词列表（多条）"),
  ackList: z.array(z.string()).optional().describe("同 --ack-list（驼峰写法，HTTP body 用）"),
  'delivery-template': z.string().optional().describe("交付上下文模板（写入 context 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板。变量与语法见 skill / docs"),
  'reset-delivery-template': z.boolean().optional().describe("恢复 context 区块内置模板"),
  'attach-template': z.string().optional().describe("附件段提示词（写入 attachment 区块的「命令行」模板并启用）；置空 = 恢复内置默认模板"),
  attachTemplate: z.string().optional().describe("同 --attach-template（驼峰写法，HTTP body 用）"),
  'reset-attach-template': z.boolean().optional().describe("恢复 attachment 区块内置模板"),
  'append-mode': z.string().optional().describe("系统上下文追加模式（全局）：xml（默认，每段包独立标签）/ plain（按空行直接拼正文）。HTTP body 用 appendMode"),
  appendMode: z.string().optional().describe("同 --append-mode（驼峰写法，HTTP body 用）"),
  'block-templates': z.string().optional().describe("每区块模板列表（JSON 对象）：{\"context\":{\"active\":\"builtin\",\"list\":[…]},…}。HTTP body 用 blockTemplates（对象）"),
  // #104：HTTP 驼峰别名此前漏声明——设置面板 PATCH 的 blockTemplates/appendMode 被
  // zod 静默剥离，patch 落空报「请至少指定一项」，web 端提示词模板完全无法保存。
  blockTemplates: z.unknown().optional().describe("同 --block-templates（HTTP body 直接传对象，不走 JSON 字符串）"),
});

export class LocaltaskConfigAction extends ActionBase<typeof input> {
  @action({
    id: 'localtask.config',
    cli: ['localtask', 'config'],
    http: ['PATCH', '/api/localtasks/setting'],
    summary: '配置等待超时（秒）/ ack 汇报要求（ack 区块，done 指令与收尾要求唯一出口）/ 每区块模板列表',
    input,
    render: (s: any) => {
      const ack: any = s.ackPromptList && s.ackPromptList.length ? `ack 提示词 ${s.ackPromptList.length} 条` : 'ack 提示词已清空';
      const mode: any = s.appendMode === 'plain' ? '正文直追加' : 'XML 区块';
      const active: any = resolveBlockTemplates(s.blockTemplates);
      const blocks: any = BLOCK_DEFS.map((d: any) => `${d.id}=${active[d.id].builtin ? '内置' : `「${active[d.id].name}」`}`).join('，');
      return `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）· ${ack} · 追加模式：${mode} · 区块模板：${blocks}`;
    },
  })
  override async run(ctx: ActionInput<this['_input']>) {

        const patch: any = { timeoutSec: ctx.timeout };
        if (ctx.ack !== undefined) patch.ackPrompt = ctx.ack;
        const ackList: any = ctx.ackList ?? ctx['ack-list'];
        if (ackList !== undefined) {
          if (ctx.ack !== undefined) throw badInput('--ack-list 不能与 --ack 同用');
          patch.ackPrompt = ackList;
        }
        // 交付上下文模板（任务 #62）：置空 = 恢复内置默认模板
        if (ctx['delivery-template'] !== undefined) patch.deliveryTemplate = ctx['delivery-template'];
        if (ctx['reset-delivery-template']) patch.deliveryTemplate = '';
        // 附件段提示词（任务 #82）：置空 = 恢复内置默认
        const attachTpl: any = ctx.attachTemplate ?? ctx['attach-template'];
        if (attachTpl !== undefined) patch.attachTemplate = attachTpl;
        if (ctx['reset-attach-template']) patch.attachTemplate = '';
        // 系统上下文追加模式（全局）——HTTP body 用驼峰别名 appendMode（#104）
        const appendMode: any = ctx.appendMode ?? ctx['append-mode'];
        if (appendMode !== undefined) patch.appendMode = appendMode;
        // 每区块模板列表（设置面板「提示词模板」模块）：HTTP body 传对象（blockTemplates）、
        // CLI 传 JSON 字符串（--block-templates）；对象是 zod 'raw' 原样透传（#104）
        let blockTemplates: any = ctx.blockTemplates ?? ctx['block-templates'];
        if (typeof blockTemplates === 'string') {
          try {
            blockTemplates = JSON.parse(blockTemplates);
          } catch {
            throw badInput(
              '--block-templates 需为合法 JSON 对象（形如 {"context":{"active":"builtin","list":[…]}}）'
            );
          }
        }
        if (blockTemplates !== undefined) patch.blockTemplates = blockTemplates;
        return service.updateSettings(patch);
    
  }
}
