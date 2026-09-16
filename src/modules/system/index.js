// 系统模块：聚合与自检。没有业务状态，也没有面板视图。
//
// 分层例外：本模块是刻意的聚合器，允许 import 其他模块的 service。
import { readFileSync } from 'node:fs';
import { configPathFromEnv, loadConfig } from '../../core/config.js';
import { badInput, notFound } from '../../core/errors.js';
import { listGroups } from '../../core/kvapi.js';
import { DEFAULT_PORT } from '../../core/paths.js';

const VERSION = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version;

// 命令表：CLI 命令 ↔ HTTP 路由的对照。
// 动态 import：runtime/registry 静态依赖本模块，静态引入会成环；
// 而该函数只在启动完成后调用，届时 cli.js 早已求值完毕。
async function commandTable() {
  const { ALL_COMMANDS, commandEntry } = await import('../../runtime/cli.js');
  return ALL_COMMANDS.map(commandEntry);
}

// 面板启动上下文。groups 失败不致命——未登录时面板仍应能打开并提示去登录，
// 所以这里降级成空数组而不抛。
async function bootstrap() {
  const cfg = await loadConfig();
  let groups = [];
  let groupsError = '';
  if (cfg.token) {
    try {
      groups = await listGroups();
    } catch (e) {
      groupsError = String(e.message || e);
    }
  }
  return {
    version: VERSION,
    configPath: configPathFromEnv(),
    baseUrl: cfg.baseUrl,
    loggedIn: !!cfg.token,
    email: cfg.email,
    userId: cfg.userId,
    groupId: cfg.groupId,
    groups,
    groupsError,
    defaultPort: DEFAULT_PORT,
    commands: await commandTable(),
  };
}

export default {
  id: 'system',
  title: '系统',
  order: 0,
  view: null,

  actions: [
    {
      id: 'system.bootstrap',
      cli: ['bootstrap'],
      http: ['GET', '/api/bootstrap'],
      summary: '聚合上下文：版本 / 登录态 / 工作空间 / 命令表',
      run: bootstrap,
    },
    {
      id: 'system.health',
      cli: ['health'],
      http: ['GET', '/api/health'],
      summary: '健康检查（本机配置 + 后端可达性）',
      run: async () => {
        const cfg = await loadConfig();
        let backend = 'unreachable';
        let backendError = '';
        try {
          const res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/api/v1/user/info', {
            headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : {},
            signal: AbortSignal.timeout(6000),
          });
          backend = res.ok ? 'reachable' : `http ${res.status}`;
        } catch (e) {
          backendError = String(e.message || e);
        }
        return {
          status: 'ok',
          version: VERSION,
          baseUrl: cfg.baseUrl,
          configPath: configPathFromEnv(),
          loggedIn: !!cfg.token,
          backend,
          backendError,
        };
      },
    },
    {
      id: 'system.routes',
      cli: ['routes'],
      http: null,
      summary: '命令 ↔ 路由对照表（--module 过滤；--http 反查命令）',
      flags: {
        module: { type: 'string', hint: '模块名' },
        http: { type: 'string', hint: 'METHOD /api/path' },
      },
      run: async (ctx) => {
        const table = await commandTable();
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
      },
      render: (list) => {
        if (!list.length) return '（无匹配）';
        const w = Math.max(...list.map((c) => c.command.length));
        return list
          .map(
            (c) =>
              `${c.command.padEnd(w + 2)}${c.http ? `${c.http.method} ${c.http.path}` : '（仅 CLI，无 HTTP 路由）'}`
          )
          .join('\n');
      },
    },
  ],
};

// ---- 内部小工具 ----

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
