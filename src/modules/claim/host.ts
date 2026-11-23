// claim/host.ts —— 交付宿主：领域取数 → Supply → promptplug 的 assembleDelivery。
//
// #227 重构：从 wait.ts 拆出。wait.ts 只剩阻塞编排（跨进程轮询 / goal 到点收尾 /
// 面板随行），本文件专管「交付一条任务时要把哪些领域数据取齐」：
//   ① 附件标注（annotateTaskDelivery → attachTemplateCtx）
//   ② 任务级 timegoal 起表（领取即计时；preview 走只读版）
//   ③ 组上下文（readGroupContext，按正文 frontmatter 的 board 决定组材料）
//   ④ 目录级 goal 上下文（readGoalCtx）+ 时间运算字段补齐（enrichGoalTiming）
//   ⑤ 队列余量（pendingQueueInfo）
// 之后把数据装进 DeliveryHostData，调 promptplug/delivery.ts 的 assembleDelivery
// 完成组装——模板正文、变量、三链合并、渲染全部在 promptplug。
// 任何异常都降级为「只回任务」——wait 绝不能因渲染挂掉（fail-open 纪律）。
//
// preview / trace（任务 #65「预览 get 提示词」）：
//   preview=true → **零副作用**：不启动任务级 timegoal 计时、不写库、不领取；
//     timegoal 的 check 指令用声明现算（与真实领取同一份）。其余渲染路径与真实领取
//     完全同一条代码，所以预览出来的字符串就是 agent 会拿到的那一份。
//   trace=[]     → 按顺序记下每一段的来源（谁贡献的、开关是否开着），供面板展示
//     「这段是哪来的」。真实领取不传 trace，行为与改造前逐字节一致。
import { formatDuration, formatGoalTiming } from '../../core/instruction-template.js';
import { parseFrontmatter } from '../../shared/frontmatter.js';
import { isGlobalKey, pendingQueueInfo } from '../localtask/service.js';
import { assembleDelivery, type AssembledDelivery } from './assemble.js';
import { annotateTaskDelivery, attachTemplateCtx } from '../localtask/ops/attach.js';
import { readGroupContext } from './groupctx.js';
import { ensureTaskGoal, previewTaskGoal } from '../goals/taskgoal.js';
import * as timegoal from '../goals/timegoal.js';

export interface DeliveryOptions {
  source?: string;
  summary?: unknown;
  cwd?: unknown;
  name?: unknown;
  topicKey?: unknown;
  params?: Record<string, string>;
  preview?: boolean;
  trace?: import('../promptplug/compose.js').RenderTraceEntry[];
  getLoopEnabled?: boolean;
  getLoopWaitMinutes?: number;
}

// 「YYYY-MM-DD HH:mm:ss」→ epoch ms（任务级 goal 的起点 = consumedAt）；解析不了返回 NaN
function parseStampMs(v: unknown): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(v || ''));
  if (!m) return NaN;
  return new Date(Number(m?.[1]), Number(m?.[2]) - 1, Number(m?.[3]), Number(m?.[4]), Number(m?.[5]), Number(m?.[6])).getTime();
}

