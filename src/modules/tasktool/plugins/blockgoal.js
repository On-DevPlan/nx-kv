// blockgoal —— 控制屏障（scope=control，onSchedule）
import { BasePlugin, definePlugin } from './base.js';

export function isBarrierOpen(_snap, nodeId, node) {
  const n =
    node ||
    (_snap?.nodes || []).find((x) => String(x.id) === String(nodeId));
  return !!n && n.state === 'success';
}

class BlockGoalPlugin extends BasePlugin {
  static id = 'blockgoal';
  static scope = 'control';

  onSchedule(ctx) {
    if (!ctx?.snapshot || ctx.nodeId == null) return { open: false };
    return { open: isBarrierOpen(ctx.snapshot, ctx.nodeId) };
  }
}

const instance = definePlugin(BlockGoalPlugin);
export default instance;
export { BlockGoalPlugin };
