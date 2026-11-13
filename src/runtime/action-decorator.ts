// action 装饰器：在 ModuleBase 子类的方法上声明 action（zod schema 即契约）。
//
// 单一通道：全部新业务 action 都走这里——声明（@action 元数据）、契约（zod schema）
// 与实现同文件；模块的 actions 字段由 zodActionsOf(instance) 收集。
// legacy plain-object action（flags 表契约）只剩 runtime 内建命令在用
// （serve / help / version）——它们是平台命令，不是业务 action。
// Registry / CliApp / ApiRouter 仍对两通道无感；内建命令迁进 platform 模块后，
// legacy 通道即可整体删除。
//
// 三条实测结论（模板 spike 逼出来的，改前先读）：
//
// (a) 元数据挂在**方法函数**上（WeakMap），不碰 `context.metadata`。
//     tsx（esbuild）会给 context.metadata 传对象，但 `Symbol.metadata` 在 Node 22 里
//     是 undefined——tsc 编译后交给原生 Node 时 context.metadata 就是 undefined，
//     元数据会静默丢失。挂函数上与运行时无关，最稳。
//
// (b) 装饰器**不改方法签名**（TC39 要求返回类型与原方法兼容），也给不了被标方法
//     的参数做推断——handler 的入参类型走基类泛型模板：类绑
//     `extends ActionBase<typeof xxxInput>`，方法注解统一写
//     `run(ctx: ActionInput<this['_input']>)`（由幻影字段从类型实参推导，
//     见 action-base.ts）。装饰器因此 value 用 any **透传**：this 依赖类型
//     出了类声明不可解析，任何收紧的参数签名都会让应用点全红。
//     z.input（调用方形状，.default 字段可选）与 z.output（解析后形状，
//     .default 字段必填）别混：handler 拿的是 z.output。
//
// (c) 出参默认没有 schema——**实现即契约**：TS 前端 apiclient 的返回类型从 action 类
//     的方法签名直接推断（codegen type-only 引类），同一信息只声明一次。
//     但**跨语言客户端（Dart）拿不到 TS 类型**，所以需要跨语言的 action 额外声明
//     `output`：它是**视图**（只列要对端侧暴露的字段，未声明的字段不进生成物），
//     不是 service 的返回结构。声明了 output 的 action 会被 tests/unit/contract.test.mjs
//     用 output.safeParse(真实返回) 对账——声明写错，测试当场红。
import { describeInput, type FieldDesc } from './zod-bridge.js';
import type { ActionRunMeta } from './action-base.js';
import type { ZodType } from 'zod';

/**
 * CLI 路径声明：单路径 `['repo','list']` 或多路径别名 `[['repo','list'],['r','l']]`。
 * 模板的类型只写了单路径——但别名是既有能力（`bundled list` 与 `skill install --list`
 * 同一条命令），迁移不能把它削掉。
 */
export type CliPaths = readonly string[] | readonly (readonly string[])[];

/** 装饰式 action 绑定到实例后的公共形状（registry.actions 的元素类型之一）。 */
export interface BoundAction {
  id: string;
  module: string;
  cli: CliPaths;
  http?: readonly [string, string] | null;
  summary?: string;
  // meta 形参刻意与 legacy 的 run(ctx, { transport }) 同形（宽松 string 而非字面量联合）：
  // Registry / CliApp / ApiRouter 把两通道 action 装进同一个数组，run 必须可互相赋值。
  run: (input: unknown, meta?: ActionRunMeta) => unknown;
  [k: string]: unknown;
}

export interface ActionMeta {
  /** 全局唯一 id，编成 `模块.动作`（如 `system.bootstrap`） */
  id: string;
  /** CLI 命令路径的各段（如 ['bootstrap']）；多路径别名写 [[a,b],[c,d]] */
  cli: CliPaths;
  /** HTTP 路由：[METHOD, PATTERN]。纯 CLI 命令**显式写 null**（与 legacy 一致，测试断言两态） */
  http?: readonly [string, string] | null;
  /** 一句话说明，进 help 与面板 */
  summary?: string;
  /** 位置参数字段名（按声明顺序消费 argv） */
  args?: readonly string[];
  /** 尾部收参：剩余全部位置参数收进这个字段（z.array(z.string())） */
  restArg?: string;
  /** 输入 schema：CLI 与 HTTP 共用的真相源（运行时校验 + 归一化的依据）。 */
  input: ZodType;
  /**
   * 出参 schema（可选）：**只为跨语言客户端存在**。
   *
   * 不声明它，TS 侧一切照旧（返回类型从方法签名推断）；声明了它，这个 action 才会
   * 进 contract 快照、才会被生成 Dart 客户端。三条纪律（违反会在生成/测试期报错）：
   *   1. 它是**视图**：只列要对端侧暴露的字段；service 多返回的字段不会被生成
   *   2. 必须是 `z.object({...})` 收口：端侧根类型得是个模型
   *   3. 可选性 / 整数 / 枚举即契约：`z.int()` 与 `z.number()` 在 Dart 是 int 与 num，
   *      改一个字符端侧就换个类型（这正是我们想要的编译期信号）
   */
  output?: ZodType;
  /** CLI 人读渲染（面板不用——面板拿 data 走 JSON）。 */
  // 参数用 any：渲染函数普遍要读结果字段，给 unknown 会让属性访问整片红。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 见上；eslint 对 any 仅警告
  render?: (result: any, ctx?: any) => string | Promise<string>;
  /** SSE 类动作：true 时 HTTP 侧把 req/res 透传给 run，action 自己接管响应 */
  stream?: boolean;
}

