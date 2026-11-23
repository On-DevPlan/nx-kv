// claim/assemble.ts —— 交付组装（assembleDelivery）：seed 构造 + 三链合并 + compose。
//
// 这是「一条交付提示词怎么拼出来」的**唯一实现**（#227 重构：原样从 claim/wait.ts
// 的 buildTaskDelivery 下半段收编进来）。宿主（claim/host.ts）完成领域取数
// （附件标注 / 时间目标起表 / 组上下文 / 队列余量）后，把取好的数据装进
// DeliveryHostData 交到这里；本文件不再碰任何业务模块——promptplug 不 import
// 其他模块的边界保持不变。
//
// #230 清理：原「getLoopTpl 预渲染 → data.getloop.text」残留链路已删——#182 起项目级
// template 口子下线，getloop 文案唯一真相是插件内置模板，本文件只给 enabled 开关与分钟数。
// 之所以收进 promptplug：组装配方（平面扩展的键保护 / 三链合并 / coversBody 判定）
// 是提示词域的语义，不是队列域的。
// 之前它埋在 wait.ts（阻塞编排文件）里，测试只能各自手工复刻（prompt-golden /
// delivery-template 两个测试都有「与 wait.ts 同构」的最小组装）——现在它们可以
// 直接调 assembleDelivery。
import { reorderRoundsForDelivery } from '../../shared/feedback-text.js';
import { compose, type RenderTraceEntry, type RenderWarning, type SegmentMeta } from '../promptplug/compose.js';
import { buildPlugins } from '../promptplug/factory.js';

/** compose 的分段元信息（面板「这段是哪来的」的展示标签），交付组装的固定清单。 */
export const DELIVERY_SEGMENTS: SegmentMeta[] = [
  { id: 'context', label: '组 / 项目上下文（模板）', traceId: 'delivery' },
  { id: 'attachment', label: '附件段（清单 / 本地路径）', traceId: 'attach' },
  { id: 'timegoal', label: '时间目标启动（介绍 / 每轮怎么做）', traceId: 'goal' },
  { id: 'doneguard', label: '完成门禁提示（timegoal）', traceId: 'doneguard' },
  { id: 'ext', label: '待领取队列（ext）', traceId: 'ext' },
  { id: 'ack', label: 'ack 完成总结提示词', traceId: 'ack' },
  { id: 'getloop', label: '持续 get 指令（项目级）', traceId: 'getloop' },
];

// 平面扩展的**内建键保护名单**：外部参数（--param k=v）顶层直达 {{k}}，
// 但不许覆盖 seed 的内建键（ctx 形状是插件 dataSchema 白名单的前提）。
const SEED_PROTECTED_KEYS = ['task', 'goal', 'cwd', 'source', 'summary', 'name', 'repo', 'group', 'refRepos', 'groups'];

/** 外部参数 → 平面扩展表（{{k}} 顶层直达；内建键被保护不被覆盖；{{params.k}} 永远可用）。 */
export function flatParamsOf(params?: Record<string, string>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (SEED_PROTECTED_KEYS.includes(k)) continue;
    flat[k] = v;
  }
  return flat;
}

