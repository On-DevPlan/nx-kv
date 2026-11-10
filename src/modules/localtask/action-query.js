// 查看类 action（自 index.js 拆出）：总览 list / 单条 get / 任务链 chain。
import * as service from './service.js';
import { CWD, KEY } from './action-flags.js';
import { renderOverview, renderTask, renderChain } from './action-render.js';

export const queryActions = [
  {
    id: 'localtask.list',
    cli: ['localtask', 'list'],
    http: ['GET', '/api/localtasks'],
    summary: '总览全部主题（工作目录、现状、是否等待中、待领取数）',
    run: () => service.listTasks(),
    render: renderOverview,
  },
  {
    id: 'localtask.get',
    // CRUD get（查看单条）。CLI 动词让位给「领取」语义：`localtask get` 现在是
    // 领任务（见 localtask.claim），查看走 `localtask show`。HTTP 路由不变。
    cli: ['localtask', 'show'],
    http: ['GET', '/api/localtasks/item'],
    summary: '查看单条任务（按 --id，定位到 --cwd 主题或 --key）；正文引用附件时带附件清单与本地路径（自动下载跟随本机设置）',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: async (ctx) => {
      const task = await service.getTask({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
      // 附件标注（任务 #15）：解析正文嵌入 + 按设置自动下载 + 标本地路径。
      // fail-open：标注坏了照常返回任务本体。
      const { annotateTaskDelivery } = await import('../tasktool/attach.js');
      const att = await annotateTaskDelivery(task).catch(() => null);
      return att
        ? { ...task, attachments: att.task.attachments, ...(att.sync ? { attachmentsSync: att.sync } : {}) }
        : task;
    },
    render: renderTask,
  },
  {
    // 任务链（#74）：同任务 history 节点（就地重开/评论）为主；旧 forkOf 祖先/子任务仍返回。
    id: 'localtask.chain',
    cli: ['localtask', 'chain'],
    http: ['GET', '/api/localtasks/chain'],
    summary:
      '查一条任务的链：history 节点（origin/reopen/comment/current）+ 旧 forkOf 祖先/子任务；面板点节点可旁路查看正文',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: (ctx) => service.taskChain({ id: ctx.id, cwd: ctx.cwd, key: ctx.key }),
    render: renderChain,
  },
];
