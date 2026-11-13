// 契约快照的**构建**（runtime 侧：这里才有 zod）。
//
// 数据形状与纯函数（stableStringify / hashOf / diffContracts）在 core/contract-types.ts
// ——模块要读快照，而模块够不着 runtime。这里只负责「zod action → IR」这一件事。
//
// 为什么要有快照（而不是让生成器直接读 zod）：
//   1. **可对账**：快照入库，`gen:dart --check` 重建一遍比对，声明改了没重新生成 → 红。
//   2. **可协商**：`GET /api/contract` 回的就是它，端侧据此判定自己是不是旧契约。
//   3. **生成器只认 IR**：Dart 发射器不 import zod，zod 内部结构变化波及不到生成器。
import type { ZodBoundAction } from './action-decorator.js';
import { describeOutput } from './zod-bridge.js';
import {
  hashOf,
  type ContractAction,
  type ContractSnapshot,
} from '../core/contract-types.js';

/** CLI 声明可能是单路径也可能是别名列表：统一成「路径数组的数组」。 */
function cliPathsOf(cli: ZodBoundAction['cli']): string[][] {
  const first = (cli as readonly unknown[])[0];
  return Array.isArray(first)
    ? (cli as readonly (readonly string[])[]).map((p) => [...p])
    : [[...(cli as readonly string[])]];
}

/**
 * 根模型名：action 类名去掉 `Action` 后缀 + `Output`。
 * 例：`LocaltaskListAction` → `LocaltaskListOutput`。
 * 用类名而不是 action id：id 允许出现 `.` 和 `-`，类名天然是合法标识符。
 */
export function rootModelNameOf(action: ZodBoundAction): string {
  return action.className.replace(/Action$/, '') + 'Output';
}

/**
 * 从注册表里的 zod action 构建快照。
 * 只收声明了 `output` 的 action——**不对外就不在契约里**，这是最省事的访问控制。
 */
export function buildContractSnapshot(
  actions: readonly ZodBoundAction[],
  meta: { app: string; version: string },
): ContractSnapshot {
  const picked = actions
    .filter((a) => a.output)
    .map((a) => {
      const out: ContractAction = {
        id: a.id,
        cli: cliPathsOf(a.cli),
        http: a.http ? `${a.http[0]} ${a.http[1]}` : null,
        input: a.fields,
        output: describeOutput(a.output!, rootModelNameOf(a)),
      };
      if (a.summary) out.summary = a.summary;
      return out;
    })
    .sort((x, y) => x.id.localeCompare(y.id));

  return {
    app: meta.app,
    version: meta.version,
    hash: hashOf(meta.app, picked),
    actions: picked,
  };
}

export type { ContractAction, ContractSnapshot } from '../core/contract-types.js';
