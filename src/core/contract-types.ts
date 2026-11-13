// 契约快照的**数据类型**与纯函数（无 zod、无 fs、无 Node API）。
//
// 放在 core 的原因：`modules/system/actions/contract.ts` 要按契约发出快照、
// 而模块只允许依赖 core/shared（runtime 的装配层对它不可见）。类型与
// stableStringify/hash 都是纯的，天然属于 core。
//
// 谁生成：runtime/contract.ts（那里才有 zod）→ 由 registry 在装配完成后 publish，
// 模块侧只读 `core/contract-snapshot.ts` 的发布结果（与 command-table 同一套模式）。
import { createHash } from 'node:crypto';

/** 出参类型节点（JSON 安全；模型名内联，便于逐语言发射）。 */
export type TypeNode =
  | { k: 'string' }
  | { k: 'int' }
  | { k: 'number' }
  | { k: 'bool' }
  | { k: 'unknown' }
  | { k: 'enum'; name: string; values: string[] }
  | { k: 'model'; name: string; fields: ModelField[] }
  | { k: 'list'; of: TypeNode }
  | { k: 'map'; of: TypeNode };

export interface ModelField {
  name: string;
  /** 没有 optional / default → 必填（Dart 侧是 `T` 与 `T?` 的差别） */
  required: boolean;
  type: TypeNode;
  hint?: string;
}

/** 入参字段说明（由 runtime/zod-bridge 的 describeInput 产出，形状在这里定）。 */
export interface FieldDesc {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'kv' | 'raw';
  positional: boolean;
  required: boolean;
  default?: unknown;
  enumValues?: string[];
  hint?: string;
}

/** 快照里的一个 action（只含声明了 output 的——不对外就不在契约里）。 */
export interface ContractAction {
  id: string;
  /** CLI 路径（多路径别名会有多条） */
  cli: string[][];
  /** `GET /api/x` 形态；纯 CLI 为 null */
  http: string | null;
  summary?: string;
  input: FieldDesc[];
  output: TypeNode;
}

export interface ContractSnapshot {
  app: string;
  version: string;
  /** sha256(stableStringify({app, actions})) 的前 16 位 */
  hash: string;
  actions: ContractAction[];
}

/** 键排序的 JSON：同内容必然同字节（指纹/对账都靠这个性质）。 */
export function stableStringify(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + walk(obj[k])).join(',') + '}';
    }
    return JSON.stringify(v) ?? 'null';
  };
  return walk(value);
}

/** 契约指纹：端侧拿它跟服务端对账。只覆盖 app + actions（改文案/发版不触发全端重建）。 */
export function hashOf(app: string, actions: readonly ContractAction[]): string {
  // core 允许 node: 内置模块（只要不向上依赖）；web 侧永远不会 import 本文件
  return createHash('sha256').update(stableStringify({ app, actions })).digest('hex').slice(0, 16);
}

/** 两份快照的结构化差异（人读；guard 与 PR 正文用它）。 */
export function diffContracts(
  oldSnap: ContractSnapshot | null,
  newSnap: ContractSnapshot,
): string[] {
  if (!oldSnap) return [`- 旧快照缺失，按全量新增处理（${newSnap.actions.length} 个 action）`];
  const o = new Map(oldSnap.actions.map((a) => [a.id, a]));
  const n = new Map(newSnap.actions.map((a) => [a.id, a]));
  const lines: string[] = [];
  for (const [id, a] of n) {
    const prev = o.get(id);
    if (!prev) {
      lines.push(`+ ${id}`);
      continue;
    }
    if (stableStringify(prev) !== stableStringify(a)) {
      if (prev.http !== a.http) lines.push(`~ ${id}: ${prev.http} → ${a.http}`);
      if (stableStringify(prev.input) !== stableStringify(a.input)) lines.push(`~ ${id}: 入参变化`);
      if (stableStringify(prev.output) !== stableStringify(a.output)) lines.push(`~ ${id}: 出参变化`);
    }
  }
  for (const id of o.keys()) if (!n.has(id)) lines.push(`- ${id}`);
  return lines;
}
