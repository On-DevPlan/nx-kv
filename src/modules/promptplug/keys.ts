// promptplug 的 settings 键名（与 localtask/repo/settings.ts 的 KEYS 对账——
// 不 import localtask：promptplug 不依赖其他模块，键名字符串由单测钉住一致）。

/** 模板唯一真相（8 段，每段 active + list）。 */
export const LT_BLOCK_TEMPLATES = 'lt.blockTemplates';
/** 出厂快照版本（升级时只刷 builtin 文本）。 */
export const LT_PROMPT_TEMPLATES_VERSION = 'lt.promptTemplatesVersion';
/** 顺序唯一真相（id 数组）。 */
export const PROMPT_ORDER_KEY = 'prompt.pluginOrder';
