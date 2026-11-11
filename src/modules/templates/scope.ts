// 模板可见域（scope）纯解析：无 DB、无 IO，service 与前端可共享同一套判定。
//
// 评估与裁决见 plan/2026-11-09-template-architecture-eval.md §2（任务 #123/#128）：
// 不做 policy 引擎，一条可见性规则 + 一条编辑权规则，全是纯函数。
//
// scope 条目词表（写库前经 normalizeScope 归一，非法条目进不来）：
//   "*"             全局可见
//   "topic:<key>"   指定队列主题（topics.key，含全局池 __GLOBAL__）
//   "repo:<key>"    指定项目（repos.key）
//   "group:<key>"   指定项目组（组也是 repos.key，type='group'）
//
// 判定口径：
//   可见（use）  = scope 含 "*"，或命中主题行三把钥匙（key / repoKey / groupKey）之一；
//   可编辑（edit）= origin_topic 命中本主题，或 scope 显式点名本主题——比 use 严：
//                  "*" 只给「能用」，不给「能改」；repo/group 域同样不给改
//                  （改模板是全机影响，只有创建处与显式点名处可以动）。
import { badInput } from '../../core/errors.js';

export const GLOBAL_SCOPE = '*';
const KINDS = ['topic', 'repo', 'group'];
const SCOPE_MAX_ENTRIES = 32;
const KEY_MAX_LEN = 200;

export interface TopicCtx {
  key: string;
  repoKey: string;
  groupKey: string;
}

/** 单条 scope 条目是否合法（"*" 或 <kind>:<非空无空白 key>）。 */
export function isScopeEntry(s: unknown): boolean {
  const v = String(s ?? '');
  if (v === GLOBAL_SCOPE) return true;
  const i = v.indexOf(':');
  if (i <= 0) return false;
  const kind = v.slice(0, i);
  const key = v.slice(i + 1);
  return KINDS.includes(kind) && !!key && key.length <= KEY_MAX_LEN && !/\s/.test(key);
}

/**
 * 归一化 scope：收数组（或 JSON 串），去重保序、丢弃非法条目、限 32 条。
 * strict=true（CLI/HTTP 写入路径）时遇到非法条目直接报错——静默丢弃会让
 * 「我以为设了域其实没设上」；读取路径（DB 行反解）用宽松档兜脏数据。
 */
export function normalizeScope(raw: unknown, { strict = false }: { strict?: boolean } = {}): string[] {
  let arr: unknown = raw;
  if (typeof arr === 'string') {
    const s = arr.trim();
    if (!s) return [];
    try {
      arr = JSON.parse(s);
    } catch (e) {
      if (strict) throw badInput(`--scope 要传 JSON 数组（形如 ["*"] 或 ["topic:<key>"]）：${(e as Error).message || e}`);
      return [];
    }
  }
  if (arr == null) return strict ? [] : [];
  if (!Array.isArray(arr)) {
    if (strict) throw badInput('--scope 要传 JSON 数组（形如 ["*"] 或 ["topic:<key>"]）');
    return [];
  }
  const out: string[] = [];
  for (const item of arr) {
    const v = String(item ?? '').trim();
    if (!isScopeEntry(v)) {
      if (strict) {
        throw badInput(
          `--scope 里有不认识的条目「${v}」——合法写法：* / topic:<key> / repo:<key> / group:<key>`
        );
      }
      continue;
    }
    if (!out.includes(v)) out.push(v);
    if (out.length >= SCOPE_MAX_ENTRIES) break;
  }
  return out;
}

/** 主题判定上下文：三把钥匙（topics 行的 camelCase 影子）。 */
export function topicCtx({ key = '', repoKey = '', groupKey = '' }: { key?: unknown; repoKey?: unknown; groupKey?: unknown } = {}): TopicCtx {
  return { key: String(key || ''), repoKey: String(repoKey || ''), groupKey: String(groupKey || '') };
}

/** 条目是否命中主题上下文（"*" 不在此判——它是可见性的全局短路，见 canUse）。 */
function entryHits(entry: string, ctx: TopicCtx): boolean {
  const i = entry.indexOf(':');
  const kind = entry.slice(0, i);
  const key = entry.slice(i + 1);
  if (kind === 'topic') return key === ctx.key;
  if (kind === 'repo') return key === ctx.repoKey;
  if (kind === 'group') return key === ctx.groupKey;
  return false;
}

/** 该模板对主题 ctx 是否可用（菜单里出不出来）。 */
export function canUse(t: any, ctx: TopicCtx): boolean {
  const scope: any[] = Array.isArray(t && t.scope) ? t.scope : [];
  if (scope.includes(GLOBAL_SCOPE)) return true;
  return scope.some((s) => isScopeEntry(s) && entryHits(s, ctx));
}

/** 该模板在主题 ctx 是否可编辑（origin 命中或 scope 显式点名；比 use 严）。 */
export function canEdit(t: any, ctx: TopicCtx): boolean {
  if (t && t.originTopic && t.originTopic === ctx.key) return true;
  const scope: any[] = Array.isArray(t && t.scope) ? t.scope : [];
  return scope.includes(`topic:${ctx.key}`);
}

/** 一列模板按可见域过滤（保持原顺序）。 */
export function visibleTemplates(list: any[] | null | undefined, ctx: TopicCtx): any[] {
  return (list || []).filter((t) => canUse(t, ctx));
}
