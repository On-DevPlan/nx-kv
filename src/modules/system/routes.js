// `routes` 命令：命令表 ↔ HTTP 路由的对照与反查。
//
// 它为什么住在 system 模块、却由 runtime 装配：
// 表的数据源是 `ALL_COMMANDS`，只有 runtime/cli.js 知道它。模块不能 import
// runtime（registry → modules → cli → registry 会成环），所以这里只放**纯逻辑**，
// 表由调用方传进来 —— runtime → modules 是允许的方向，反过来不是。
//
// 历史上这段逻辑直接写在 index.js 的 action 里，靠 `await import('../../runtime/cli.js')`
// 绕开环：命令能跑，但分层倒了，而且一旦 loader 处理顺序变化，就会静默拿到半初始化的模块。
import { badInput, notFound } from '../../core/errors.js';

/** `--module` / `--http` 的声明（由 cli.js 挂到平台命令上） */
export const ROUTES_FLAGS = {
  module: { type: 'string', hint: '模块名' },
  http: { type: 'string', hint: 'METHOD /api/path' },
};

/**
 * @param {Array} table 每行形如 { id, module, command, usage, http, summary }
 * @param {{ module?: string, http?: string }} ctx
 */
export function filterRoutes(table, ctx = {}) {
  if (ctx.http) {
    const { method, path } = parseHttpQuery(ctx.http);
    const hit = table.filter(
      (c) => c.http && (!method || c.http.method === method) && routeMatches(c.http.path, path)
    );
    if (!hit.length) throw notFound(`没有路由匹配: ${ctx.http}（用 nx-kv routes 查看全部对照）`);
    return hit;
  }
  if (!ctx.module) return table;

  const known = [...new Set(table.map((c) => c.module))];
  if (!known.includes(ctx.module)) {
    throw badInput(`未知模块: ${ctx.module}（可用: ${known.join(', ')}）`);
  }
  return table.filter((c) => c.module === ctx.module);
}

/** CLI 人读渲染：命令左对齐，右侧是它的 HTTP 等价（或「仅 CLI」） */
export function renderRoutes(list) {
  if (!list.length) return '（无匹配）';
  const w = Math.max(...list.map((c) => c.command.length));
  return list
    .map(
      (c) =>
        `${c.command.padEnd(w + 2)}${c.http ? `${c.http.method} ${c.http.path}` : '（仅 CLI，无 HTTP 路由）'}`
    )
    .join('\n');
}

// ---- 内部 ----

function parseHttpQuery(input) {
  const s = String(input || '').trim();
  const m = /^([A-Za-z]+)\s+(.*)$/.exec(s);
  const method = m ? m[1].toUpperCase() : null;
  const path = (m ? m[2] : s).split('?')[0];
  if (!path.startsWith('/')) {
    throw badInput(`HTTP 查询需形如 "/api/todo" 或 "GET /api/todo"，收到: ${input}`);
  }
  return { method, path };
}

// 段对段比较：`:param` 视为通配
function routeMatches(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}
