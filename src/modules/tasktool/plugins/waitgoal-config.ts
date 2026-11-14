// tasktool/getloop.js —— 项目级「持续 get」（waitgoal）配置的读取。
//
// 落点：repos.json 的 repo 记录字段 getLoop = { enabled, waitMinutes }。
// **#182 起仓库级配置只剩「开关 + 阻塞分钟」**：交付里那段「继续 get」的**文案**
// 统一由 设置 → 提示词模板 → 持续 get 区块提供（默认值即 src/shared/prompt-blocks.ts
// 的 DEFAULT_GETLOOP_TEMPLATE）。此前这里还存一份 repo 级 template（v0.14 起 string[]），
// 与全局模板两处各写一遍必然漂移——那个口子已下线；老数据里的 template 字段
// 读入时一律忽略，下次写回 getLoop 时自然被 sanitizeGetLoop 丢掉。
//
// 「项目」在本仓的正式身份就是 dev 仓库登记（cwd 对得上仓库路径即命中）；
// repos.json 的 loadStore/mutateStore 对 repo 对象上的额外字段原样保留，无需升版。
//
// 语义开关（todo.md 的原文口径）：
//   默认 get 就直接 get（没任务立即空手而回，不阻塞）；
//   项目打开这个设置后 → 无任务自动唤起阻塞等待（打开页面 + 配置的分钟数），
//   且交付文本带「不断调用 get，直到 get 超时」那段指令（提示词增强，文案见全局区块）。
//
// repos 在模块互依禁列里 → 动态 import（与 localtask→timegoal 探针同一惯例）。
import { badInput } from '../../../core/errors.js';
import { DEFAULT_GETLOOP_INSTRUCTION } from '../../../shared/prompt-blocks.js';

// 持续 get 内文的默认文案：**唯一来源在共享层**（src/shared/prompt-blocks.js），
// 全局「提示词模板 → 持续 get」区块的内置模板用的就是同一份。
export const DEFAULT_GET_LOOP_TEMPLATE = DEFAULT_GETLOOP_INSTRUCTION;

export const GET_LOOP_DEFAULT_MINUTES = 10; // 阻塞窗口默认 10 分钟（上限仍受 wait 的 600s 夹制）

/** getLoopForCwd 返回的项目级配置形态（#182 起没有 template：文案归全局区块）。 */
export interface GetLoopState {
  enabled: boolean;
  waitMinutes?: number;
}

/**
 * 项目开启「持续 get」→ 交出那段循环指令（交给交付编排当 getloop 区块的内文）。
 *
 * #182 起**不再读仓库里的自定义模板**：文案只有共享层那一份，用户要改就到
 * 设置 → 提示词模板 → 持续 get 区块改（那里是唯一出口）。
 *
 * @param loop 项目级 getLoop 配置
 * @returns 可渲染的模板文本；未开启时返回空串（该区块整段不出现）
 */
export function getLoopInstruction(loop: { enabled?: unknown } | null | undefined): string {
  if (!loop || !loop.enabled) return '';
  return DEFAULT_GET_LOOP_TEMPLATE;
}

let reposMod: any = null;
async function reposStore(): Promise<any> {
  if (!reposMod) reposMod = await import('../../repos/service.js');
  return reposMod;
}

/**
 * repo update --get-loop* 的落库校验：null/false = 关闭清除；true = 开（默认分钟）。
 *
 * 只认 `{ enabled, waitMinutes }`：#182 起 `template` 不在契约里，传了也忽略
 * （老数据带着它进来时同样被剥掉，等于顺手做了一次清理）。
 */
export function sanitizeGetLoop(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (raw === true) return { enabled: true };
  if (typeof raw !== 'object') throw badInput('getLoop 必须是 { enabled, waitMinutes? }');
  const decl = raw as Record<string, any>;
  const out: Record<string, unknown> = {};
  if (decl.enabled !== undefined) out.enabled = decl.enabled === true || decl.enabled === 'on' || decl.enabled === 'true';
  const n = Number(decl.waitMinutes);
  // #112：0 是合法值（= get 没任务时不阻塞，立即返回 timeout）；只挡负数与非数字
  if (decl.waitMinutes !== undefined && decl.waitMinutes !== null && decl.waitMinutes !== '' && Number.isFinite(n) && n >= 0) {
    out.waitMinutes = Math.min(Math.floor(n), 600);
  }
  if (!Object.keys(out).length) return null;
  return out;
}

/** 按工作目录读项目级 getLoop；目录未登记 / 未开启 → { enabled:false }。读取失败同样降级。 */
export async function getLoopForCwd(cwd: unknown): Promise<GetLoopState> {
  try {
    const { loadStore, normalizePathKey } = await reposStore();
    const s = await loadStore();
    const k = normalizePathKey(cwd);
    const repo = k ? s.repos.find((r: any) => normalizePathKey(r.path) === k) : null;
    const loop = repo && repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
    if (!loop || !loop.enabled) return { enabled: false };
    // #112：显式 0 是合法值（= get 没任务时不阻塞，立即 timeout）；只有字段缺失 /
    // 非数字时才回落到默认 10 分钟（老数据兼容）。
    const rawMinutes = loop.waitMinutes;
    const n = rawMinutes === undefined || rawMinutes === null ? NaN : Number(rawMinutes);
    const minutes = Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 600) : GET_LOOP_DEFAULT_MINUTES;
    return { enabled: true, waitMinutes: minutes };
  } catch {
    return { enabled: false }; // 仓库登记坏了绝不拖垮 get
  }
}
