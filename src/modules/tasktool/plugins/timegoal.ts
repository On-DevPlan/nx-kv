// timegoal —— workflow 级消费 goal（唯一落点：契约类 + store 同目录）
import { BasePlugin, definePlugin, type PluginContext } from './base.js';

export * from './timegoal-store.js';

class TimeGoalPlugin extends BasePlugin {
  static override id = 'timegoal';
  static override scope = 'workflow' as const;

  override onBind(_ctx: PluginContext, config: Record<string, unknown> = {}): Record<string, unknown> {
    const minutes = Number(config.silentMinutes ?? config.minutes ?? config.waitMinutes);
    if (minutes != null && Number.isFinite(minutes) && minutes <= 0) {
      throw new Error('timegoal silent window must be > 0');
    }
    return {
      silentMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 3,
    };
  }

  override async *onGet(ctx: PluginContext = {} as PluginContext, config: Record<string, unknown> = {}): AsyncGenerator<unknown, void, unknown> {
    const silentMinutes = Number(config.silentMinutes) || 3;
    const silentMs = Math.min(Math.max(silentMinutes, 0.05), 60) * 60_000;
    const inner =
      typeof config.inner === 'function'
        ? (config.inner as () => AsyncIterable<unknown>)
        : typeof ctx.env?.inner === 'function'
          ? (ctx.env.inner as () => AsyncIterable<unknown>)
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
