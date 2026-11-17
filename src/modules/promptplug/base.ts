// PromptPlugin 基类（#152 重构版）。
//
// 子类只写：id / order / group / tag / label / dataSchema / writes / templates / buildData()。
//
// #152 的三条变化（用户口径）：
//   1. **模板进类**：每个实现必须给出 `templates` —— 内置模板列表。正文唯一真相
//      就是这里的 TS 常量，不再有 Template/blockTemplates.json、不再 seed 进 DB。
//   2. **group 化**：每个实现必须给出 `group`（get / check / done），compose 按
//      group 取整条链，链内按 order 排序 —— 触发一个时机 = 跑完这一组。
//   3. **数据自建**：`buildData()` 收在子类里，宿主只给 `Supply`（值或惰性函数）。
//      想发 HTTP 拉云端提示词就自己在这里发；没有中心化的大对象 builder。
//
// 两个 schema 名字的分工不变：
//   - dataSchema（子类声明）：zod 书写层，buildData() 返回形状 + 变量目录来源；
//   - schema（注册面，本类派生）：schema-bridge 折算后的纯数据 PluginSchema<unknown>。
//
// 铁律：
//   - get 是唯一出口：无参 = 文本态；'data' = 结构态。子类不得重写；
//   - 运行时判别靠字面量 'data'，不靠泛型（泛型擦除）；泛型只把结构态收窄到 T；
//   - buildData() 校验只在 get('data') 出口发生一次（safeParse），运行期不兜底；
//   - dataSchema 必须 z.strictObject（strip 会让撞车校验与变量白名单失效）。
import { z } from 'zod';
import type { AnyPromptPlugin, PluginSchema } from '../../shared/prompt-plugin.js';
import { pluginSchemaOf } from './schema-bridge.js';

/** 触发时机 = 链名。一个 group 是一条链，链内按 order 升序渲染。 */
export type PluginGroup = 'get' | 'check' | 'done';

/** 全部时机（顺序 = 注册表展示顺序）。 */
export const PLUGIN_GROUPS: readonly PluginGroup[] = ['get', 'check', 'done'];

/** 内置模板条目：正文进代码，id/name 只用于展示与追溯。 */
export interface TemplateText {
  id: string;
  name: string;
  /** 模板正文（Handlebars 子集，见 core/instruction-template.ts） */
  text: string;
}

/**
 * 惰性供给：宿主可以给值，也可以给「算的时候再调」的函数。
 * 后者用于省掉构建期没有消费者时的无效拷贝（也允许异步——留给 HTTP 类取数）。
 */
export type Supply<T> = T | (() => T | Promise<T>);

/** 解析一个 Supply（值直接返回，函数则调用并 await）。 */
export async function supplied<T>(v: Supply<T>): Promise<T> {
  return typeof v === 'function' ? await (v as () => T | Promise<T>)() : v;
}

export abstract class PromptPlugin<S extends z.ZodObject<z.ZodRawShape>>
  implements AnyPromptPlugin {

  abstract readonly id: string;
  /** 链内顺序（同一 group 内必须唯一；跨组不要求） */
  abstract readonly order: number;
  /** ★ 触发时机：compose 按它取整条链 */
  abstract readonly group: PluginGroup;
  /** 类 XML 输出标签（'nx-kv.context' 等） */
  abstract readonly tag: string;
  abstract readonly label: string;
  /** ★ data 形状（zod 书写层）：可写段 required + seed 段 optional；buildData() 返回只含可写段 */
  abstract readonly dataSchema: S;
  /**
   * ★ 内置模板列表（至少一条，第一条 = 出厂默认）。
   * 正文进代码后，「模板从哪来」这件事只剩一个答案，不会再出现常量 ≡ JSON ≡ DB 的三角漂移。
   */
  abstract readonly templates: readonly TemplateText[];
  /** 默认只读：只读段不写 ctx（timecheck / goalhint / doneguard / ack） */
  readonly writes: readonly string[] = [];

  /** 显式覆盖正文（预览 / 测试用；正常流程走 templates[0]）。 */
  private readonly overrideText: string;

  /** 注册面 schema（惰性派生一次：构造体内子类字段尚未初始化，不能在 super 里算） */
  private registered: PluginSchema<unknown> | null = null;

  constructor(text = '') {
    this.overrideText = String(text ?? '');
  }

  /** 注册面：纯数据 PluginSchema（fields / blank），派生一次缓存 */
  get schema(): PluginSchema<unknown> {
    if (!this.registered) this.registered = pluginSchemaOf(this.dataSchema);
    return this.registered;
  }

  /** 当前生效模板正文：显式覆盖优先，否则第一条内置模板。 */
  protected activeTemplate(): string {
    if (this.overrideText) return this.overrideText;
    const first = this.templates[0];
    return String((first && first.text) || '');
  }

  /**
   * 子类只写这一处：自己取数 / 自己拼数据对象。
   * 需要宿主材料的，从构造时拿到的 `Supply` 里 await supplied()。
   */
  protected abstract buildData(): z.infer<S> | Promise<z.infer<S>>;

  /** 唯一出口：无参 = 文本态；传 'data' = 结构态（校验只在这里发生一次） */
  get<T extends z.infer<S> = z.infer<S>>(as: 'data'): Promise<T>;
  get(): string;
  get(as?: 'data'): string | Promise<z.infer<S>> {
    if (as !== 'data') return this.activeTemplate();
    return Promise.resolve(this.buildData()).then((raw) => {
      const r = this.dataSchema.safeParse(raw);
      if (!r.success) {
        const issues = r.error.issues
          .map((i) => `${i.path.join('.') || '(根)'} ${i.message}`)
          .join('；');
        throw new Error(`${this.id}: buildData() 返回与 schema 不符——${issues}`);
      }
      return r.data;
    });
  }
}
