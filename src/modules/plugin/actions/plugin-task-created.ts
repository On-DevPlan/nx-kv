// plugin.task-created —— 草稿提交后的插件通知（内部钩子，前端提交成功后调用）。
//
// 任务已创建成功；这里只把 draftKey + task 广播给实现了 onTaskCreated 的插件。
// 插件迁移失败只返回 warning，不影响任务本身。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { notifyTaskCreated } from '../task-created.js';

const input = z.object({
  draftKey: z.string().optional().describe('草稿键（draft-N）；CLI 直接建任务时省略'),
  taskId: z.number().describe('新任务号'),
  taskText: z.string().optional().describe('新任务正文（插件按需使用）'),
  topic: z.string().optional().describe('主题 key'),
  group: z.string().optional().describe('组 key'),
  repo: z.string().optional().describe('仓库 key'),
  cwd: z.string().optional().describe('工作目录'),
  boardKey: z.string().optional().describe('组任务看板 key'),
  projectKey: z.string().optional().describe('任务所属仓库 key'),
  status: z.string().optional().describe('任务状态'),
});

export class PluginTaskCreatedAction extends ActionBase<typeof input> {
  @action({
    id: 'plugin.task-created',
    cli: ['plugin', 'task-created'],
    http: ['POST', '/api/plugins/task-created'],
    summary: '草稿提交创建任务后通知插件（迁移按 draftKey 暂存的插件数据）',
    input,
    render: (d: any) =>
      `已通知 ${Array.isArray(d?.notified) ? d.notified.length : 0} 个插件` +
      (Array.isArray(d?.warnings) && d.warnings.length ? `；告警：${d.warnings.join('；')}` : ''),
  })
  override async run(ctx: ActionInput<this['_input']>) {
    return notifyTaskCreated({
      draftKey: ctx.draftKey,
      task: {
        id: ctx.taskId,
        text: String(ctx.taskText || ''),
        ...(ctx.topic ? { topicKey: String(ctx.topic) } : {}),
        ...(ctx.cwd ? { cwd: String(ctx.cwd) } : {}),
        ...(ctx.boardKey ? { boardKey: String(ctx.boardKey) } : {}),
        ...(ctx.projectKey ? { projectKey: String(ctx.projectKey) } : {}),
        ...(ctx.status ? { status: String(ctx.status) } : {}),
      },
      topicKey: ctx.topic,
      groupKey: ctx.group,
      repoKey: ctx.repo,
      cwd: ctx.cwd,
    });
  }
}
