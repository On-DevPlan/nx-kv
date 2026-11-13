// system.bootstrap —— 面板启动上下文：版本 / 命令表。
//
// 「一条 action 一个文件」：声明（@action 元数据）、契约（zod）与实现同文件。
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { commandTable, type CommandEntry } from '../../../core/command-table.js';
import { APP_NAME, DEFAULT_PORT } from '../../../core/paths.js';

/** package.json 的版本号（只读一次；与 cli.ts 各读各的，避免引入跨层依赖）。 */
const VERSION: string = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
).version;

/** system.bootstrap 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({});

/**
 * system.bootstrap 的**出参视图**：端侧启动只要「我是谁 / 版本 / 命令表」，
 * 不声明 projectRoot 也行——但端侧界面要显示当前宿主目录，所以留着。
 */
const output = z.object({
  app: z.object({
    name: z.string().describe('应用标识（面板端口占用时靠它认领）'),
    version: z.string(),
  }),
  version: z.string(),
  defaultPort: z.int().describe('面板默认端口'),
  projectRoot: z.string().describe('面板进程的工作目录'),
  commands: z.array(
    z.object({
      id: z.string(),
      module: z.string(),
      command: z.string().describe('CLI 命令（如 `nx-kv localtask list`）'),
      usage: z.string().describe('完整用法串'),
      http: z.object({ method: z.string(), path: z.string() }).nullable(),
      summary: z.string().optional(),
    }),
  ),
});

export class BootstrapAction extends ActionBase<typeof input> {
  @action({
    id: 'system.bootstrap',
    cli: ['bootstrap'],
    http: ['GET', '/api/bootstrap'],
    summary: '聚合上下文：版本 / 命令表',
    input,
    output,
  })
  override async run(_ctx: ActionInput<this['_input']>): Promise<{
    app: { name: string; version: string };
    version: string;
    defaultPort: number;
    projectRoot: string;
    commands: CommandEntry[];
  }> {
    return {
      // app 段是跨项目的认领签名：serve 端口被占时靠 app.name 判断
      // 「上面跑的是不是本项目的面板」——相同则复用，不同则顺延端口。
      app: { name: APP_NAME, version: VERSION },
      version: VERSION,
      defaultPort: DEFAULT_PORT,
      // serve 进程的工作目录：仓库页「扫描」的缺省根目录用它（面板进程 cwd 即宿主项目）
      projectRoot: process.cwd(),
      // 命令表由 runtime 写进 core 的快照格子（见 core/command-table.ts）。
      // 没有快照时给空数组：面板照常打开，只是没有「CLI 等价」提示。
      commands: commandTable(),
    };
  }
}
