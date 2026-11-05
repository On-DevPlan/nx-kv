// tasktool/get.js —— 「领取任务」（todo.md 的 get / waitgoal 语义）。
//
// 默认（项目未开启「持续 get」）：**直接 get**——队列有任务立即领；
// 没有立即空手而回（instant，不阻塞），agent 按「暂时没活」收尾本轮。
//
// 项目开启 getLoop（设置面板「项目级设置」里开）后升级为 waitgoal：
//   - 无任务 → 自动唤起：打开对应目录页面 + 阻塞窗口（项目配置的分钟数），
//     期间用户回填 → 阻塞调用直接领取；
//   - 领到任务的交付文本追加「不要结束，反复调用 get 直到超时」的项目模板
//     （提示词增强，基于项目；占位符见 core/instruction-template.js）。
//
// 与 wait 的分工：wait = 「本轮最后一步，等人接力」（kv-waittask 的循环契约，
// 唯一合法出口是 timeout）；get = 「领活」（kv-localget 的语义，项目开启持续
// get 后由系统负责把循环指令带进交付文本，agent 不用自己记）。
import { waitForTask } from './wait.js';
import { getLoopForCwd, DEFAULT_GET_LOOP_TEMPLATE } from './getloop.js';
import { hasTemplateMarkers, renderInstruction } from '../../core/instruction-template.js';

export async function getTask({ cwd, summary, timeoutSec, open = true, params } = {}) {
  const loop = await getLoopForCwd(cwd);
  const r = await waitForTask({
    cwd,
    summary,
    // 未开启持续 get → instant（waitForTask 内部忽略 timeout 直接快路径）；
    // 开启 → 阻塞窗口 = 项目配置分钟数（显式 --timeout 仍最高优先）。
    timeoutSec: timeoutSec ?? (loop.enabled ? loop.waitMinutes * 60 : undefined),
    open,
    instant: !loop.enabled,
    params: params || {}, // 外部参数（平面扩展）进交付模板
  });
  if (r.status !== 'ok' || !r.task) return r;

  // 项目模板叠加：领到任务时把「继续 get」的循环指令渲染进 instruction
  // （与收尾指令 suffix 并存：先 suffix 渲染，再追加项目模板段）。
  //
  // **只在项目开启了「持续 get」时才叠加**：默认形态是「直接 get」——
  // 队列空就立即空手而回（instant），再附一条「继续 get 直到超时」的指令等于
  // 让 agent 去追一个永远不会来的任务，也与本文件的语义注释相矛盾。
  const tpl = loop.enabled ? loop.template || DEFAULT_GET_LOOP_TEMPLATE : '';
  try {
    if (hasTemplateMarkers(tpl)) {
      const seg = renderInstruction(tpl, {
        task: r.task ? { id: r.task.id, text: String(r.task.text || '') } : null,
        source: r.source || 'local',
        summary: r.summary || '',
        cwd: r.cwd || '',
        name: r.name || '',
        goal: null,
      });
      if (seg) {
        r.instruction = r.instruction ? `${r.instruction}\n\n${seg}` : seg;
        r.getLoop = true; // 交付里带了持续 get 指令（调试/文档可辨）
      }
    }
  } catch {
    /* 模板渲染失败不拖垮领取 */
  }
  return r;
}
