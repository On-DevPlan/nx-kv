// action 的抽象基类：所有 action 类继承它，依赖经容器拿（IoC）。
//
// 为什么要基类而不是各自构造函数直接收依赖：
//   - 容器 create 的签名统一为 `new (deps: Container) => T`——基类把这条约定固定下来，
//     gen-actions 收清单时也只需认这一个形状；
//   - 「我需要什么」写在**用点**（`this.deps.get('config')`），而不是构造函数的参数表
//     ——新增依赖不必改调用方；
//   - action 类只负责「声明 + 实现」，装配（模块编排、依赖注入、注册表收集）
//     都在基类与容器这一层。
//
// 泛型模板（#177 验收反馈）：TInput 定住**入参类型**。子类把 schema 绑在类上，
//   handler 的注解用统一的样板 `ctx: ActionInput<this['_input']>` 从基类推导——
//   类型只声明一次（schema 常量），不再手写 z.output、更不落 any：
//
//   export class GetAction extends ActionBase<typeof localtaskGetInput> {
//     @action({ id: 'localtask.get', …, input: localtaskGetInput })
//     override async run(ctx: ActionInput<this['_input']>) { … }
//   }
//
//   为什么注解还是不能省：TS 对类成员声明没有任何上下文类型注入通路——
//   override 不从基类取参类型（repro：override 与装饰器两种形态都拿不到），
//   TC39 装饰器也不给被标方法的参数做推断。幻影字段 _input + this['…'] 是
//   「注解可写、类型不重述」的唯一通路：类上的类型实参是唯一声明点。
//
//   出参没有模板——**实现即契约**：返回类型由实现推断，apiclient codegen 直接
//   从方法签名读（runtime/codegen.ts）。@action 的 meta.input 与 TInput 必须是
//   同一个 schema：装饰器把方法约束在 `(input: z.output<S>, meta?) => unknown` 上，
//   两处不一致编译期即红（action-decorator.ts）。
import type { z, ZodType } from 'zod';
import type { Container } from './container.js';

/** handler 入参类型：解析后的形状（z.output，.default 字段必填）。配 `this['_input']` 用。 */
export type ActionInput<S extends ZodType> = z.output<S>;

/** run 的第二参：传输通道标记。stream 的 req/res/url 走 input.__raw（api.ts 注入），不在这里。 */
export interface ActionRunMeta {
  transport?: string;
}

export abstract class ActionBase<TInput extends ZodType = ZodType> {
  /**
   * 幻影字段：把 TInput 暴露给子类方法注解里的 `this['_input']`。
   * `declare` 只存在于类型层，不产生任何运行时成员。
   */
  declare readonly _input: TInput;

  constructor(protected readonly deps: Container) {}

  /**
   * 唯一的执行入口。子类 override 它并写统一注解
   * `override run(ctx: ActionInput<this['_input']>)`。
   */
  abstract run(input: z.output<TInput>, meta?: ActionRunMeta): unknown;
}