/** 装饰器元数据表：方法函数 → 声明。WeakMap 不阻止方法被 GC。 */
const META = new WeakMap<object, ActionMeta>();

/**
 * 标注一个 action 方法。用法：
 *
 * ```ts
 * export class XAction extends ActionBase<typeof xInput> {
 *   @action({ id: 'x.do', cli: ['x', 'do'], http: ['GET', '/api/x'],
 *             summary: '…', input: xInput })
 *   override async run(ctx: ActionInput<this['_input']>) { … }
 * }
 * ```
 *
 * 入参/出参的静态类型完全由**声明自持**（类上的 TInput 经幻影字段推导注解，
 * 返回类型即实现），装饰器只收运行期元数据、不做类型层的参数对账——
 * value 用 any 透传：`ActionInput<this['_input']>` 是 this 依赖类型，出了类声明
 * 就不可解析，收紧 value 的签名会让每个应用点都报「装饰器签名无法解析」。
 */
export function action<S extends ZodType>(meta: Omit<ActionMeta, 'input'> & { input: S }) {
  // value 用 any：入参注解 `ActionInput<this['_input']>` 是 this 依赖类型，出了类
  // 声明不可解析——收紧成具体函数签名会让所有应用点报「装饰器签名无法解析」。
  // 静态类型由声明自持（见上），这里只收元数据 + 运行期 kind 校验。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
  return function (value: any, context: { kind: string }): any {
    if (context.kind !== 'method') {
      throw new Error(`@action 只能标注方法（收到 kind=${context.kind}）`);
    }
    META.set(value as unknown as object, meta);
    return value;
  };
}

/** 取某个方法上的 action 声明；没标注过返回 undefined */
export function metaOf(method: unknown): ActionMeta | undefined {
  if (typeof method !== 'function') return undefined;
  return META.get(method as object);
}

/**
 * 装饰式 action 绑定到实例后的形状：在 BoundAction 之上多带 zod 契约。
 * CliApp 与 ApiRouter 据此走 zod 解析通道；channel: 'zod' 是双通道判别的标记。
 */
export interface ZodBoundAction extends BoundAction {
  id: string;
  cli: CliPaths;
  /** 纯 CLI 命令显式为 null（与 legacy 的两态约定一致） */
  http: readonly [string, string] | null;
  summary?: string;
  /** 位置参数字段名（describeInput 的排序依据） */
  args?: readonly string[];
  /** 尾部收参字段名（剩余位置参数全收进来） */
  restArg?: string;
  /** 逐字段说明（收集时用 describeInput 算好一次，CLI/HTTP/usage/codegen 共用） */
  fields: FieldDesc[];
  input: ZodType;
  /** 出参视图（只有跨语言客户端需要的 action 才有；见 ActionMeta.output） */
  output?: ZodType;
  render?: (result: any, ctx?: any) => string | Promise<string>;
  stream?: boolean;
  channel: 'zod';
  /** 绑定的 action 类名（codegen 按它从清单 type-only 引类）；tsc 编译后类名不变形（无压缩）。 */
  className: string;
  /** 类上的方法名（= 装饰的属性名）。 */
  method: string;
}

/** 路由模式里的 :param 列表 */
export function routeParams(pattern: string): string[] {
  return [...pattern.matchAll(/:([\w-]+)/g)].map((m) => m[1]!);
}

/**
 * 收集一个实例（ModuleBase 子类）里被 @action 标注的方法，绑定成 actions 数组。
 *
 * handler 以**实例**为 this 调用——装饰式的卖点就是「声明与实现写在一起、
 * 类可以持有状态」（依赖经构造注入，handler 调 this.deps.get(...)）。
 * 收集时用 getOwnPropertyDescriptor 取值而不是 proto[name]——
 * 后者会执行 getter，只为了看一眼它有没有被装饰器标过。
 *
 * 装载期自检：路由 :param 未在 args 里声明 → 当场报错（单通道下这是该一致性
 * 的唯一防线——类型层无法校验运行期才拼出来的元数据）。
 */
export function zodActionsOf(instance: object): ZodBoundAction[] {
  const proto = Object.getPrototypeOf(instance);
  const moduleId = String((instance as { id?: unknown }).id ?? '');
  const out: ZodBoundAction[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    const method = descriptor?.value;
    if (typeof method !== 'function') continue;
    const meta = metaOf(method);
    if (!meta) continue;

    const args = meta.args ?? [];
    if (meta.http) {
      const declared = new Set([...args, ...(meta.restArg ? [meta.restArg] : [])]);
      for (const p of routeParams(meta.http[1])) {
        if (!declared.has(p)) {
          throw new Error(
            `action ${meta.id} 的路由 ${meta.http[1]} 含 :${p}，但 args 里没声明同名位置参数` +
              '（运行时会是 undefined）',
          );
        }
      }
    }

    const fields = describeInput(meta.input, args);
    const bound = method as (this: typeof instance, input: unknown, meta?: ActionRunMeta) => unknown;
    out.push({
      id: meta.id,
      cli: meta.cli,
      http: meta.http ?? null,
      summary: meta.summary,
      args,
      restArg: meta.restArg,
      fields,
      input: meta.input,
      output: meta.output,
      render: meta.render,
      stream: meta.stream,
      channel: 'zod',
      module: moduleId,
      className: instance.constructor.name,
      method: name,
      run: (input: unknown, meta?: { transport?: string }) => bound.call(instance, input, meta),
    });
  }
  return out;
}
