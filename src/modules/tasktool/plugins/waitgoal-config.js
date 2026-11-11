// tasktool/getloop.js —— 项目级「持续 get」（waitgoal）配置的读取。
//
// 落点：repos.json 的 repo 记录字段 getLoop = { enabled, waitMinutes, template }。
// template 自 v0.14 起存 string[]（多条「继续 get」指令，交付时按空行拼接；
// 旧 string 单条读入时整体迁为一列）。
// 「项目」在本仓的正式身份就是 dev 仓库登记（cwd 对得上仓库路径即命中）；
// repos.json 的 loadStore/mutateStore 对 repo 对象上的额外字段原样保留，无需升版。
//
// 语义开关（todo.md 的原文口径）：
//   默认 get 就直接 get（没任务立即空手而回，不阻塞）；
//   项目打开这个设置后 → 无任务自动唤起阻塞等待（打开页面 + 配置的分钟数），
//   且交付文本封装「不断调用 get，直到 get 超时」的模板（提示词增强，基于项目）。
//
// repos 在模块互依禁列里 → 动态 import（与 localtask→timegoal 探针同一惯例）。
import { badInput } from '../../../core/errors.js';
import { DEFAULT_GETLOOP_INSTRUCTION } from '../../../shared/prompt-blocks.js';

// 持续 get 内文的默认文案：**唯一来源在共享层**（src/shared/prompt-blocks.js），
// 前端「持续 get」配置弹窗也从那里取——此前前端另存了一份副本，两边文案会悄悄分叉。
export const DEFAULT_GET_LOOP_TEMPLATE = DEFAULT_GETLOOP_INSTRUCTION;

export const GET_LOOP_DEFAULT_MINUTES = 10; // 阻塞窗口默认 10 分钟（上限仍受 wait 的 600s 夹制）

const MAX_LOOP_TEMPLATES = 10; // 模板条数上限（多条按空行拼接后统一渲染；与回调提示词同规则）
const MAX_LOOP_TEMPLATE_LEN = 2000; // 单条长度上限

/**
 * 把项目的持续 get 模板归一成**一段可渲染的文本**。
 *
 * ⚠️ 这里必须显式拼接：落库形态是 string[]（v0.14 起多条），而渲染器
 * renderInstruction 会 `String(template)`——数组直接传进去会变成逗号相连
 * （'A,B'），不是设计里说的「按空行拼接」。多条时这里统一用空行分隔。
 *
 * @param {{ enabled?: boolean; template?: string[] | string }} loop 项目级 getLoop 配置
 * @returns {string} 可渲染的模板文本；未开启时返回空串
 */
export function getLoopInstruction(loop) {
  if (!loop || !loop.enabled) return '';
  const raw = loop.template;
  const list = Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw];
  const joined = list
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  return joined || DEFAULT_GET_LOOP_TEMPLATE;
}

let reposMod = null;
async function reposStore() {
  if (!reposMod) reposMod = await import('../../repos/service.js');
  return reposMod;
}

// 持续 get 模板**列表**归一化（v0.14 起多条，落库形态 string[]）：
// 接受 string（旧单条，整体算一条、不拆段）或 string[]；逐条 trim、空条丢弃、
// 单条超长截断、条数超上限截断。与 localtask 的 clampTaskSuffixList 同一规则。
export function clampLoopTemplateList(v) {
  if (v === undefined || v === null) return [];
  const raw = Array.isArray(v) ? v : [v];
  const list = [];
  for (const item of raw) {
    let s = String(item ?? '').trim();
    if (!s) continue;
    if (s.length > MAX_LOOP_TEMPLATE_LEN) s = s.slice(0, MAX_LOOP_TEMPLATE_LEN);
    list.push(s);
    if (list.length >= MAX_LOOP_TEMPLATES) break;
  }
  return list;
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
  if (raw.template !== undefined) out.template = clampLoopTemplateList(raw.template);
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
    const templateList = clampLoopTemplateList(loop.template);
    return {
      enabled: true,
      waitMinutes: minutes,
      // template 是多条按空行拼接的**合并串**（get.js 直接分流渲染；空 = 用默认模板）；
      // templateList 是 canonical 列表（UI 按条编辑用）。
      template: templateList.join('\n\n'),
      templateList,
    };
  } catch {
    return { enabled: false }; // 仓库登记坏了绝不拖垮 get
  }
}
