// system 模块的 zod 契约：每个 action 一对入参 schema。
//
// 这份文件是「半自动化」的关键证据：它同时被三处消费——
//   1. 服务端：@action 装饰器引用它做入参校验（CLI 与 HTTP 共用同一份）
//   2. codegen：生成前端 apiclient 的入参类型（import type，零运行时进浏览器包）
//   3. 未来：前端表单校验可按需 import 同一份 schema（zod 本身浏览器安全）
//
// 命名约定（codegen 靠它自动拼 import 名）：<camelCase(actionId)>Input，
// 如 system.bootstrap → systemBootstrapInput。约定破了 codegen 会生成指向
// 不存在符号的代码，tests/unit/api-client.test.mjs 的新鲜度对账会当场红。
//
// 已知边界（模板 spike 结论，别踩）：
//   - z.coerce 不能用（'false'→true、''→0）——归一化在 runtime/zod-bridge.ts 做；
//   - handler 入参类型由基类泛型模板给出（ActionBase<typeof xxxInput> +
//     ActionInput<this['_input']>，解析后形状）；前端 client 入参是 z.input。
import { z } from 'zod';

// ---- system.bootstrap ----
export const systemBootstrapInput = z.object({});

// ---- system.health ----
export const systemHealthInput = z.object({});

// ---- system.routes ----
export const systemRoutesInput = z.object({
  // 模块 id 过滤（正查）
  module: z.string().optional(),
  // `METHOD /api/path`（反查，:param 视为通配）
  http: z.string().optional(),
});
