// 目录批注插件 client：新建任务下拉的 annotate 页面 + 左下角自注册设置页。
import type { PluginUiDefinition } from '@nx-kv/plugin-sdk/client';
import AnnotatePage from './AnnotatePage.js';
import RequirementsPanel from './RequirementsPanel.js';
import SettingsPage from './SettingsPage.js';
import './style.css';

const definition: PluginUiDefinition = {
  api: '^1',
  icon: 'folder',
  components: { annotate: AnnotatePage, settings: SettingsPage, requirements: RequirementsPanel },
  pages: {
    annotate: { title: '目录批注' },
    settings: { title: '目录批注设置' },
  },
  sidebar: [
    { id: 'settings', label: '目录批注设置', order: 20, page: 'settings' },
  ],
};

if (window.NxkvPluginHost) {
  window.NxkvPluginHost.registerPlugin('dir-annotate', definition);
} else {
  console.warn('[dir-annotate] NxkvPluginHost 未注入，插件 UI 未注册');
}
