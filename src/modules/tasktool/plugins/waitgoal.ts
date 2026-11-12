// waitgoal —— 节点级消费 goal（唯一落点：契约类 + 配置同目录）
import { BasePlugin, definePlugin, type PluginContext } from './base.js';
import {
  GET_LOOP_DEFAULT_MINUTES,
  sanitizeGetLoop,
  getLoopForCwd,
  getLoopInstruction,
  DEFAULT_GET_LOOP_TEMPLATE,
} from './waitgoal-config.js';

export {
  GET_LOOP_DEFAULT_MINUTES,
  sanitizeGetLoop,
  getLoopForCwd,
  getLoopInstruction,
  DEFAULT_GET_LOOP_TEMPLATE,
};

class WaitGoalPlugin extends BasePlugin {
  static override id = 'waitgoal';
  static override scope = 'node' as const;

  override onBind(_ctx: PluginContext, config: Record<string, unknown> = {}): Record<string, unknown> {
    const minutes = Number(config.waitMinutes ?? config.minutes);
    if (minutes != null && Number.isFinite(minutes) && minutes <= 0) {
      throw new Error('waitgoal.waitMinutes must be > 0');
    }
    return {
      waitMinutes:
        Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : GET_LOOP_DEFAULT_MINUTES,
    };
  }

  override async *onGet(ctx: PluginContext = {} as PluginContext, config: Record<string, unknown> = {}): AsyncGenerator<unknown, void, unknown> {
    const waitMinutes = Number(config.waitMinutes) || GET_LOOP_DEFAULT_MINUTES;
    const timeoutMs = Math.min(Math.max(waitMinutes, 0.05), 10) * 60_000;
    const pull =
      typeof config.pull === 'function'
        ? (config.pull as () => Promise<unknown | null>)
        : typeof ctx.env?.pull === 'function'
          ? (ctx.env.pull as () => Promise<unknown | null>)
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
