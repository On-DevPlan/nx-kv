// 插件模块的 action 面：只做转发，编排在 host.ts。
export {
  listPlugins,
  setPluginEnabled,
  listEntries,
  getVisibility,
  setVisibility,
  setDefaultEntry,
  buildDraft,
  callRpc,
  scopeKeyOf,
} from './host.js';
