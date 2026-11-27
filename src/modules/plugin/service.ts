// 插件模块的 action 面：只做转发，编排在 host.ts。
//
// gettask：模块加载即把 gettask 声明注册给 promptplug（设置页注册表 / 模板校验用）。
// 属性导入只为副作用，没有需要再导出的符号。
import './gettask.js';

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
