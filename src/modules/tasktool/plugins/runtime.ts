// PluginRuntime —— 只依赖 container（控制反转）；插件自注册后按契约调钩子。
import { getPlugin, requirePlugin } from './container.js';
import type { BasePlugin, PluginContext } from './base.js';

/**
 * 只跑 scope=control 的 onSchedule。
 * @param ctx
 */
export function runScheduleHooks(ctx: PluginContext): unknown[] {
  const snap = ctx.snapshot;
  const results: unknown[] = [];
  const node = (snap.nodes || []).find((n) => String(n.id) === String(ctx.nodeId));
  for (const spec of node?.plugins || []) {
    if (spec.scope !== 'control' && spec.name !== 'blockgoal') continue;
    const impl = getPlugin(spec.name);
    if (!impl) continue;
    results.push(impl.onSchedule(ctx, spec.config || {}));
  }
  return results;
}

/**
 * 消费侧：timegoal（workflow）包裹 waitgoal（node）。
 * @param ctx
 * @param opts
 */
export async function* runGetHooks(
  ctx: PluginContext,
  opts: { pull?: () => Promise<unknown | null> } = {},
): AsyncGenerator<unknown, void, unknown> {
  const snap = ctx.snapshot;
  const wfTime = (snap.workflowPlugins || []).find((p) => p.name === 'timegoal');
  const node =
    ctx.nodeId != null
      ? (snap.nodes || []).find((n) => String(n.id) === String(ctx.nodeId))
      : null;
  const nodeWait = (node?.plugins || []).find((p) => p.name === 'waitgoal');

  const waitPlugin = getPlugin('waitgoal');
  const waitConfig: Record<string, unknown> = {
    ...(nodeWait?.config || {}),
    pull: opts.pull,
  };

  const once = (): AsyncGenerator<unknown, void, unknown> => {
    if (!waitPlugin) return empty();
    return waitPlugin.onGet({ ...ctx, env: { ...(ctx.env || {}), pull: opts.pull } }, waitConfig);
  };

  if (wfTime) {
    const timePlugin = requirePlugin('timegoal');
    yield* timePlugin.onGet(
      { ...ctx, env: { ...(ctx.env || {}), inner: once } },
      { ...(wfTime.config || {}), inner: once },
    );
    return;
  }
  yield* once();
}

async function* empty(): AsyncGenerator<unknown, void, unknown> {
  /* no waitgoal registered */
}

/** @deprecated 兼容旧测试：按需取实例 */
export function getBY_NAME(): Record<string, BasePlugin | null> {
  return {
    blockgoal: getPlugin('blockgoal'),
    waitgoal: getPlugin('waitgoal'),
    timegoal: getPlugin('timegoal'),
    taskgoal: getPlugin('taskgoal'),
  };
}