// goal 上下文的**时间运算字段**统一在这里补齐（任务 #82：模板层要能拿剩余/超时做运算，
// 不能只有人话的 remainingHuman）。目录级 show 自带 reached/remainingSec/overtimeSec；
// 任务级只有 deadline 戳——同式解析补算。缺哪个补哪个，已有的不覆盖。
export function enrichGoalTiming(g: any): any {
  if (!g) return g;
  let { remainingSec, overtimeSec, reached } = g;
  remainingSec = Number(remainingSec);
  overtimeSec = Number(overtimeSec);
  if (!Number.isFinite(remainingSec) && !Number.isFinite(overtimeSec)) {
    const ms = parseStampMs(g.deadline);
    if (Number.isFinite(ms)) {
      const diff = Math.round((ms - Date.now()) / 1000);
      remainingSec = diff >= 0 ? diff : 0;
      overtimeSec = diff >= 0 ? 0 : -diff;
    }
  }
  if (reached === undefined) {
    if (Number.isFinite(overtimeSec)) reached = overtimeSec > 0;
    else if (Number.isFinite(remainingSec)) reached = remainingSec <= 0;
  }
  if (Number.isFinite(remainingSec)) {
    g.remainingSec = remainingSec;
    g.remainingMin = Math.ceil(remainingSec / 60);
  }
  if (Number.isFinite(overtimeSec)) g.overtimeSec = overtimeSec;
  if (reached !== undefined) g.reached = reached;
  // 任务 #87：模板里要能直接写「持续 {{goal.durationHuman}}」——人话时长统一在这里补。
  if (Number.isFinite(Number(g.durationSec)) && Number(g.durationSec) > 0) {
    g.durationHuman = g.durationHuman || formatDuration(Number(g.durationSec));
  }
  if (Number.isFinite(Number(g.elapsedSec))) {
    g.elapsedHuman = g.elapsedHuman || formatDuration(Number(g.elapsedSec));
  }
  return g;
}

// get **返回时刻**的目标上下文（渲染 instruction 用）。fail-open：加载失败 /
// 读不到 / 没目标 / 出错 → null，instruction 照常渲染（goal 段被整段丢弃）。
// 绝不写盘：showTimegoal 走 loadRecycledStore({persist:false})——timegoals.json
// 字节数不变，goal-expiry 单测字节比对钉着。
async function readGoalCtx(cwd: unknown): Promise<Record<string, any> | null> {
  if (!cwd || isGlobalKey(cwd)) return null; // cwd 是路径，isGlobalKey 恒 false——纯防御
  try {
    const show = await timegoal.showTimegoal({ cwd });
    if (!show || !show.hasGoal) return null;
    const g = show.goal || {};
    return {
      name: g.name || show.name || '',
      deadline: g.deadline || '',
      prompt: g.prompt || '',
      reached: !!show.reached,
      remainingSec: show.remainingSec,
      overtimeSec: show.overtimeSec,
      remainingHuman: formatGoalTiming({
        reached: show.reached,
        remainingSec: show.remainingSec,
        overtimeSec: show.overtimeSec,
      }),
    };
  } catch {
    return null;
  }
}

