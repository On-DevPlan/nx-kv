// waitgoal —— 节点级消费 goal（唯一落点：契约类 + 配置同目录）
import { BasePlugin, definePlugin } from './base.js';
import {
  GET_LOOP_DEFAULT_MINUTES,
  sanitizeGetLoop,
  getLoopForCwd,
  DEFAULT_GET_LOOP_TEMPLATE,
  clampLoopTemplateList,
} from './waitgoal-config.js';

export {
  GET_LOOP_DEFAULT_MINUTES,
  sanitizeGetLoop,
  getLoopForCwd,
  DEFAULT_GET_LOOP_TEMPLATE,
  clampLoopTemplateList,
};

class WaitGoalPlugin extends BasePlugin {
  static id = 'waitgoal';
  static scope = 'node';

  onBind(_ctx, config = {}) {
    const minutes = Number(config.waitMinutes ?? config.minutes);
    if (minutes != null && Number.isFinite(minutes) && minutes <= 0) {
      throw new Error('waitgoal.waitMinutes must be > 0');
    }
    return {
      waitMinutes:
        Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : GET_LOOP_DEFAULT_MINUTES,
    };
  }

  async *onGet(ctx = {}, config = {}) {
    const waitMinutes = Number(config.waitMinutes) || GET_LOOP_DEFAULT_MINUTES;
    const timeoutMs = Math.min(Math.max(waitMinutes, 0.05), 10) * 60_000;
    const pull =
      typeof config.pull === 'function'
        ? config.pull
        : typeof ctx.env?.pull === 'function'
          ? ctx.env.pull
          : async () => null;
    const deadline = Date.now() + timeoutMs;
    const signal = ctx.signal;

    while (Date.now() < deadline) {
      if (signal?.aborted) return;
      const item = await pull();
      if (item != null) {
        yield item;
        return;
      }
      await sleep(Math.min(200, deadline - Date.now()), signal);
    }
  }
}

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

const instance = definePlugin(WaitGoalPlugin);
export default instance;
export { WaitGoalPlugin };
