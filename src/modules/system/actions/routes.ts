// system.routes —— 命令表 ↔ HTTP 路由的对照与反查（纯 CLI，无 HTTP 路由）。
//
// 命令表来自 core/command-table 的快照格子：cli.ts 装配完 ALL_COMMANDS 后会覆盖
// 写入**含平台命令的完整版**（registry 先写过一次 action 版）。所以这条命令
// 看到的表与 `help --json` 看到的完全同源同长。过滤逻辑在 ../routes.ts（纯函数），
// 这里只做声明与装配。
import { z } from 'zod';
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { commandTable, type CommandEntry } from '../../../core/command-table.js';
import { filterRoutes, renderRoutes } from '../routes.js';
import { systemRoutesInput } from '../schemas.js';

export class RoutesAction extends ActionBase {
  @action({
    id: 'system.routes',
    cli: ['routes'],
    http: null, // 纯 CLI：对照表本身没有 HTTP 端点（面板从 /api/bootstrap 拿同一张表）
    summary: '命令 ↔ 路由对照表（--module 过滤；--http 反查命令）',
    input: systemRoutesInput,
    render: (list) => renderRoutes(list as CommandEntry[]),
  })
  async routes(ctx: z.output<typeof systemRoutesInput>): Promise<CommandEntry[]> {
    return filterRoutes(commandTable(), ctx);
  }
}
