// task-template 插件 client 入口：自注册下拉行 / 槽位表单 / 自管理页 + 左下角条目。
import type { PluginUiDefinition } from '@nx-kv/plugin-sdk/client';
import EntryRow from './EntryRow.js';
import EntryForm from './EntryForm.js';
import ManagePage from './ManagePage.js';
import './style.css';

const definition: PluginUiDefinition = {
  api: '^1',
  components: {
    'entry-row': EntryRow,
    'entry-form': EntryForm,
    manage: ManagePage,
  },
  pages: {
    'entry-form': { title: '填写模板参数' },
    manage: { title: '任务模板' },
  },
  sidebar: [
    { id: 'manage', label: '任务模板', icon: 'list', order: 10, page: 'manage' },
  ],
};

if (window.NxkvPluginHost) {
  window.NxkvPluginHost.registerPlugin('task-template', definition);
} else {
  console.warn('[task-template] NxkvPluginHost 未注入，插件 UI 未注册');
}
