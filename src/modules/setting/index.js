import * as service from './service.js';

export default {
  id: 'setting',
  title: '设置',
  order: 5,
  // 没有独立面板：开关就放在「清单」页里（附件是清单的一部分），
  // 单独一个 tab 反而让「在哪改」变成一次多余的翻找。
  view: null,

  actions: [
    {
      id: 'setting.get',
      cli: ['setting', 'get'],
      http: ['GET', '/api/setting'],
      summary: '读本机设置（附件是否读取时自动下载、附件目录）',
      run: () => service.getSettings(),
      render: (d) => service.renderSettings(d),
    },
    {
      id: 'setting.set',
      cli: ['setting', 'set'],
      http: ['POST', '/api/setting'],
      summary: '改本机设置（只改传入项）',
      flags: {
        autoSyncAttachments: { type: 'boolean', hint: '读任务时自动把附件下载到本地' },
        attachmentsDir: { type: 'string', hint: '附件本地目录（空 = ~/.nx-kv/attachments/<工作空间>/）' },
      },
      run: (ctx) => service.setSettings(ctx),
      render: (d) => service.renderSettings(d),
    },
  ],
};
