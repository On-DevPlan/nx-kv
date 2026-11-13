// 契约快照的发布格子：runtime 在装配完成后 publish，模块侧只读。
//
// 与 core/command-table.ts 同一套模式，解决同一个问题：
//   registry → modules → （想读契约的 action）→ registry 成环。
// 去掉环的代价是「读的是快照」而不是「实时算」——契约在启动后不再变，
// 这个代价为零；真要实时算，`nx-kv contract` 也一样是读这份。
import type { ContractSnapshot } from './contract-types.js';

let current: ContractSnapshot | null = null;

/** 由 runtime/registry 在装配完成后调用（只保留最后一次写入）。 */
export function publishContractSnapshot(snapshot: ContractSnapshot): void {
  current = snapshot;
}

/** 当前契约快照；尚未发布时返回 null（纯 CLI 早期调用、单测里直接 build 的场景）。 */
export function contractSnapshot(): ContractSnapshot | null {
  return current;
}

/** 契约指纹（未发布时为 null）：端侧启动自检、日志里打版本都用它。 */
export function contractHash(): string | null {
  return current?.hash ?? null;
}
