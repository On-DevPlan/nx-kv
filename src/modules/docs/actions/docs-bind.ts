// docs.bind —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { docsBindInput } from '../schemas.js';
import * as refsNs from '../refs.js';
import { renderRef as _renderRef } from '../render.js';
const refs: any = refsNs;
const renderRef: any = _renderRef;

export class DocsBindAction extends ActionBase<typeof docsBindInput> {
  @action({
    id: 'docs.bind',
    cli: ['docs', 'bind'],
    http: ['POST', '/api/docs/bind'],
    summary: '绑定项目/组介绍的文档覆盖（--repo 或 --board 二选一 + --rel <自有路径> | --path <外部文件/目录>；--reset 拆回约定路径）',
    input: docsBindInput,
    render: renderRef,
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return refs.setDocRef(ctx);
  
  }
}
