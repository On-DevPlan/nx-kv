// 系统模块：聚合与自检。没有业务状态，也没有面板视图。
//
// 分层例外：本模块是刻意的聚合器，允许 import 其他模块的 service。
//
// `routes`（命令表对照）不在这里：它的数据源 ALL_COMMANDS 只有 runtime 知道，
// 放在模块里就得反着依赖 runtime。逻辑在 ./routes.js（纯函数，表由调用方传入），
// 命令本身作为平台命令挂在 runtime/cli.js 的 BUILTINS 上。
import { readFileSync } from 'node:fs';
import { configPathFromEnv, loadConfig } from '../../core/config.js';
import { commandTable } from '../../core/command-table.js';
import { listGroups } from '../../core/kvapi.js';
import { APP_NAME, DEFAULT_PORT } from '../../core/paths.js';

const VERSION = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
).version;

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
    // app 段是跨项目的认领签名：serve 端口被占时靠 app.name 判断
    // 「上面跑的是不是本项目的面板」——相等则复用，不等则顺延端口。
    app: { name: APP_NAME, version: VERSION },
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
    // serve 进程的工作目录：仓库页「扫描」的缺省根目录用它（面板进程 cwd 即宿主项目）
    projectRoot: process.cwd(),
    // 命令表由 runtime 写进 core 的快照（见 core/command-table.js）。
    // 没有快照时给空数组：面板照常打开，只是没有「CLI 等价」提示。
    commands: commandTable(),
  };
}

export default {
  id: 'system',
  title: '系统',
  order: 0,

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
  ],
};
