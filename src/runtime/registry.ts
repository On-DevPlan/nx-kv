// 模块注册表：全部功能域的 action 在此汇合。
//
// CLI 命令表、HTTP 路由表、help 文本三者全部由此派生 —— 这是
// 「Web 上每个操作都有等价 CLI 命令」得以成为**结构性保证**而非口头约定的原因：
// 一条 action 同时声明 cli 与 http，二者写在同一处，不可能分叉。
//
// 新增功能域：
//   1. 写 src/modules/<name>/（模板形态：index.ts 装配 ModuleBase 子类 +
//      actions/*.ts 一条 action 一个文件（契约 zod 就声明在该文件里）+ _manifest.generated.ts）
//   2. 在下面的 create 调用里加上它的实例
//   3. 需要面板的话，到 web/frontend/ 写视图并在前端 registry 登记——**不经过后端**
//
// 前端怎么呈现，后端不知道也不该知道：本文件里没有任何前端路径。
// 后端只提供 /api/*，前端只消费 /api/*，跨端的唯一例外是同构纯函数（src/shared/）。
// tests/unit/registry.test.mjs 会断言两侧的模块集合对齐，漏登记直接测试失败。
//
// **双通道**：业务模块全部是模板形态（@action + zod 契约）；legacy plain-object
// （flags 表契约）只剩 runtime 内建命令（serve / help / version）在用。
// 两者都满足 AnyModule，Registry 对通道无感——load 期自检对两通道一视同仁
// （重复 id / 重复路由 / 缺 run 启动即红）。
import { ModuleBase, type AnyModule } from './types/module.js';
import { cliPathsOf, entryOf, type AnyAction } from './spec.js';
import { publishCommandTable } from '../core/command-table.js';
import { publishContractSnapshot } from '../core/contract-snapshot.js';
import { buildContractSnapshot } from './contract.js';
import type { ZodBoundAction } from './action-decorator.js';
import { readFileSync } from 'node:fs';
import systemModule from '../modules/system/index.js';
import setting from '../modules/setting/index.js';
import localtask from '../modules/localtask/index.js';
import tasktool from '../modules/tasktool/index.js';
import repos from '../modules/repos/index.js';
import docs from '../modules/docs/index.js';
import file from '../modules/file/index.js';
import templates from '../modules/templates/index.js';
import bundled from '../modules/bundled/index.js';
import db from '../modules/db/index.js';

const MODULE_LIST: readonly AnyModule[] = [
  systemModule,
  setting,
  localtask,
  tasktool,
  repos,
  docs,
  file,
  templates,
  bundled,
  db,
];

/** 模块元组：全部业务域（tests/unit/registry.test.mjs 对账模块目录一一对应）。 */
export const MODULES: readonly AnyModule[] = [...MODULE_LIST].sort(
  (a, b) => (a.order ?? 100) - (b.order ?? 100),
);

export class Registry {
  private constructor(
    readonly modules: readonly AnyModule[],
    readonly actions: readonly AnyAction[],
  ) {}

  /**
   * 唯一装载入口。装载正确性由这里的运行时自检负责
   * （重复 id / 重复 CLI 路由 / 重复 HTTP 路由 / 缺 run / rest flag 置尾）。
   * 运行时按 order 排序。
   */
  static create(modules: readonly AnyModule[]): Registry {
    const sorted = [...modules].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    const actions = sorted.flatMap((m) =>
      (m.actions || []).map((a) => ({ ...(a as object), module: m.id }) as AnyAction),
    );

    // 装载期自检：把「两个模块声明了同名命令」这类问题暴露在启动瞬间，
    // 而不是等某个用户敲到那条命令时才发现。
    //
    // 方向性约定（刻意的不对称）：
    //   - 每条 action 都必须有 cli —— 保证「Web 上能做的，CLI 都能做」
    //   - http 允许为 null（纯 CLI 命令），但**不允许**声明 http 却没有 cli
    const seenIds = new Set<string>();
    const seenCli = new Set<string>();
    const seenHttp = new Set<string>();
    for (const a of actions) {
      if (seenIds.has(a.id)) throw new Error('action id 重复: ' + a.id);
      seenIds.add(a.id);

      const paths = cliPathsOf(a);
      if (!paths.length) throw new Error(`action 没有声明 CLI 命令（Web 操作必须有 CLI 等价）: ${a.id}`);
      for (const path of paths) {
        const key = path.join(' ');
        if (seenCli.has(key)) throw new Error(`CLI 命令重复: ${key}（action ${a.id}）`);
        seenCli.add(key);
      }

      if (a.http) {
        const httpKey = a.http[0] + ' ' + a.http[1];
        if (seenHttp.has(httpKey)) throw new Error(`HTTP 路由重复: ${httpKey}（action ${a.id}）`);
        seenHttp.add(httpKey);
      } else if (a.http !== null) {
        throw new Error(`action 的 http 必须是路由数组或显式 null: ${a.id}`);
      }

      if (!a.run) throw new Error(`action 缺少 run: ${a.id}`);

      // rest flag（吃掉其后全部 token，见 spec.ts）必须在声明里排最后：
      // CLI 是「谁的路径最长谁赢」，flag 的先后由声明顺序决定；一旦后面还跟着别的 flag，
      // 它就会被当成值的一部分静默吞掉——命令照跑，参数却没了。
      // （仅 legacy flags 通道有 rest flag；zod 通道用 restArg，无此约束。）
      const flagNames = Object.keys(a.flags || {});
      if (flagNames.length) {
        const restAt = flagNames.findIndex((n) => (a.flags![n] as { rest?: boolean }).rest);
        if (restAt >= 0 && restAt !== flagNames.length - 1) {
          throw new Error(
            `rest flag 必须声明在 flags 的最后（其后还有: ${flagNames.slice(restAt + 1).join(', ')}）: ${a.id}`,
          );
        }
      }
    }

    return new Registry(sorted, actions);
  }
}

/** 全项目唯一注册表实例：CliApp / ApiRouter / 编程入口都从它取 action 与命令表。 */
export const registry = Registry.create(MODULES);

// 兼容别名：ACTIONS 是 registry.actions 的投影；tests 与文档沿用旧名。
export const ACTIONS = registry.actions;

// 命令表快照：模块（system.bootstrap 要给面板下发「CLI 等价」）只读这份，
// 不再 import runtime —— registry → modules → cli → registry 正是那条要避开的环。
// cli.ts 在装配出 ALL_COMMANDS 后会再覆盖一次（含 serve / help / version
// 这类平台命令），所以「从 CLI 跑」拿到的是完整表，纯 HTTP 场景拿到的是 action 表。
publishCommandTable(ACTIONS.map(entryOf));

// 契约快照：只在启动期算一次，模块侧（system.contract）只读这份。
// 与命令表同理——registry → modules → 想读契约的 action → registry 会成环，
// 快照把环断开；契约在装配后不再变化，所以「读快照」没有时效问题。
const VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;
publishContractSnapshot(
  buildContractSnapshot(
    ACTIONS.filter((a) => Array.isArray((a as Partial<ZodBoundAction>).fields)) as unknown as ZodBoundAction[],
    { app: 'nx-kv', version: VERSION },
  ),
);

// ModuleBase 仅为类型连贯在此重导出：模块作者从 types/module.js 拿基类，
// runtime 侧不主动扩散它。
export { ModuleBase };
