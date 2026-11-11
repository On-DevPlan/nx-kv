// 编排面板的任务/依赖纯逻辑：节点键、依赖 token 解析、待领取判定。
import { titleFromMd } from '../../modules/md/md-parse.js';
import { taskLabel } from '../../components/sidebar/model.js';
import type { LocalTask } from '../../types.js';

/** 依赖 token：同队列写数字 id，跨队列写 "topicKey:id"。 */
export type DepToken = number | string;

/**
 * 画布节点：队列任务 + 渲染所需的归属信息（topicKey/nodeKey/…）。
 * 任务本体来自 /api/localtasks（外部数据边界，故带索引签名），
 * blockBy / blocksFollowing / timegoal 是按需出现的字段。
 */
export interface DagNode extends LocalTask {
  blockBy?: DepToken[];
  blocksFollowing?: boolean;
  ready?: boolean;
  timegoal?: { duration?: string } | null;
  topicKey: string;
  topicCwd?: string;
  topicIsGlobal?: boolean;
  projectName?: string;
  nodeKey: string;
}

/** 画布坐标。 */
export interface DagPoint {
  x: number;
  y: number;
}

/** 节点摆位表（nodeKey → 画布坐标）。 */
export type DagPosMap = Map<string, DagPoint>;

/** 拉线预览态（渲染用：连线起点 + 当前指针位置）。 */
export interface LinkPreview {
  sourceId: string;
  x: number;
  y: number;
  cx: number;
  cy: number;
  overId: string | null;
  dragged: boolean;
}

/** 拖动节点：记下抓取点相对节点左上角的偏移。 */
export interface DagDragMode {
  kind: 'drag';
  id: string;
  ox: number;
  oy: number;
}

/** 拉线连边：起点口坐标 + 当前指针位置（sx/sy 是按下点，用于判「是否真的拖了」）。 */
export interface DagLinkMode {
  kind: 'link';
  sourceId: string;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  overId: string | null;
  dragged: boolean;
  sx: number;
  sy: number;
}

/**
 * 指针交互模式（全局监听读 ref）：拖动节点 / 拉线连边；null = 空闲。
 * 一个联合类型而非多个布尔，避免「既在拖又在连」这种非法组合。
 */
export type DagMode = DagDragMode | DagLinkMode | null;

/** 依赖解析结果：同队列（local）或跨队列（foreign）。 */
export type DepRef =
  | { kind: 'local'; id: number }
  | { kind: 'foreign'; key: string; id: number };

export function isAlive(t: LocalTask | null | undefined): boolean {
  return !!(t && !t.deletedAt && !t.migratedTo);
}

// 正判定：只有 pending 可领（与 shared/task-status.js 的 isPending 同口径）。
// 排除法时代「不认识的状态一律当可领」，会把已交付的任务画进待领取图里。
export function isPending(t: LocalTask | null | undefined): boolean {
  return isAlive(t) && t?.status === 'pending';
}

export function labelOf(t: LocalTask): string {
  return titleFromMd(t.text) || taskLabel(t) || `#${t.id}`;
}

export function nodeKeyOf(topicKey: string, id: number | string): string {
  return `${topicKey}:${Number(id)}`;
}

/** @returns {{ kind:'local', id:number } | { kind:'foreign', key:string, id:number } | null} */
export function parseDep(x: unknown): DepRef | null {
  if (typeof x === 'number' && Number.isFinite(x) && x > 0) return { kind: 'local', id: Math.trunc(x) };
  const s = String(x ?? '').trim();
  if (!s) return null;
  const m = /^([A-Za-z0-9_-]+):(\d+)$/.exec(s);
  // 正则命中即两个捕获组都在（noUncheckedIndexedAccess 下仍需逐个守卫）
  const key = m?.[1];
  const idStr = m?.[2];
  if (key && idStr) return { kind: 'foreign', key, id: Number(idStr) };
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n > 0) return { kind: 'local', id: n };
  }
  return null;
}

export function depToNodeKey(dep: unknown, ownerTopicKey: string): string | null {
  const ref = parseDep(dep);
  if (!ref) return null;
  if (ref.kind === 'foreign') return nodeKeyOf(ref.key, ref.id);
  return nodeKeyOf(ownerTopicKey, ref.id);
}

/** 连线落盘口径：同队列存数字 id，跨队列存 "topicKey:id"。 */
export function formatDepForTarget(
  sourceNode: { topicKey: string; id: number | string },
  targetTopicKey: string,
): DepToken {
  if (sourceNode.topicKey === targetTopicKey) return Number(sourceNode.id);
  return nodeKeyOf(sourceNode.topicKey, sourceNode.id);
}
