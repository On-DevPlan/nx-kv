// bundled 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- bundled.list ----
export const bundledListInput = z.object({

});

// ---- bundled.groups ----
export const bundledGroupsInput = z.object({

});

// ---- bundled.install ----
export const bundledInstallInput = z.object({
  name: z.string().optional(),
  group: z.string().optional().describe("groups.json 里的组名（与 <name> 互斥）"),
  to: z.string().optional(),
  force: z.boolean().optional(),
  all: z.boolean().optional().describe("装 assets/ 下的全部内置 skill（隐式覆盖，不需要 --force）"),
});

// ---- bundled.get ----
export const bundledGetInput = z.object({
  name: z.string().optional(),
  ref: z.string().optional(),
  group: z.string().optional().describe("groups.json 里的组名（与 <name> 互斥）"),
  to: z.string().optional(),
});
