// tasktool/getloop.js —— 项目级「持续 get」（waitgoal）配置的读取。
//
// 落点：repos.json 的 repo 记录字段 getLoop = { enabled, waitMinutes, template }。
// 「项目」在本仓的正式身份就是 dev 仓库登记（cwd 对得上仓库路径即命中）；
// repos.json 的 loadStore/mutateStore 对 repo 对象上的额外字段原样保留，无需升版。
//
// 语义开关（todo.md 的原文口径）：
//   默认 get 就直接 get（没任务立即空手而回，不阻塞）；
//   项目打开这个设置后 → 无任务自动唤起阻塞等待（打开页面 + 配置的分钟数），
//   且交付文本封装「不断调用 get，直到 get 超时」的模板（提示词增强，基于项目）。
//
// repos 在模块互依禁列里 → 动态 import（与 localtask→timegoal 探针同一惯例）。
import { badInput } from '../../core/errors.js';

export const DEFAULT_GET_LOOP_TEMPLATE =
  '{{#task}}不要直接结束本轮：完成上面的任务（{{task.id}}）之后，继续调用 nx-kv localtask get（带 --summary 当前现状）领取下一条任务，直到 get 返回 timeout 为止。{{/task}}';

export const GET_LOOP_DEFAULT_MINUTES = 10; // 阻塞窗口默认 10 分钟（上限仍受 wait 的 600s 夹制）

let reposMod = null;
async function reposStore() {
  if (!reposMod) reposMod = await import('../repos/service.js');
  return reposMod;
}

/** repo update --get-loop* 的落库校验：null/false = 关闭清除；true = 开（默认模板/默认分钟）。 */
export function sanitizeGetLoop(raw) {
  if (raw === undefined || raw === null || raw === false) return null;
  if (raw === true) return { enabled: true };
  if (typeof raw !== 'object') throw badInput('getLoop 必须是 { enabled, waitMinutes?, template? }');
  const out = {};
  if (raw.enabled !== undefined) out.enabled = raw.enabled === true || raw.enabled === 'on' || raw.enabled === 'true';
  const n = Number(raw.waitMinutes);
  if (Number.isFinite(n) && n > 0) out.waitMinutes = Math.min(Math.floor(n), 600);
  if (raw.template !== undefined) out.template = String(raw.template).slice(0, 2000);
  if (!Object.keys(out).length) return null;
  return out;
}

/** 按工作目录读项目级 getLoop；目录未登记 / 未开启 → { enabled:false }。读取失败同样降级。 */
export async function getLoopForCwd(cwd) {
  try {
    const { loadStore, normalizePathKey } = await reposStore();
    const s = await loadStore();
    const k = normalizePathKey(cwd);
    const repo = k ? s.repos.find((r) => normalizePathKey(r.path) === k) : null;
    const loop = repo && repo.getLoop && typeof repo.getLoop === 'object' ? repo.getLoop : null;
    if (!loop || !loop.enabled) return { enabled: false };
    const minutes = Number(loop.waitMinutes) > 0 ? Math.min(Math.floor(Number(loop.waitMinutes)), 600) : GET_LOOP_DEFAULT_MINUTES;
    return {
      enabled: true,
      waitMinutes: minutes,
      template: String(loop.template || DEFAULT_GET_LOOP_TEMPLATE),
    };
  } catch {
    return { enabled: false }; // 仓库登记坏了绝不拖垮 get
  }
}
