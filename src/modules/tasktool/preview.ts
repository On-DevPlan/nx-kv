// tasktool/preview.js —— 「预览 get 提示词」（任务 #65）。
//
// 用户的诉求是**可观测**：「当前具体会获得怎么样的字符串？」——
// 编辑页「更多 → 预览 get 提示词」点开就应该看到 agent 领取时会拿到的**那一份原文**，
// 而不是再去猜「模板 + 参数 + 开关」拼起来大概长什么样。
//
// 三条纪律：
//   1. **零副作用**：不领取、不写盘、不启动时间目标计时、不为附件发网。
//      预览是只读操作，打开一次不该改变任何状态（见 wait.js 的 preview 分支）。
//   2. **不复制渲染逻辑**：整条链路就是 buildTaskDelivery + getTask 的持续 get 叠加，
//      与真实领取走同一份代码——复制一份「预览专用渲染」迟早与真实交付漂移，
//      那种预览比没有更糟。
//   3. **分段可追溯**：每段标明来源（交付上下文 / check 指令 / 附件 / ack /
//      持续 get），并附带各项开关的当前状态——用户要能看出「这段是哪来的、
//      想关该关哪个开关」。
import { getSettings } from '../localtask/service.js';
import {
  BLOCK_DEFS,
  resolveBlockTemplates,
  type BlockDef,
  type ResolvedBlockTemplate,
} from '../../shared/prompt-blocks.js';
import { deliveryPlainText } from './delivery-text.js';
import { getLoopForCwd, getLoopInstruction, type GetLoopState } from './getloop.js';
import { buildTaskDelivery } from './wait.js';

export interface PreviewTaskDeliveryOptions {
  /** 任务行（库存形状；草稿由调用方合成 { id:0, text }） */
  task?: any;
  /** 等待方目录（决定组上下文与项目级「持续 get」） */
  cwd?: string;
  /** 主题 key（任务级 timegoal 寻址用） */
  key?: string;
  /** 现状（模板占位符 {{summary}}） */
  summary?: string;
  /** 外部参数（与 --param 同语义） */
  params?: Record<string, string>;
}

/**
 * 预览一条任务的交付载荷。
 *
 * @returns { task, instruction, coversBody, segments, getLoop, switches }
 */
export async function previewTaskDelivery({ task, cwd, key, summary, params }: PreviewTaskDeliveryOptions = {}): Promise<Record<string, any>> {
  const settings: any = (await getSettings().catch(() => null)) || {};
  const segments: any[] = [];
  // 项目级「持续 get」：与 tasktool/get.js 同口径（只在开启时传入内文；#182 起
  // 内文固定取全局区块默认值，仓库侧只有开关 + 分钟）。
  // 统一交给 buildTaskDelivery 编排成 getloop 区块，预览与真实领取不会各拼一份。
  const loop: GetLoopState = await getLoopForCwd(cwd).catch(() => ({ enabled: false }));
  const getLoopTpl = getLoopInstruction(loop);
  const delivery: any = await buildTaskDelivery(task, {
    source: 'local',
    summary: summary || '',
    cwd,
    name: '',
    topicKey: key,
    params: params || {},
    preview: true,
    trace: segments,
    getLoopTpl,
    getLoopWaitMinutes: loop.enabled ? loop.waitMinutes || 0 : 0,
  });

  const previewTask = delivery.task || task;
  const instruction = delivery.instruction || '';

  const ackList: any[] = settings.ackPromptList || [];
  const active: Record<string, ResolvedBlockTemplate> = resolveBlockTemplates(settings.blockTemplates);
  const contextTpl = active['context'] as ResolvedBlockTemplate;
  const attachTpl = active['attachment'] as ResolvedBlockTemplate;
  return {
    task: previewTask,
    instruction,
    coversBody: !!delivery.coversBody,
    // 面板 <pre> 直接显示这段：与 CLI 取任务时的正文排版同一份代码
    rendered: deliveryPlainText({ ...delivery, instruction, task: previewTask }),
    segments,
    getLoop: {
      enabled: !!loop.enabled,
      waitMinutes: loop.waitMinutes || 0,
    },
    switches: {
      ack: { on: ackList.length > 0, count: ackList.length },
      // 兼容旧预览面板：这两个开关表示对应区块当前是否用了自定义模板
      deliveryTemplate: { custom: !contextTpl.builtin, name: contextTpl.name },
      attachTemplate: { custom: !attachTpl.builtin, name: attachTpl.name },
      appendMode: settings.appendMode || 'xml',
      // 每个区块各自选中的生效模板（内置 / 自定义）
      blockTemplates: Object.fromEntries(
        (BLOCK_DEFS as readonly BlockDef[]).map((d) => [
          d.id,
          {
            id: (active[d.id] as ResolvedBlockTemplate).id,
            name: (active[d.id] as ResolvedBlockTemplate).name,
            custom: !(active[d.id] as ResolvedBlockTemplate).builtin,
            builtin: (active[d.id] as ResolvedBlockTemplate).builtin,
          },
        ])
      ),
      attachments: delivery.attachmentsSync ? { synced: delivery.attachmentsSync } : null,
    },
  };
}
