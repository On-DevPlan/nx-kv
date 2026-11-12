// `routes` 命令的纯逻辑：命令表 ↔ HTTP 路由的对照与反查。
//
// 它为什么只放纯函数、表由调用方传入：表的数据源是 runtime 装配的命令表
// （经 core/command-table 的快照格子），模块不能 import runtime
// （registry → modules → cli → registry 会成环）。
// 历史上这段逻辑靠 `await import('../../runtime/cli.js')` 绕开环：命令能跑，
// 但分层倒了，而且 loader 处理顺序一变就可能拿到半初始化的模块。
import { badInput, notFound } from '../../core/errors.js';
import type { CommandEntry } from '../../core/command-table.js';

/** routes 的输入（--module / --http，schema 见本文件下方）。 */
export interface RoutesCtx {
  module?: string;
  http?: string;
}

/** 对照表过滤：--http 反查（METHOD /api/path，:param 视为通配）；--module 正查。 */
export function filterRoutes(table: readonly CommandEntry[], ctx: RoutesCtx = {}): CommandEntry[] {
  if (ctx.http) {
    const { method, path } = parseHttpQuery(ctx.http);
    const hit = table.filter(
      (c) => c.http && (!method || c.http.method === method) && routeMatches(c.http.path, path),
    );
    if (!hit.length) throw notFound(`没有路由匹配: ${ctx.http}（用 nx-kv routes 查看全部对照）`);
    return hit;
  }
  if (!ctx.module) return [...table];

  const known = [...new Set(table.map((c) => c.module))];
  if (!known.includes(ctx.module)) {
    throw badInput(`未知模块: ${ctx.module}（可用: ${known.join(', ')}）`);
  }
  return table.filter((c) => c.module === ctx.module);
}

/** CLI 人读渲染：命令左对齐，右侧是它的 HTTP 等价（或「仅 CLI」） */
export function renderRoutes(list: readonly CommandEntry[]): string {
  if (!list.length) return '（无匹配）';
  const w = Math.max(...list.map((c) => c.command.length));
  return list
    .map(
      (c) =>
        `${c.command.padEnd(w + 2)}${c.http ? `${c.http.method} ${c.http.path}` : '（仅 CLI，无 HTTP 路由）'}`,
    )
    .join('\n');
}

// ---- 内部 ----

function parseHttpQuery(input: string): { method: string | null; path: string } {
  const s = String(input || '').trim();
  const m = /^([A-Za-z]+)\s+(.*)$/.exec(s);
  const method = m ? m[1]!.toUpperCase() : null;
  const path = (m ? m[2]! : s).split('?')[0]!;
  if (!path.startsWith('/')) {
    throw badInput(`HTTP 查询需形如 "/api/localtasks" 或 "GET /api/localtasks"，收到: ${input}`);
  }
  return { method, path };
}

// 段对段比较：`:param` 视为通配
function routeMatches(pattern: string, path: string): boolean {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}
