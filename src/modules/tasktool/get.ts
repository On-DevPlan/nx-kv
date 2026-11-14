// tasktool/get.js —— 「领取任务」（localtask 的 get / waitgoal 语义）。
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
import { getLoopForCwd, getLoopInstruction, type GetLoopState } from './getloop.js';

export interface GetTaskOptions {
  cwd?: string;
  timeoutSec?: number;
  open?: boolean;
  params?: Record<string, string>;
  instant?: boolean;
}

export async function getTask({ cwd, timeoutSec, open = true, params, instant }: GetTaskOptions = {}): Promise<Record<string, any>> {
  const loop: GetLoopState = await getLoopForCwd(cwd);
  // 项目开启「持续 get」时，循环指令作为 getloop 区块随其余系统段一起由
  // buildTaskDelivery 统一编排（不再在 get 层后置拼接，避免同一份 instruction
  // 有两个拼装入口）。
  // #112（用户口径）：「阻塞 N 分钟」是 **get 命令自己**没任务时阻塞多久（服务端挂住
  // 请求，到点返回 timeout），不是让 agent 睡。窗口配 0 = 不阻塞，没活立即 timeout。
  const minutes = loop.enabled ? Number(loop.waitMinutes) || 0 : 0;
  // #123：显式 --timeout 就是「阻塞等这个上限」——不再要求项目先开「持续 get」。
  // 这样阻塞等待只有一条路（get + 参数），旧 localtask wait 收缩成兼容别名。
  const explicitWait = timeoutSec !== undefined && timeoutSec !== null && Number(timeoutSec) > 0;
  const r = await waitForTask({
    cwd,
    // 未开启持续 get → instant（waitForTask 内部忽略 timeout 直接快路径）；
    // 开启且窗口 >0 → 阻塞这么秒；窗口 = 0 → 同样走 instant（不阻塞）。
    // 显式 --timeout 仍最高优先；instant 显式给定时也最高优先
    // （HTTP 领取不允许挂住请求，见 action-lifecycle 的 claim 路由）。
    timeoutSec: timeoutSec ?? (minutes > 0 ? minutes * 60 : undefined),
    open,
    instant: instant === undefined ? (explicitWait ? false : !loop.enabled || minutes <= 0) : !!instant,
    params: params || {}, // 外部参数（平面扩展）进交付模板
    getLoopTpl: getLoopInstruction(loop),
    getLoopWaitMinutes: minutes,
  });
  if (r.status !== 'ok' || !r.task) return r;
  if (loop.enabled) r.getLoop = true; // 交付里带了持续 get 指令（调试/文档可辨）
  return r;
}