/** 宿主取好的领域数据（取数细节见 claim/host.ts——本文件不做任何 IO）。 */
export interface DeliveryHostData {
  /** 标注后的任务行（id / text）；无任务 → null（指令段也照常渲染） */
  task: any | null;
  /** 附件段 ctx（attachTemplateCtx 产物）；无附件 → null */
  attachCtx: any | null;
  /** 最终 goal ctx（enrichGoalTiming + 任务级/目录级合并后）；无目标 → null */
  goalCtx: any | null;
  /** 组上下文（readGroupContext 产物）；非组任务 → null */
  groupCtx: any | null;
  /** 队列余量（pendingQueueInfo 产物，count>0 才给）；null → ext 段不出 */
  queueInfo: { topic: string; count: number; list: { id: number; title: string }[] } | null;
  /** 项目级「持续 get」开关（宿主从 waitgoal 配置读出）；false = 段不出 */
  getLoopEnabled?: boolean;
  /** 项目级阻塞窗口（分钟）：进 getloop 模板 ctx */
  getLoopWaitMinutes?: number;
  /** 外部参数（--param k=v 解析产物）：{{params.k}} + 平面扩展 {{k}} */
  params?: Record<string, string>;
  /** seed 原样透传的上下文键（保持 unknown：宿主传什么 seed 就是什么） */
  source?: unknown;
  summary?: unknown;
  cwd?: unknown;
  name?: unknown;
  /** 宿主侧告警（如 ext 读取失败），并入 renderWarnings（排在本文件告警之后） */
  hostWarnings?: RenderWarning[];
  /** 逐段来源追踪（面板预览用；真实领取不传） */
  trace?: RenderTraceEntry[];
}

export interface AssembledDelivery {
  /** 拼好的完整指令；空串 = 没有任何段输出（宿主按「只回任务」降级） */
  instruction: string;
  /** 任一模板含 {{task.text}} → 指令自包含任务正文（服务端判定，CLI 不做子串猜测） */
  coversBody: boolean;
  /** 渲染告警（段渲染失败但交付继续的口径），已并宿主告警 */
  renderWarnings: RenderWarning[];
}

/**
 * 组装一次交付提示词。**单一路径**：所有段落（上下文 / 附件 / 时间目标 / ack /
 * 持续 get / done 门禁）合并成一条 instruction；task.text 始终是库存原文，
 * 绝不把系统提示词拼进正文。
 *
 * 交付一次给全三条链（get → check → done，合并后按各段 order 全局排序）：
 * check（时间目标）与 done（完成门禁）没有独立的注入点——它们本来就是
 * 「领取时告诉 agent 每轮怎么检查、什么时候才能收口」，等 agent 真去 done 再给
 * 已经晚了；三者链内都是条件渲染，无数据即不出段。
 */
export async function assembleDelivery(host: DeliveryHostData): Promise<AssembledDelivery> {
  const {
    task,
    attachCtx: attach,
    goalCtx: goal,
    groupCtx,
    queueInfo,
    getLoopEnabled = false,
    getLoopWaitMinutes = 0,
    params,
    trace,
  } = host;
  const renderWarnings: RenderWarning[] = [];

  const flat = flatParamsOf(params);
  const seedCtx: Record<string, any> = {
    task: task ? { id: task.id, text: reorderRoundsForDelivery(String(task.text || '')) } : null,
    goal: goal ?? null,
    source: host.source || '',
    summary: host.summary || '',
    cwd: host.cwd || '',
    name: host.name || '',
    params: { ...(params || {}) },
    ...flat,
  };

  // #152：模板是插件类的内置正文（不再从 settings 解析）。
  // 宿主取数以 Supply 注入（惰性：不消费就不算）。
  const plugins = [
    ...buildPlugins('get', {
      groupCtx: () => groupCtx,
      attach: () => attach,
      queueInfo: () => queueInfo,
      enabled: () => !!getLoopEnabled,
      waitMinutes: () => Number(getLoopWaitMinutes) || 0,
    }),
    ...buildPlugins('check'),
    ...buildPlugins('done'),
  ];
  const full = await compose({
    plugins,
    groups: ['get', 'check', 'done'],
    seed: seedCtx,
    trace,
    segments: DELIVERY_SEGMENTS,
  });
  // coversBody = 本次交付链的任一模板含 {{task.text}}（instruction 自包含任务正文）。
  // 由服务端判定，避免 CLI 端做子串猜测。
  return {
    instruction: full,
    coversBody: plugins.some((p) => /\{\{\s*task\.text\s*\}\}/.test(p.get())),
    renderWarnings: [...renderWarnings, ...(host.hostWarnings || [])],
  };
}