// 组装 get 返回的任务载荷 + 指令。**单一路径**：
//   所有段落（上下文 / 附件 / 时间目标 / ack / 持续 get）一律进返回载荷的
//   instruction 字段；task.text 始终是库存原文，绝不把系统提示词拼进正文。
//   旧 rule 区块已删除：done 指令与收尾要求统一由 ack 区块承载。
export async function buildTaskDelivery(
  task: any,
  { source, summary, cwd, name, topicKey, params, preview = false, trace, getLoopEnabled = false, getLoopWaitMinutes = 0 }: DeliveryOptions = {},
): Promise<Record<string, any>> {
  // 附件标注（任务 #15：正文里的 ![名](fileId) 嵌入 → 附件清单 + 本地路径）。
  // fail-open：标注失败绝不拖垮交付；正文没有引用时 annotateTaskDelivery 返回
  // null，载荷与改造前**逐字节一致**（与 localtask 读任务的同一条纪律）。
  let att: any = null;
  try {
    // inlineDocs（#162）：文档资料绑定（role=doc）随交付带全文——只读盘（自有树 /
    // 绑定闭包），预览同样安全；读不到内容留空，不阻断交付。
    const a = await annotateTaskDelivery(task, { topicKey, inlineDocs: true });
    if (a) {
      task = a.task;
      att = a;
    }
  } catch {
    /* 标注失败照常交付（agent 还能从正文里的嵌入自行处理） */
  }
  try {
    // 任务级 timegoal（发布带 --duration）：**领取即计时**——这里起表（幂等），
    // goal 上下文换成任务级（prompt = check 指令，固化进 timegoal 存储，之后每轮原文回显）。
    // 目录级 goal 仍作兜底：任务没带时间目标时，渲染等待方目录的目标状态。
    let taskGoalCtx: any = null;
    if (task && task.timegoal && topicKey) {
      const title = (String(task.text || '')
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) || `任务 #${task.id}`).slice(0, 40);
      // 预览走只读版本：同一份 check 指令文本，但不落盘、不起表
      taskGoalCtx = preview
        ? await previewTaskGoal({ topicKey, taskId: task.id, cwd, name: title, timegoal: task.timegoal, text: task.text })
        : await ensureTaskGoal({
            topicKey,
            taskId: task.id,
            cwd,
            name: title,
            text: task.text,
            timegoal: task.timegoal,
            startedAtMs: parseStampMs(task.consumedAt) || undefined,
          });
    }
    const goal = enrichGoalTiming(taskGoalCtx || (await readGoalCtx(cwd)));

    // 项目组上下文（组概念 + 本项目位置 + 兄弟成员 + 参考文件地址）：只进 instruction。
    // #64 作用域：组材料只挂**组任务**（正文 frontmatter 带 board）；单 repo 主题里
    // 提交的纯项目任务只带项目介绍，不把所属组的材料挂进来。
    const boardMark = String(parseFrontmatter(String((task && task.text) || '')).board || '').trim();
    const groupCtx = await readGroupContext(cwd as string, { board: boardMark });

    // ── 插件化组装（promptplug）：宿主完成领域取数，插件 data() 做同步变换 ──
    // 任务级 goal → 完整 check 指令；目录级 goal → 状态行（二者都进 timecheck 段）。
    const goalCheck = taskGoalCtx ? taskGoalCtx.prompt : null;
    const goalStatus = !taskGoalCtx && goal
      ? `〔时间目标「${goal.name || ''}」${goal.remainingHuman || ''}〕`
      : null;
    const goalCtx = goal
      ? {
          ...goal,
          // 任务 #87：goal.extra（附加要求，领取后可动态改）与 goalKey 供模板直接引用
          extra: taskGoalCtx ? taskGoalCtx.extra || '' : '',
          goalKey: taskGoalCtx ? taskGoalCtx.goalKey || '' : '',
          check: goalCheck || '',
          statusLine: goalStatus || '',
        }
      : null;
    const attach = att ? attachTemplateCtx(att.task.attachments).attach : null;

    // ext（队列余量）：同主题还有多少待领取任务 + 标题。现算（同主题一次读取）；
    // 读取失败不阻断领取：按缺失处理，并把原因记进 renderWarnings。
    let queueInfo: { topic: string; count: number; list: { id: number; title: string }[] } | null = null;
    const hostWarnings: import('../promptplug/compose.js').RenderWarning[] = [];
    try {
      const q = await pendingQueueInfo(topicKey as string, task && task.id);
      if (q && q.count > 0) queueInfo = { topic: q.topic, count: q.count, list: q.list };
    } catch (e) {
      hostWarnings.push({
        block: 'ext',
        label: '待领取队列（ext）',
        message: String((e as Error).message || e).replace(/\s+/g, ' ').trim(),
      });
    }

    const delivery: AssembledDelivery = await assembleDelivery({
      task,
      attachCtx: attach,
      goalCtx,
      groupCtx,
      queueInfo,
      getLoopEnabled,
      getLoopWaitMinutes,
      params,
      source: source || '',
      summary,
      cwd,
      name,
      hostWarnings,
      trace,
    });
    const warnField = delivery.renderWarnings.length ? { renderWarnings: delivery.renderWarnings } : {};
    if (!delivery.instruction) {
      return { task, ...warnField };
    }
    return {
      task,
      instruction: delivery.instruction,
      coversBody: delivery.coversBody,
      ...warnField,
    };
  } catch {
    return { task };
  }
}
