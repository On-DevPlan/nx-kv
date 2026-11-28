// 新建任务统一入口：直接落库为真实任务（默认 plan 草稿），再打开编辑页。
//
// Web 不再有内存 draft-N；pretask 插件、目录页、组页、侧栏都走这一条链路，
// 保证拿到真实 task id / topicKey / repoKey，gettask 插件从第一刻就有稳定上下文。
import { addTask } from '../../api/tasks.js';
import { composeTaskText } from '../md/md-parse.js';

export interface CreateTaskRequest {
  text: string;
  title?: string;
  /** 默认 plan（草稿）；插件中间页完成时传 pending。 */
  status?: 'plan' | 'pending';
  dirKey?: string;
  cwd?: string;
  groupId?: string;
  board?: string;
  project?: string;
}

export interface TaskCreateHost {
  openPage?: (spec: any) => void;
  onNavigate?: (hash: string) => void;
  refreshLocal?: () => Promise<void>;
}

/** 创建真实任务并打开编辑页；返回新任务定位。 */
export async function createTaskAndOpen(
  host: TaskCreateHost,
  req: CreateTaskRequest,
): Promise<{ id: number; key?: string } | null> {
  const text = composeTaskText(req.title || '', req.text || '');
  const body: Record<string, unknown> = {
    text,
    status: req.status || 'plan',
    ...(req.groupId
      ? { board: req.board || req.groupId, project: req.project || '' }
      : { cwd: req.cwd }),
  };
  const res = await addTask(body as any);
  const rawId = res?.task?.id ?? res?.id;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) return null;
  try {
    await host.refreshLocal?.();
  } catch {
    /* 刷新失败不阻断打开编辑页 */
  }
  const name = `#${id}`;
  if (req.groupId) host.openPage?.({ groupId: req.groupId, task: String(id), name });
  else if (req.dirKey) host.openPage?.({ dirKey: req.dirKey, task: String(id), name });
  return { id, key: String(res?.key || '') };
}
