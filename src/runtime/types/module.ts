// 模块类型契约：全部 action 的公共形状，Registry / help / codegen 只认这里。
//
// serve 端的形态约定（对齐 server-cli-web 模板）：
//   - 模块是 **ModuleBase 子类**（id / title / order 是只读成员，业务编排调服务层），
//     注册表是 **Registry 类**（create 静态工厂做装载期自检——重复 id / 路由启动即红），
//     CLI 与 HTTP 分别是 CliApp / ApiRouter 的实例方法；
//   - **迁移期双通道**：存量模块还是 plain-object（flags 表契约），新模块走
//     @action 装饰器（zod 契约）。两者都满足 AnyModule 结构，Registry / CliApp /
//     ApiRouter / help 对通道无感；全部模块迁移完成后，LegacyAction 删除。
//
//   export class SystemModule extends ModuleBase {
//     override readonly id = 'system';
//     override readonly title = '系统';
//     override readonly actions!: ZodBoundAction[];
//     constructor() { super(); this.actions = ACTIONS.flatMap(C => zodActionsOf(container.create(C))); }
//   }

/** 模块的运行时形状：ModuleBase 子类与 legacy plain-object 模块都满足它。 */
export interface AnyModule {
  readonly id: string;
  readonly title: string;
  /** 排序权重，小的在前；缺省按 100。 */
  readonly order?: number;
  /** CRUD 完备性声明：本模块管理的资源名（tests/unit/registry.test.mjs 据此断言五操作齐备）。 */
  readonly resource?: string;
  /** 同上，多资源版本。 */
  readonly resources?: readonly string[];
  /** 本模块的 action 集合（legacy 数组元素或 zod 绑定结果）。 */
  readonly actions?: readonly unknown[];
}

/**
 * 模块基类。子类用只读字段声明 id / title，用 @action 装饰方法声明 action。
 * - 业务逻辑不写在模块里：模块只做「声明 + 装配」，编排调服务层；
 * - actions 用确定赋值断言在构造期组装（依赖要先就绪）；
 * - readonly 字段保住字面量类型（`readonly id = 'system'` 的类型就是 'system'）。
 */
export abstract class ModuleBase {
  abstract readonly id: string;
  abstract readonly title: string;
  readonly order?: number;
  /** CRUD 完备性声明：本模块管理的资源名（tests/unit/registry.test.mjs 据此断言五操作齐备）。 */
  readonly resource?: string;
  /** 同上，多资源版本。 */
  readonly resources?: readonly string[];
  abstract readonly actions: readonly unknown[];
}
