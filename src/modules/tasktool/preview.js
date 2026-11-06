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
//   3. **分段可追溯**：每段标明来源（交付上下文 / 收尾指令 / check 指令 / 附件 /
//      ack / 持续 get），并附带各项开关的当前状态——用户要能看出「这段是哪来的、
//      想关该关哪个开关」。
import { hasTemplateMarkers, renderInstruction } from '../../core/instruction-template.js';
import { getSettings } from '../localtask/service.js';
import { deliveryPlainText } from './delivery-text.js';
import { DEFAULT_GET_LOOP_TEMPLATE, getLoopForCwd } from './getloop.js';
import { buildTaskDelivery } from './wait.js';

/**
 * 预览一条任务的交付载荷。
 *
 * @param {object} p
 * @param {object} p.task        任务行（库存形状；草稿由调用方合成 { id:0, text }）
 * @param {string} [p.cwd]       等待方目录（决定组上下文与项目级「持续 get」）
 * @param {string} [p.key]       主题 key（任务级 timegoal 寻址用）
 * @param {string} [p.summary]   现状（模板占位符 {{summary}}）
 * @param {object} [p.params]    外部参数（与 --param 同语义）
 * @returns {Promise<object>} { task, instruction, coversBody, segments, getLoop, switches }
 */
export async function previewTaskDelivery({ task, cwd, key, summary, params } = {}) {
  const settings = (await getSettings().catch(() => null)) || {};
  const segments = [];
  const delivery = await buildTaskDelivery(task, settings.taskSuffix, {
    source: 'local',
    summary: summary || '',
    cwd,
    name: '',
    topicKey: key,
    params: params || {},
    preview: true,
    trace: segments,
  });

  const previewTask = delivery.task || task;
  let instruction = delivery.instruction || '';

  // 项目级「持续 get」模板：与 tasktool/get.js 的叠加口径一致（只在开启时出现）
  const loop = await getLoopForCwd(cwd).catch(() => ({ enabled: false }));
  let getLoopText = '';
  if (loop.enabled) {
    const tpl = loop.template || DEFAULT_GET_LOOP_TEMPLATE;
    try {
      if (hasTemplateMarkers(tpl)) {
        getLoopText = renderInstruction(tpl, {
          task: previewTask ? { id: previewTask.id, text: String(previewTask.text || '') } : null,
          source: 'local',
          summary: summary || '',
          cwd: cwd || '',
          name: '',
          goal: null,
        });
      }
    } catch {
      getLoopText = '';
    }
  }
  if (getLoopText) {
    instruction = instruction ? `${instruction}\n\n${getLoopText}` : getLoopText;
    segments.push({ id: 'getloop', label: '持续 get 模板（项目级）', text: getLoopText });
  }

  const suffixList = settings.taskSuffixList || [];
  const ackList = settings.ackPromptList || [];
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
      customTemplate: !!(loop.template && loop.template.trim()),
    },
    switches: {
      suffix: { on: suffixList.length > 0, count: suffixList.length },
      ack: { on: ackList.length > 0, count: ackList.length },
      deliveryTemplate: { custom: !!(settings.deliveryTemplate || '').trim() },
      attachTemplate: { custom: !!(settings.attachTemplate || '').trim() },
      attachments: delivery.attachmentsSync ? { synced: delivery.attachmentsSync } : null,
    },
  };
}
