// action 的抽象基类：所有 action 类继承它，依赖经容器拿（IoC）。
//
// 为什么要基类而不是各自构造函数直接收依赖：
//   - 容器 create 的签名统一为 `new (deps: Container) => T`——基类把这条约定固定下来，
//     gen-actions 收清单时也只需认这一个形状；
//   - 「我需要什么」写在**用点**（`this.deps.get('config')`），而不是构造函数的参数表
//     ——新增依赖不必改调用方；
//   - action 类只负责「声明 + 实现」，装配（模块编排、依赖注入、注册表收集）
//     都在基类与容器这一层。
import type { Container } from './container.js';

export abstract class ActionBase {
  constructor(protected readonly deps: Container) {}
}
