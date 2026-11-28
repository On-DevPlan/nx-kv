// skill-ref client：任务 dock 的技能选择面板 + 左下角技能目录设置页。
import type { PluginUiDefinition } from '@nx-kv/plugin-sdk/client';
import SkillPickerPanel from './SkillPickerPanel.js';
import SkillRefSettingsPage from './SettingsPage.js';
import './style.css';

const definition: PluginUiDefinition = {
  api: '^1',
  icon: 'star',
  components: { 'skill-picker': SkillPickerPanel, settings: SkillRefSettingsPage },
  pages: {
    'skill-picker': { title: '技能引用' },
    settings: { title: '技能引用设置' },
  },
  sidebar: [
    { id: 'settings', label: '技能引用设置', order: 30, page: 'settings' },
  ],
};

if (window.NxkvPluginHost) {
  window.NxkvPluginHost.registerPlugin('skill-ref', definition);
} else {
  console.warn('[skill-ref] NxkvPluginHost 未注入，插件 UI 未注册');
}
