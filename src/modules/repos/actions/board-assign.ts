// board.assign —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase } from '../../../runtime/action-base.js';
import { boardAssignInput } from '../schemas.js';
import * as boardsNs from '../boards.js';
const boards: any = boardsNs;

export class BoardAssignAction extends ActionBase {
  @action({
    id: 'board.assign',
    cli: ['board', 'assign'],
    http: ['POST', '/api/boards/assign'],
    summary: '把仓库聚合进看板（可同时在多个看板；--remove 移出；--before 插位；仓库给 id / key / 路径）',
    args: ['id'],
    input: boardAssignInput,
    render: (d: any) => (d.removed
      ? `已移出: ${d.key}（${d.count} 个看板）`
      : `${d.added ? '已聚合' : '已在（位次已调）'}: ${d.key} → ${d.board}`),
  })
  async assign(ctx: any) {

      return boards.assignRepo(ctx);
  
  }
}
