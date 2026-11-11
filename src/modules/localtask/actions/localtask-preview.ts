// localtask.preview —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { localtaskPreviewInput } from '../schemas.js';
import * as serviceNs from '../service.js';
import { badInput as _badInput } from '../../../core/errors.js';
import { renderPreview as _renderPreview } from '../action-render.js';
const service: any = serviceNs;
const badInput: any = _badInput;
const renderPreview: any = _renderPreview;

export class LocaltaskPreviewAction extends ActionBase {
  @action({
    id: 'localtask.preview',
    cli: ['localtask', 'preview'],
    http: ['POST', '/api/localtasks/preview'],
    summary: '预览一条任务在 get/wait 时的交付提示词（只读：不领取、不写盘、不启动计时、不为附件发网）；草稿用 --text 直接预览',
    input: localtaskPreviewInput,
    render: renderPreview,
  })
  async preview(ctx: any) {

        const { previewTaskDelivery } = await (import('../../tasktool/preview.js') as any);
        const { parseParams } = await (import('../../tasktool/params.js') as any);
        const draftText: any = ctx.text === undefined || ctx.text === null ? '' : String(ctx.text);
        if (!draftText.trim() && (ctx.id === undefined || ctx.id === null)) {
          throw badInput('需要 --id <任务编号>（预览库存任务）或 --text <正文>（预览草稿）');
        }
        const task: any = draftText.trim()
          ? { id: 0, text: draftText, status: 'draft' }
          : await service.getTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
        // 任务级 timegoal 按主题 key 寻址：没显式给 key 就从 cwd 归一化出来
        const topicKey: any = ctx.key || service.normalizeCwd(ctx.cwd).key;
        return previewTaskDelivery({
          task,
          cwd: ctx.cwd,
          key: topicKey,
          summary: '',
          params: parseParams(ctx.param),
        });
    
  }
}
