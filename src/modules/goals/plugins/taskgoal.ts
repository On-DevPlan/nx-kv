// taskgoal —— 节点级时长门（唯一落点：契约类 + store 同目录）
import { BasePlugin, definePlugin, type PluginContext } from './base.js';

export * from './taskgoal-store.js';

class TaskGoalPlugin extends BasePlugin {
  static override id = 'taskgoal';
  static override scope = 'node' as const;

  override onBind(_ctx: PluginContext, config: Record<string, unknown> = {}): Record<string, unknown> {
    return config && typeof config === 'object' ? { ...config } : {};
  }
}

const instance = definePlugin(TaskGoalPlugin);
export default instance;
export { TaskGoalPlugin };
