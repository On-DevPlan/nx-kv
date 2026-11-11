// auth 模块的 zod 契约：每个 action 一份入参 schema。
//
// 由 .tool/migrate-module.mjs 从 legacy flags 表机械迁来；命名约定 <camelCase(actionId)>Input
// （codegen 靠它自动拼 import 名）。
import { z } from 'zod';

// ---- auth.login ----
export const authLoginInput = z.object({
  email: z.string(),
  password: z.string().optional().describe("密码（省略则交互式隐藏输入）"),
  baseUrl: z.string().optional().describe("后端地址，覆盖默认"),
});

// ---- auth.logout ----
export const authLogoutInput = z.object({

});

// ---- auth.status ----
export const authStatusInput = z.object({

});

// ---- auth.me ----
export const authMeInput = z.object({

});
