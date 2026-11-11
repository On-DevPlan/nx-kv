// db 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- db.status ----
export const dbStatusInput = z.object({

});

// ---- db.migrate ----
export const dbMigrateInput = z.object({
  'dry-run': z.boolean().optional().describe("演练：事务末尾回滚，库与 JSON 都不改"),
  apply: z.boolean().optional().describe("显式执行（默认就是执行，此标志让脚本自证意图）"),
});

// ---- db.verify ----
export const dbVerifyInput = z.object({

});

// ---- db.backup ----
export const dbBackupInput = z.object({
  dir: z.string().optional().describe("备份目录（缺省 ~/.nx-kv/backups/）"),
  keep: z.number().default(5).describe("保留最近几份（0 = 不清理）"),
});
