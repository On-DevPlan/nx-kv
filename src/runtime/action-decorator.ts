// action 装饰器：在 ModuleBase 子类的方法上声明 action（zod schema 即契约）。
//
// 单一通道：全部新业务 action 都走这里——声明（@action 元数据）与实现同文件，
// 契约常量放同域 schemas.ts；模块的 actions 字段由 zodActionsOf(instance) 收集。
// 迁移期 legacy plain-object action（flags 表契约）并存，Registry / CliApp /
// ApiRouter 对两通道无感；全部模块迁移后 legacy 删除。
//
// 三条实测结论（模板 spike 逼出来的，改前先读）：
//
// (a) 元数据挂在**方法函数**上（WeakMap），不碰 `context.metadata`。
//     tsx（esbuild）会给 context.metadata 传对象，但 `Symbol.metadata` 在 Node 22 里
//     是 undefined——tsc 编译后交给原生 Node 时 context.metadata 就是 undefined，
//     元数据会静默丢失。挂函数上与运行时无关，最稳。
//
// (b) 装饰器**不改方法签名**（TC39 要求返回类型与原方法兼容），handler 的入参类型
//     只能手写 `z.output<typeof schema>`。z.input（调用方形状，.default 字段可选）
//     与 z.output（解析后形状，.default 字段必填）别混：handler 拿的是 z.output。
//
// (c) 出参没有 schema——**实现即契约**：apiclient 的返回类型从 action 类的方法签名
//     直接推断（codegen type-only 引类），同一信息只声明一次。
import { describeInput, type FieldDesc } from './zod-bridge.js';
import type { ZodType } from 'zod';

/** 装饰式 action 绑定到实例后的公共形状（registry.actions 的元素类型之一）。 */
export interface BoundAction {
  id: string;
  module: string;
  cli: readonly string[];
  http?: readonly [string, string] | null;
  summary?: string;
  // meta 形参刻意与 legacy 的 run(ctx, { transport }) 同形（宽松 string 而非字面量联合）：
  // Registry / CliApp / ApiRouter 把两通道 action 装进同一个数组，run 必须可互相赋值。
  run: (input: unknown, meta?: { transport?: string }) => unknown;
  [k: string]: unknown;
}

export interface ActionMeta {
  /** 全局唯一 id，编成 `模块.动作`（如 `system.bootstrap`） */
  id: string;
  /** CLI 命令路径的各段（如 ['bootstrap']） */
  cli: readonly string[];
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
  /** CLI 人读渲染（面板不用——面板拿 data 走 JSON）。 */
  render?: (result: unknown, ctx?: unknown) => string | Promise<string>;
  /** SSE 类动作：true 时 HTTP 侧把 req/res 透传给 run，action 自己接管响应 */
  stream?: boolean;
}

/** 装饰器元数据表：方法函数 → 声明。WeakMap 不阻止方法被 GC。 */
const META = new WeakMap<object, ActionMeta>();

/**
 * 标注一个 action 方法。用法：
 *
 * ```ts
 * export class SystemModule extends ModuleBase {
 *   @action({ id: 'system.bootstrap', cli: ['bootstrap'], http: ['GET', '/api/bootstrap'],
 *             summary: '…', input: systemBootstrapInput })
 *   bootstrap(ctx: z.output<typeof systemBootstrapInput>) { return this.svc.bootstrap(); }
 * }
 * ```
 */
export function action(meta: ActionMeta) {
  return function <F extends (...args: never[]) => unknown>(value: F, context: { kind: string }): F {
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
  cli: readonly string[];
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
  render?: (result: unknown, ctx?: unknown) => string | Promise<string>;
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
    const bound = method as (this: typeof instance, input: unknown, meta?: { transport?: string }) => unknown;
    out.push({
      id: meta.id,
      cli: meta.cli,
      http: meta.http ?? null,
      summary: meta.summary,
      args,
      restArg: meta.restArg,
      fields,
      input: meta.input,
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
