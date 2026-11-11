// setting 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- setting.get ----
export const settingGetInput = z.object({

});

// ---- setting.set ----
export const settingSetInput = z.object({
  autoSyncAttachments: z.boolean().optional().describe("读任务时自动把附件下载到本地"),
  attachmentsDir: z.string().optional().describe("附件本地目录（空 = ~/.nx-kv/attachments/<工作空间>/）"),
  gitRepoRoot: z.string().optional().describe("参考仓库存储根目录（非 C 盘；空 = clone 参考仓库被拒绝）"),
  gitDevRoot: z.string().optional().describe("导入布局时开发仓库的默认克隆根（空 = 只登记不克隆）"),
});
