// 附件类 action（自 index.js 拆出）：挂附件 attach / 解除 detach / 列附件 attachments。
import { CWD, KEY } from './action-flags.js';
import { renderDetach, renderTaskAttachments } from './action-render.js';

export const attachActions = [
  {
    // 附件追加（与云端 todo attach 同构）：--path 落**本机附件仓**（零云端）→ 嵌入正文末尾；
    // --fileId 引用已有附件（本机仓 / 云端 id）。面板编辑器贴同一条语法（components/md/attachments.js）。
    id: 'localtask.attach',
    cli: ['localtask', 'attach'],
    http: ['POST', '/api/localtasks/attach'],
    summary:
      '给任务挂附件：--path 存本机附件仓 / --fileId 引用已有附件 / --url / --task（同主题任务）/ --ref（文档）；默认嵌进正文，--no-embed 只挂到附件区（不写正文）',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      cwd: CWD,
      key: KEY,
      path: { type: 'string', hint: '本机文件路径（落 ~/.nx-kv/attachments/local/ 再登记）' },
      fileId: { type: 'string', hint: '已有附件的 id（32 位 hex，可带扩展名；本机仓或云端）' },
      url: { type: 'string', hint: '外部链接（http/https；kind=url）' },
      task: { type: 'string', hint: '同主题下的任务编号（kind=task，落 nxkv://task/<id>）' },
      ref: { type: 'string', hint: '文档路径或 ref id（kind=ref，落 nxkv://ref/<refId>）' },
      name: { type: 'string', hint: '显示名 / 本地文件名（默认取原名）' },
      kind: { type: 'string', hint: 'image | file（仅 --path/--fileId 用；不给按扩展名判）' },
      note: { type: 'string', hint: '附件区条目备注' },
      noEmbed: { type: 'boolean', hint: '只写 attachments + task_attach（role=attach），不改正文' },
      'no-embed': { type: 'boolean', hint: '同 --noEmbed（连字符写法）' },
    },
    run: async (ctx) => {
      const { attachToTask } = await import('../tasktool/attach.js');
      return attachToTask({
        id: ctx.id,
        cwd: ctx.cwd,
        key: ctx.key,
        path: ctx.path,
        fileId: ctx.fileId,
        url: ctx.url,
        task: ctx.task,
        ref: ctx.ref,
        name: ctx.name,
        kind: ctx.kind,
        note: ctx.note,
        noEmbed: !!(ctx.noEmbed ?? ctx['no-embed']),
      });
    },
    render: (d) =>
      `已附加 ${d.fileId}（${d.kind === 'image' ? '图片' : d.kind === 'url' ? '链接' : d.kind === 'task' ? '任务' : d.kind === 'ref' ? '文档' : '文件'}）到主题「${d.name}」#${d.task.id} · ${d.area === 'area' ? '附件区（未写正文）' : '正文内嵌'}${d.markdown ? `\n嵌入: ${d.markdown}` : ''}`,
  },
  {
    id: 'localtask.detach',
    cli: ['localtask', 'detach'],
    http: ['DELETE', '/api/localtasks/attach'],
    summary:
      '解除任务与附件的关系（默认只解除关系，资源进孤儿池）；--purge 在无人引用时连资源行与本机字节一起删',
    flags: {
      id: { type: 'number', required: true, hint: '任务编号' },
      cwd: CWD,
      key: KEY,
      attachment: { type: 'string', required: true, hint: '资源 id（见 localtask attachments）' },
      purge: { type: 'boolean', hint: '连资源行与本机字节一起删（仍被其他任务/文档引用时拒绝删）' },
    },
    run: async (ctx) => {
      const { detachTaskAttachment } = await import('../tasktool/attach.js');
      return detachTaskAttachment({
        id: ctx.id,
        cwd: ctx.cwd,
        key: ctx.key,
        attachment: ctx.attachment,
        purge: ctx.purge,
      });
    },
    render: renderDetach,
  },
  {
    id: 'localtask.attachments',
    cli: ['localtask', 'attachments'],
    http: ['GET', '/api/localtasks/attachments'],
    summary: '列出某条任务引用的附件（正文里的 ![名](fileId) 嵌入），以及本地是否已有（给 agent 直接读本地文件）',
    flags: { id: { type: 'number', required: true, hint: '任务编号' }, cwd: CWD, key: KEY },
    run: async (ctx) => {
      const { listTaskAttachments } = await import('../tasktool/attach.js');
      return listTaskAttachments({ id: ctx.id, cwd: ctx.cwd, key: ctx.key });
    },
    render: renderTaskAttachments,
  },
];
