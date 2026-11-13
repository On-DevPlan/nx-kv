// docs.bind —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约（zod schema）就声明在本文件里——入参类型由基类泛型模板封装；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { z } from 'zod';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import * as refsNs from '../refs.js';
import { renderRef as _renderRef } from '../render.js';
const refs: any = refsNs;
const renderRef: any = _renderRef;

/** docs.bind 的入参契约（CLI 与 HTTP 共用同一份）。 */
const input = z.object({
  repo: z.string().optional().describe("仓库（id / key / 路径 / 名称）"),
  board: z.string().optional().describe("看板（id / key / 名称）"),
  ref: z.string().optional().describe("文档 refId（ref_<16hex>）"),
  path: z.string().optional().describe("外部文件/目录绝对路径（会登记成 origin=external 的 ref）"),
  reset: z.boolean().optional().describe("清空主篇"),
});

export class DocsBindAction extends ActionBase<typeof input> {
  @action({
    id: 'docs.bind',
    cli: ['docs', 'bind'],
    // 仅 CLI：绑定写宿主 ext，前端走宿主文档集接口
    summary: '绑定项目/组介绍的主篇（--repo 或 --board 二选一 + --ref <refId> | --path <外部文件/目录>；--reset 清空）',
    input,
    render: renderRef,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refs.setDocRef(ctx);
  
  }
}
