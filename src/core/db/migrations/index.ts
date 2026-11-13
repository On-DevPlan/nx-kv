// 存储版本迁移区：每个版本一份**不可变** DDL 快照，一条边一个跃迁。
//
// 目录约定：
//   v1.sql  = 版本 1 的完整 schema（历史快照，永不修改）
//   v2.sql  = 1 → 2 的跃迁脚本（建 attachments/task_attach/ref_attach、删两张空表）
//   v3.sql  = 2 → 3 的跃迁脚本（templates 加 scope/origin_topic）
//   v4.sql  = 3 → 4 的跃迁脚本（建 group_refs：参考仓库绑定升到组级）
//   v5.sql  = 4 → 5 的跃迁脚本（重建 attachments：新增 mdfile / external / 路径列）
//   v6.sql  = 5 → 6 的跃迁脚本（refs.rel/origin/body_bytes + ref_bodies + ref_attach 增 source）
//   index.js= 边映射表 + 路径规划（本文件）
//
// 规则（与 docs/decisions/versions 下的版本说明同一口径）：
//   · 只升不降，禁止跨版本回写旧结构；
//   · 启动时按 EDGE_MAP 规划路径，缺边直接报错，不静默跳过；
//   · 组合边（如 0→2）不写脚本，由直接边串联，EDGE_MAP 里显式登记。
import { readFileSync } from 'node:fs';
import { migrateAttachments } from './v2-data.js';
import { migrateGroupRefs } from './v4-data.js';
import { migrateRefsBodies } from './v6-data.js';
import { migrateRefsRel } from './v8-data.js';
import { CURRENT_SCHEMA_VERSION } from '../version.js';
import type { DbApi } from '../driver.js';

/** 一条迁移步骤（直接边 = 一次版本跃迁）。`apply` 与 DDL 在同一个事务里执行。 */
export interface MigrationStep {
  from: number;
  to: number;
  file: string;
  title: string;
  apply?: (conn: DbApi, context: any) => void;
}

/** 边映射表里的一条边：直接边，或由直接边串联出的组合边。 */
export interface MigrationEdge {
  from: number;
  to: number;
  kind: 'direct' | 'composed';
  steps: MigrationStep[];
  via: number[];
}

/** 人读的边清单条目。 */
export interface EdgeDescription {
  from: number;
  to: number;
  kind: string;
  via: number[];
  title: string;
}

/** 每条直接边 = 一次版本跃迁。`apply` 与 DDL 在同一个事务里执行。 */
export const DIRECT_EDGES: MigrationStep[] = [
  { from: 0, to: 1, file: 'v1.sql', title: '初始 schema（topics/tasks/refs/…）' },
  { from: 1, to: 2, file: 'v2.sql', title: '附件/资源统一模型', apply: migrateAttachments },
  { from: 2, to: 3, file: 'v3.sql', title: '模板可见域（scope/origin_topic）' },
  { from: 3, to: 4, file: 'v4.sql', title: '参考仓库绑定升到组级（group_refs）', apply: migrateGroupRefs },
  { from: 4, to: 5, file: 'v5.sql', title: '附件新增 mdfile（本地 md 指针）' },
  { from: 5, to: 6, file: 'v6.sql', title: 'refs 正文入库（rel / ref_bodies / source）', apply: migrateRefsBodies },
  { from: 6, to: 7, file: 'v7.sql', title: 'refs 描述字段（desc）' },
  { from: 7, to: 8, file: 'v8.sql', title: '去 rel：ref 只按 id / locator 寻址（bindings 补 tag）', apply: migrateRefsRel },
];

// 人读版本说明（docs/decisions 是决策的唯一权威位置，里面对应一份 date 化的 .md）
export const VERSION_NOTES = {
  1: 'docs/decisions/versions/2026-11-08-v1.md',
  2: 'docs/decisions/versions/2026-11-08-v2.md',
  3: 'docs/decisions/versions/2026-11-09-v3.md',
  4: 'docs/decisions/versions/2026-11-09-v4.md',
  5: 'docs/decisions/versions/2026-11-12-v5.md',
  6: 'docs/decisions/versions/2026-11-12-v6.md',
  7: 'docs/decisions/versions/2026-11-12-v7.md',
  8: 'docs/decisions/versions/2026-11-13-v8.md',
};

const keyOf = (from: number, to: number): string => `${from}->${to}`;

/**
 * 显式登记所有可用边：直接边 + 由直接边串联出的组合边。
 * 组合边记录 `via`（中间经过的版本），启动时按它逐步执行。
 */
export function buildEdgeMap(): Map<string, MigrationEdge> {
  const map = new Map<string, MigrationEdge>();
  for (const e of DIRECT_EDGES) {
    map.set(keyOf(e.from, e.to), { from: e.from, to: e.to, kind: 'direct', steps: [e], via: [e.to] });
  }
  // 递增版本的组合边（0..CURRENT 只有个位数，BFS 足够）。
  for (const start of [0, ...DIRECT_EDGES.flatMap((e) => [e.from, e.to])]) {
    for (const target of [0, ...DIRECT_EDGES.flatMap((e) => [e.from, e.to])]) {
      if (start >= target) continue;
      if (map.has(keyOf(start, target))) continue;
      const steps: MigrationStep[] = [];
      let cur = start;
      const via = [start];
      while (cur < target) {
        const next = DIRECT_EDGES.find((e) => e.from === cur && e.to <= target);
        if (!next) break;
        steps.push(next);
        cur = next.to;
        via.push(cur);
      }
      if (cur === target) {
        map.set(keyOf(start, target), { from: start, to: target, kind: 'composed', steps, via });
      }
    }
  }
  return map;
}

export const EDGE_MAP = buildEdgeMap();

/** 人读的边清单（CLI/文档用）：直接边与组合边各一行。 */
export function describeEdges(): EdgeDescription[] {
  return [...EDGE_MAP.values()].map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    via: e.via,
    title: e.kind === 'direct' ? e.steps[0]?.title ?? '' : `${e.via.join(' → ')}（组合）`,
  }));
}

/**
 * 规划 from → to 的迁移路径。
 * @returns {Array<object>} 直接边步骤（按顺序）
 * @throws 缺边时明确报错，列出当前已登记的边
 */
export function planMigrationPath(from: unknown, to: unknown = CURRENT_SCHEMA_VERSION): MigrationStep[] {
  const a = Math.trunc(Number(from) || 0);
  const b = Math.trunc(Number(to) || 0);
  if (b < a) {
    throw new Error(`存储版本不支持降级：${a} → ${b}（只允许单向升级）`);
  }
  if (a === b) return [];
  const edge = EDGE_MAP.get(keyOf(a, b));
  if (!edge) {
    const known = describeEdges().map((e) => `${e.from}→${e.to}${e.kind === 'composed' ? `(经 ${e.via.join('→')})` : '(直接)'}`);
    throw new Error(
      `缺少迁移边 ${a} → ${b}；当前可用: ${known.join('、') || '无'}。请先在 migrations/index.js 登记一条直接边。`
    );
  }
  return edge.steps;
}

/** 读一份版本快照 / 跃迁脚本（随包发布，SQL 保持可独立 review）。 */
export function readMigrationSql(file: string): string {
  return readFileSync(new URL('./' + file, import.meta.url), 'utf8');
}

/** 所有直接边按目标版本排序（供 pendingSteps 使用）。 */
export const MIGRATION_STEPS = [...DIRECT_EDGES].sort((x, y) => x.to - y.to);
