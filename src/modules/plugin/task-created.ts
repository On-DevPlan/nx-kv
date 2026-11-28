// 任务创建通知（第三生命周期点，内部钩子）。
//
// @deprecated Web 已取消内存草稿：新建任务就是数据库实体，插件从第一刻就按 task.id
// 存取，不需要草稿键迁移。本钩子只为兼容老插件保留；Web 端不再调用（CLI/插件
// 如仍显式调用 notifyTaskCreated，行为不变）。
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
