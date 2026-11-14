// 任务状态 → 展示映射（#121）：**全应用唯一的口径**，所有状态 tag / 单字徽标 /
// 色点都从这取。纯函数、无 JSX——可被 node:test 直接单测。
//
// 颜色语义（用户钦定，全局统一；CSS 类后缀 tstat-<tone> / cnt-<tone> / st-<tone> 同名）：
//   doing   = 蓝    —— 进行中（已领取、在干、待回填）
//   done    = 绿    —— 已完成（终态；旧文案「已交付」已废，见 #179）
//   pending = 浅灰  —— 待领取
//   gone    = 收口灰 —— 已取消 / 软删除 / 已迁移（不入三色，弱化展示）
//
// 状态判断走 shared/task-status.js 的**正判定**谓词（同构词表，前后端不分叉）。
// 注意 t.from 只是**来源标记**（云端迁入），不参与状态判断——此前 landing/
// 侧栏把 from 当「已领取」，云端迁入还没人领的任务会显示成在跑，是本次统一掉的分叉之一。
import {
  isClaimed,
  isDone,
  isCancelled,
  isPlan,
  STATUS_TAG,
} from '../../../../shared/task-status.js';
import type { TaskRowLike } from '../../../../shared/task-status.js';

/** 状态行：只读 status / deletedAt / migratedTo（shared 层已给出结构性子集，直接复用）。 */
export type StatusRow = TaskRowLike;

/** 四种语义色调（CSS 类后缀 tstat-<tone> 同名）。 */
export type StatusTone = 'gone' | 'done' | 'doing' | 'pending' | 'plan';

/**
 * 四种语义色调。不认识的 status 给中性灰（pending 色），文案由 statusLabel
 * 原样显示真值——与 shared/statusTag 的「不盖住真值」同一哲学。
 * @param {object} t 任务行（status / deletedAt / migratedTo / from）
 */
export function statusTone(t: StatusRow | null | undefined): StatusTone {
  if (!t || t.deletedAt || t.migratedTo) return 'gone';
  if (isDone(t)) return 'done';
  if (isClaimed(t)) return 'doing';
  if (isCancelled(t)) return 'gone';
  if (isPlan(t)) return 'plan';
  return 'pending';
}

/**
 * 展示文案：软删 / 迁出有专属文案，其余走同构词表（不认识的词原样返回）。
 * @param {object} t 任务行
 */
export function statusLabel(t: StatusRow | null | undefined): string {
  if (!t) return '';
  if (t.deletedAt) return '已删除';
  if (t.migratedTo) return '已迁移';
  const status = t.status;
  return STATUS_TAG[String(status ?? '')] || String(status ?? '');
}

/** 单字徽标（侧栏 / 队列表等窄处）：等 / 跑 / 完 / 档——随色调一起统一。 */
const TONE_SHORT: Record<StatusTone, string> = { pending: '等', doing: '跑', done: '完', gone: '档', plan: '草' };

/**
 * 单字徽标文案（窄处显示不下全称时用）。
 * @param {object} t 任务行
 */
export function statusShort(t: StatusRow | null | undefined): string {
  return TONE_SHORT[statusTone(t)] || '等';
}
