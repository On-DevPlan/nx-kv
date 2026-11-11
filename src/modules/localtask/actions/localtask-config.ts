// localtask.config —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskConfigInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { BLOCK_DEFS as _BLOCK_DEFS, resolveBlockTemplates as _resolveBlockTemplates } from '../../../shared/prompt-blocks.js';
import { badInput as _badInput } from '../../../core/errors.js';
const service: any = serviceNs;
const BLOCK_DEFS: any = _BLOCK_DEFS;
const resolveBlockTemplates: any = _resolveBlockTemplates;
const badInput: any = _badInput;

export class LocaltaskConfigAction extends ActionBase {
  @action({
    id: 'localtask.config',
    cli: ['localtask', 'config'],
    http: ['PATCH', '/api/localtasks/setting'],
    summary: '配置等待超时（秒）/ ack 汇报要求（ack 区块，done 指令与收尾要求唯一出口）/ 每区块模板列表',
    input: localtaskConfigInput,
    render: (s: any) => {
      const ack: any = s.ackPromptList && s.ackPromptList.length ? `ack 提示词 ${s.ackPromptList.length} 条` : 'ack 提示词已清空';
      const mode: any = s.appendMode === 'plain' ? '正文直追加' : 'XML 区块';
      const active: any = resolveBlockTemplates(s.blockTemplates);
      const blocks: any = BLOCK_DEFS.map((d: any) => `${d.id}=${active[d.id].builtin ? '内置' : `「${active[d.id].name}」`}`).join('，');
      return `已配置等待超时 ${s.timeoutSec} 秒（推荐 ${s.recommendedSec}，最大 ${s.maxSec}）· ${ack} · 追加模式：${mode} · 区块模板：${blocks}`;
    },
  })
  async config(ctx: any) {

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
        // 系统上下文追加模式（全局）
        const appendMode: any = ctx.appendMode ?? ctx['append-mode'];
        if (appendMode !== undefined) patch.appendMode = appendMode;
        // 每区块模板列表（设置面板「提示词模板」模块）：支持 JSON 字符串 / HTTP body 对象
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
