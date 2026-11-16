// prompt.pluginOrder 的键名与派生（顺序唯一真相是数组，方案 §5.1）。
//
// S1 阶段只提供键名常量；DB 读写随 S2 的 ensure.ts 落库一并落地
// （readSettingRaw/writeSettingRaw 需要 conn，由调用方持有）。
// 运行期顺序一律 resolveOrderIds（shared/prompt-plugin.ts）派生。

export const PROMPT_ORDER_KEY = 'prompt.pluginOrder';
