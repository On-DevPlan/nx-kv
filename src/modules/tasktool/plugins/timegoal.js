// timegoal —— workflow 级消费 goal（唯一落点：契约类 + store 同目录）
import { BasePlugin, definePlugin } from './base.js';

export * from './timegoal-store.js';

class TimeGoalPlugin extends BasePlugin {
  static id = 'timegoal';
  static scope = 'workflow';

  onBind(_ctx, config = {}) {
    const minutes = Number(config.silentMinutes ?? config.minutes ?? config.waitMinutes);
    if (minutes != null && Number.isFinite(minutes) && minutes <= 0) {
      throw new Error('timegoal silent window must be > 0');
    }
    return {
      silentMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 3,
    };
  }

  async *onGet(ctx = {}, config = {}) {
    const silentMinutes = Number(config.silentMinutes) || 3;
    const silentMs = Math.min(Math.max(silentMinutes, 0.05), 60) * 60_000;
    const inner =
      typeof config.inner === 'function'
        ? config.inner
        : typeof ctx.env?.inner === 'function'
          ? ctx.env.inner
          : null;
    if (!inner) return;

    let lastYield = Date.now();
    while (!ctx.signal?.aborted) {
      if (Date.now() - lastYield >= silentMs) return;
      let got = false;
      for await (const item of inner()) {
        if (ctx.signal?.aborted) return;
        got = true;
        lastYield = Date.now();
        yield item;
      }
      if (!got) {
        await new Promise((r) => setTimeout(r, 50));
        if (Date.now() - lastYield >= silentMs) return;
      }
    }
  }
}

const instance = definePlugin(TimeGoalPlugin);
export default instance;
export { TimeGoalPlugin };
