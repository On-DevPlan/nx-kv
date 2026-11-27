// 任务创建通知（第三生命周期点，内部钩子）：草稿提交成功后，把草稿键交给插件迁移。
//
// 背景：任务编辑页在草稿态没有真实 task.id，插件面板只能用临时键（draft-N）暂存数据。
// 任务真正落库后，宿主调用插件的 `onTaskCreated(ctx, { draftKey, task })`，
// 插件自行把草稿键下的数据迁到 task.id（技能选中、批注等业务各自决定）。
//
// 失败语义：任务已经创建成功，任何插件迁移失败都只记 warning，绝不回滚任务。
import type { PluginTaskInfo, PretaskContext } from '@nx-kv/plugin-sdk';
import { badInput } from '../../core/errors.js';
import { enabledPlugins } from './host.js';

export interface TaskCreatedInput extends PretaskContext {
  draftKey?: string;
  task: PluginTaskInfo;
}

export interface TaskCreatedResult {
  notified: string[];
  warnings: string[];
}

function msgOf(e: unknown): string {
  return String((e as Error)?.message || e);
}

/** 广播任务创建事件（只通知实现了 onTaskCreated 的已启用插件）。 */
export async function notifyTaskCreated(input: TaskCreatedInput): Promise<TaskCreatedResult> {
  const { draftKey = '', task, ...ctx } = input;
  const taskId = Number(task?.id);
  if (!Number.isInteger(taskId) || taskId <= 0) throw badInput('需要 task.id（正整数）');
  const { handles, warnings } = await enabledPlugins({
    ...ctx,
    ...(task.topicKey ? { topicKey: task.topicKey } : {}),
    ...(task.projectKey ? { repoKey: task.projectKey } : {}),
    ...(task.cwd ? { cwd: task.cwd } : {}),
  });
  const notified: string[] = [];
  const key = String(draftKey || '').trim();
  for (const { plugin, ctx: pluginCtx } of handles) {
    if (typeof plugin.onTaskCreated !== 'function') continue;
    try {
      await plugin.onTaskCreated(pluginCtx, {
        ...(key ? { draftKey: key } : {}),
        task: { ...task, id: taskId },
      });
      notified.push(plugin.id);
    } catch (e) {
      warnings.push(`${plugin.id}: onTaskCreated 失败——${msgOf(e)}`);
    }
  }
  return { notified, warnings };
}
