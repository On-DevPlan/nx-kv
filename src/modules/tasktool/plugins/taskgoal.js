// taskgoal —— 节点级时长门（唯一落点：契约类 + store 同目录）
import { BasePlugin, definePlugin } from './base.js';

export * from './taskgoal-store.js';

class TaskGoalPlugin extends BasePlugin {
  static id = 'taskgoal';
  static scope = 'node';

  onBind(_ctx, config = {}) {
    return config && typeof config === 'object' ? { ...config } : {};
  }
}

const instance = definePlugin(TaskGoalPlugin);
export default instance;
export { TaskGoalPlugin };
