// prompt.registry —— 注册表外露：三端同源的唯一出口（#152 起**只读派生**）。
//
// 真相是插件类本身（registry.ts 的 PLUGIN_CLASSES）：id / 时机链 / 顺序 / 内置模板 /
// 变量目录全部从类声明派生。没有 JSON 注册表、没有 DB seed、也没有「顺序数组」——
// 顺序 = 链内 order。
//
// deps 全空：uiDescriptor 只读文本态（get()）与声明面（fields/varScope/templates），
// 结构态 buildData() 永不被调用——不需要宿主取数。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { uiDescriptor } from '../../../shared/prompt-plugin.js';
import { buildAllPlugins } from '../factory.js';
import { allPluginIds, assertRegistry, groupIndex } from '../registry.js';
import { allSegmentTemplates } from '../template-store.js';

/** prompt.registry 的入参契约（无参）。 */
const input = z.object({});

export class PromptRegistryAction extends ActionBase<typeof input> {
  @action({
    id: 'prompt.registry',
    cli: ['prompt', 'registry'],
    http: ['GET', '/api/prompt/registry'],
    summary: '提示词插件注册表：按时机链（get / check / done）列出插件的内置模板 / 变量目录 / 链内顺序',
    input,
    render: (d: any) =>
      d.plugins.map((p: any) => `[${p.group}] ${p.order} ${p.id}（${p.label}）`).join('；'),
  })
  override async run(_ctx: ActionInput<this['_input']>) {
    assertRegistry();
    // uiDescriptor 会按 group 名字母序排（check / done / get）；对外的 plugins 数组
    // 统一改用「时机声明序 + 链内 order」——与 groups 索引、CLI 渲染顺序逐项同序，
    // 前端左轨直接按它铺开就不会出现「导航顺序 ≠ 实际输出顺序」。
    const order = allPluginIds();
    const plugins = uiDescriptor(buildAllPlugins()).sort(
      (a, b) => order.indexOf(a.id) - order.indexOf(b.id),
    );
    // #161：用户层模板数据随注册表一起外露（每段的条目 + 启用 id）——
    // 出厂 builtin 在 descriptors 的 templates 里，用户条目在 segmentTemplates 里。
    return { groups: groupIndex(), plugins, segmentTemplates: allSegmentTemplates() };
  }
}
