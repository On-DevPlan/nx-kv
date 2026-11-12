// IoC 容器：依赖的**注册与解析**都在这里，业务代码只声明「我需要什么」。
//
// 为什么需要它（而不是模块手工 new 每个 action 类）：
//   - **加一条 action 零登记**——新文件 → gen:actions 收进 manifest → 模块自动装配；
//   - 依赖不在 action 的构造函数里点名，而是运行时按 key 取（`this.deps.get('config')`）
//     ——于是测试可以换一整个容器，而不是逐个改构造参数。
//
// 类型安全：key 与值类型由 **DependencyMap** 接口约束——
//   - `get('config')` 的返回类型自动推导（不需要手写泛型）；
//   - key 拼错 / register 的值类型不匹配，**编译期红**；
//   - 新依赖类型 = 给 DependencyMap 加字段。
//
// 容器是进程级单例（默认容器已注册 core 共享依赖）；测试可 new 一个自己的容器。
import * as configModule from '../core/config.js';
import type * as configTypes from '../core/config.js';

/** 项目级依赖清单：key → 类型。新依赖在此加字段。 */
export interface DependencyMap {
  /** 本机配置（core/config 的服务函数集；测试可注册临时实现）。 */
  config: typeof configTypes;
}

export class Container {
  private readonly providers = new Map<keyof DependencyMap, unknown>();

  /** 注册一个依赖（后注册覆盖先注册）。链式返回自己，便于一行装配。 */
  register<K extends keyof DependencyMap>(key: K, value: DependencyMap[K]): this {
    this.providers.set(key, value);
    return this;
  }

  /** 取依赖；key 拼错编译期即红，没注册就运行时报错并点名 key。 */
  get<K extends keyof DependencyMap>(key: K): DependencyMap[K] {
    if (!this.providers.has(key)) {
      throw new Error(
        `依赖未注册: ${String(key)}（已注册: ${[...this.providers.keys()].join(', ') || '无'}）`,
      );
    }
    return this.providers.get(key) as DependencyMap[K];
  }

  /** 用容器建实例：action 类的构造函数统一只接容器本身。 */
  create<T>(cls: new (deps: Container) => T): T {
    return new cls(this);
  }
}

/** 进程级默认容器：共享依赖在这里注册一次，全项目可用。 */
export const container = new Container().register('config', configModule);
