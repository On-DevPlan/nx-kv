// 系统提示词「追加方式」与 XML 包裹的共享定义（前后端共用，零依赖）。
//
// **#152 起这里不再持有任何模板正文，也不再定义「每区块模板列表」。**
// 模板正文的唯一真相是插件类（modules/promptplug/plugins/*.ts 的 `templates`）；
// 段落清单的唯一真相是注册表（modules/promptplug/registry.ts 的 PLUGIN_CLASSES）。
// 本文件只剩一件跨端共享的纯逻辑：把已渲染的段落包进根标签（compose 的最后一步）。
// #186 起「追加方式」选择已删除——**固定 XML 区块**，不再有 plain 直拼。
//
// 区块标记是给 agent 读的「类 XML」分隔语法，不对正文做实体转义。


export const DEFAULT_APPEND_MODE = 'xml';
export const XML_ROOT_TAG = 'nx-kv';

/** XML 区块段：tag 为标签名，text 为已渲染正文（空 text 由调用方滤掉）。 */
export interface XmlBlockPart {
  id?: string;
  tag: string;
  text: string;
}

/**
 * 把已渲染的段落包进根标签。parts: [{ id, tag, text }]（空 text 已由调用方滤掉）。
 * 没有可输出段落 → ''（调用方据此省略 instruction）。
 */
export function wrapXmlBlocks(parts?: readonly (XmlBlockPart | null | undefined)[] | null): string {
  const inner = (parts || [])
    .filter((p): p is XmlBlockPart => !!p && typeof p.text === 'string' && p.text.trim().length > 0)
    .map((p) => `<${p.tag}>\n${p.text}\n</${p.tag}>`)
    .join('\n');
  return inner ? `<${XML_ROOT_TAG}>\n${inner}\n</${XML_ROOT_TAG}>` : '';
}
