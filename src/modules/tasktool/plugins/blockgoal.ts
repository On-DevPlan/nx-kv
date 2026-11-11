// blockgoal —— 控制屏障（scope=control，onSchedule）
import { BasePlugin, definePlugin, type PluginContext } from './base.js';
import type { WorkflowSnapshot } from '../../../core/workflow/types.js';

export function isBarrierOpen(_snap: WorkflowSnapshot | undefined | null, nodeId: unknown, node?: any): boolean {
  const n =
    node ||
    (_snap?.nodes || []).find((x) => String(x.id) === String(nodeId));
  return !!n && n.state === 'success';
}

class BlockGoalPlugin extends BasePlugin {
  static override id = 'blockgoal';
  static override scope = 'control' as const;

  override onSchedule(ctx: PluginContext): Record<string, unknown> {
    if (!ctx?.snapshot || ctx.nodeId == null) return { open: false };
    return { open: isBarrierOpen(ctx.snapshot, ctx.nodeId) };
  }
}

const instance = definePlugin(BlockGoalPlugin);
export default instance;
export { BlockGoalPlugin };
