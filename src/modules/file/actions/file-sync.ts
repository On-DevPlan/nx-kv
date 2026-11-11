// file.sync —— 由 .tool/migrate-module.mjs 从 legacy 形态迁来（模板形态：一条 action 一个文件）。
//
// 契约常量在 ../schemas.ts（zod）；本文件只做「声明 + 实现」，业务在服务层。
import { action } from '../../../runtime/action-decorator.js';
import { ActionBase, type ActionInput } from '../../../runtime/action-base.js';
import { fileSyncInput } from '../schemas.js';
import * as serviceNs from '../service.js';
const service: any = serviceNs;

export class FileSyncAction extends ActionBase<typeof fileSyncInput> {
  @action({
    id: 'file.sync',
    cli: ['file', 'sync'],
    http: ['POST', '/api/file/sync'],
    summary: '把附件同步到本机（默认全部；--ids 只同步指定附件）——为了不再依赖网络读附件',
    input: fileSyncInput,
    render: (d: any) => service.renderSync(d),
  })
  override async run(ctx: ActionInput<this['_input']>) {

      return service.syncFilesAction(ctx);
  
  }
}
