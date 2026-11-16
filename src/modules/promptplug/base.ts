// PromptPlugin 基类（唯一基准方案 §1 / §1.4）。
//
// 子类只写：id / order / tag / label / dataSchema（zod strictObject）/ writes / data()。
// 模板正文不进代码——构造注入（模板唯一真相是 DB 的 lt.blockTemplates）。
//
// 两个 schema 名字的分工：
//   - dataSchema（子类声明）：zod 书写层，data() 返回形状 + 可见变量目录的来源；
//   - schema（注册面，本类派生）：schema-bridge 折算后的纯数据 PluginSchema<unknown>，
//     注册表 / compose / uiDescriptor 只认它（shared 零依赖，zod 进不了注册面）。
//
// 铁律：
//   - get 是唯一出口：无参 = 文本态；'data' = 结构态。子类不得重写（「怎么取」全仓一处答案）；
//   - 运行时判别靠字面量 'data'，不靠泛型（泛型擦除）；泛型只把结构态收窄到 T；
//   - data() 校验只在 get('data') 出口发生一次（safeParse），运行期不兜底、不回落；
//   - dataSchema 必须 z.strictObject：z.object 默认 strip 未声明键，data() 多写的段会被
//     静默删掉，撞车校验与变量白名单全部失效（见方案 §1.4 边界 2）。
import { z } from 'zod';
import type { AnyPromptPlugin, PluginSchema } from '../../shared/prompt-plugin.js';
import { pluginSchemaOf } from './schema-bridge.js';

export abstract class PromptPlugin<S extends z.ZodObject<z.ZodRawShape>>
  implements AnyPromptPlugin {

  abstract readonly id: string;
  /** ★ 父类强制：子类漏写编译不过（TS2515）。值只是播种默认位，运行期由数组派生 */
  abstract readonly order: number;
  /** 类 XML 输出标签（'nx-kv.context' 等） */
  abstract readonly tag: string;
  abstract readonly label: string;
  /** ★ data 形状（zod 书写层）：可写段 required + seed 段 optional；data() 返回只含可写段 */
  abstract readonly dataSchema: S;
  /** 默认只读：只读段不写 ctx（timecheck / goalhint / doneguard / ack） */
  readonly writes: readonly string[] = [];

  /** 当前生效模板（构造注入；空串视为该段不输出——启动期校验拦配置错误） */
  private readonly tpl: string;

  /** 注册面 schema（惰性派生一次：构造体内子类字段尚未初始化，不能在 super 里算） */
  private registered: PluginSchema<unknown> | null = null;

  constructor(template: string) {
    this.tpl = String(template ?? '');
  }

  /** 注册面：纯数据 PluginSchema（fields / blank），派生一次缓存 */
  get schema(): PluginSchema<unknown> {
    if (!this.registered) this.registered = pluginSchemaOf(this.dataSchema);
    return this.registered;
  }

  /** 子类只写这一处（同步即可；取数由宿主完成后注入，见方案 §8 分工说明） */
  protected abstract data(): z.infer<S> | Promise<z.infer<S>>;

  /** 唯一出口：无参 = 文本态；传 'data' = 结构态（校验只在这里发生一次） */
  get<T extends z.infer<S> = z.infer<S>>(as: 'data'): Promise<T>;
  get(): string;
  get(as?: 'data'): string | Promise<z.infer<S>> {
    if (as !== 'data') return this.tpl;
    return Promise.resolve(this.data()).then((raw) => {
      const r = this.dataSchema.safeParse(raw);
      if (!r.success) {
        const issues = r.error.issues
          .map((i) => `${i.path.join('.') || '(根)'} ${i.message}`)
          .join('；');
        throw new Error(`${this.id}: data() 返回与 schema 不符——${issues}`);
      }
      return r.data;
    });
  }
}
