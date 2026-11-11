// system.bootstrap —— 面板启动上下文：版本 / 登录态 / 工作空间 / 命令表。
//
// 「一条 action 一个文件」：声明（@action 元数据）与实现同文件；契约在 ../schemas.ts。
// 依赖经 IoC 容器取（this.deps.get('config')）——测试可换一整个容器，不必改构造参数。
import { readFileSync } from 'node:fs';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { commandTable, type CommandEntry } from '../../../core/command-table.js';
import { APP_NAME, DEFAULT_PORT } from '../../../core/paths.js';
import { systemBootstrapInput } from '../schemas.js';

/** package.json 的版本号（只读一次；与 cli.ts 各读各的，避免引入跨层依赖）。 */
const VERSION: string = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
).version;

export class BootstrapAction extends ActionBase<typeof systemBootstrapInput> {
  @action({
    id: 'system.bootstrap',
    cli: ['bootstrap'],
    http: ['GET', '/api/bootstrap'],
    summary: '聚合上下文：版本 / 登录态 / 工作空间 / 命令表',
    input: systemBootstrapInput,
  })
  override async run(_ctx: ActionInput<this['_input']>): Promise<{
    app: { name: string; version: string };
    version: string;
    configPath: string;
    baseUrl: string;
    loggedIn: boolean;
    email: string;
    userId: number;
    groupId: number;
    groups: unknown[];
    groupsError: string;
    defaultPort: number;
    projectRoot: string;
    commands: CommandEntry[];
  }> {
    const config = this.deps.get('config');
    const kvapi = this.deps.get('kvapi');
    const cfg = await config.loadConfig();
    let groups: unknown[] = [];
    let groupsError = '';
    if (cfg.token) {
      try {
        groups = await kvapi.listGroups();
      } catch (e) {
        groupsError = String((e as { message?: string }).message || e);
      }
    }
    return {
      // app 段是跨项目的认领签名：serve 端口被占时靠 app.name 判断
      // 「上面跑的是不是本项目的面板」——相同则复用，不同则顺延端口。
      app: { name: APP_NAME, version: VERSION },
      version: VERSION,
      configPath: config.configPathFromEnv(),
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
      // 命令表由 runtime 写进 core 的快照格子（见 core/command-table.ts）。
      // 没有快照时给空数组：面板照常打开，只是没有「CLI 等价」提示。
      commands: commandTable(),
    };
  }
}
