// 旧任务模板可见域（scope）的纯解析：插件内部使用，不暴露给宿主 UI。
//
// 词表：'*' / topic:<key> / repo:<key> / group:<key>。空 scope = 未配置（不可见）；
// ctx 三把钥匙都为空时（管理/列表上下文）视为可见，避免管理页看不到模板。

export interface ScopeCtx {
  topicKey?: string;
  groupKey?: string;
  repoKey?: string;
}

const KINDS = ['topic', 'repo', 'group'] as const;
const MAX_ENTRIES = 32;

export function isScopeEntry(value: unknown): boolean {
  const s = String(value ?? '');
  if (s === '*') return true;
  const i = s.indexOf(':');
  if (i <= 0) return false;
  const kind = s.slice(0, i);
  const key = s.slice(i + 1);
  return (KINDS as readonly string[]).includes(kind) && !!key && key.length <= 200 && !/\s/.test(key);
}

export function normalizeScope(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = String(item ?? '').trim();
    if (!isScopeEntry(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

export function canUse(scope: readonly string[], ctx: ScopeCtx): boolean {
  const hasCtx = !!(ctx.topicKey || ctx.repoKey || ctx.groupKey);
  if (!hasCtx) return true; // 管理/枚举上下文
  if (!scope.length) return false;
  if (scope.includes('*')) return true;
  if (ctx.topicKey && scope.includes(`topic:${ctx.topicKey}`)) return true;
  if (ctx.repoKey && scope.includes(`repo:${ctx.repoKey}`)) return true;
  if (ctx.groupKey && scope.includes(`group:${ctx.groupKey}`)) return true;
  return false;
}
