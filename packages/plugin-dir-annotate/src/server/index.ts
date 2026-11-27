// 目录批注插件：新建任务下拉只注册一个 panel 入口；文件树/批注 UI 与设置页全在 client 包。
import { definePlugin, paramsOf } from '@nx-kv/plugin-sdk';
import { migrateStorage, readSettings, STORAGE_VERSION, writeSettings } from './settings.js';

export default definePlugin({
  id: 'dir-annotate',
  version: '0.1.0',
  api: '^1',
  name: '目录批注',
  description: '选择项目目录中的文件、添加批注，最后生成一条任务草稿。',
  order: 20,
  defaultEnabled: true,
  storageVersion: STORAGE_VERSION,
  migrateStorage,
  entries(ctx) {
    const kind = ctx.topic?.kind || (ctx.groupKey ? 'group' : ctx.repoKey ? 'repo' : 'unknown');
    if (kind === 'unknown') return [];
    return [
      {
        id: 'dir-annotate:open',
        pluginId: 'dir-annotate',
        label: '目录批注…',
        description: kind === 'group' ? '先选仓库，再选文件添加批注' : '选择项目文件并添加批注',
        icon: 'folder',
        kind: 'panel',
        order: 20,
        ui: { panel: 'annotate' },
        panel: { title: '目录批注' },
      },
    ];
  },
  async buildDraft() {
    throw new Error('目录批注入口通过面板生成任务，不走 pretask.draft');
  },
  rpc: {
    async getSettings(ctx) {
      return readSettings(ctx.storage);
    },
    async setSettings(ctx, raw) {
      return writeSettings(ctx.storage, paramsOf(raw));
    },
  },
});
