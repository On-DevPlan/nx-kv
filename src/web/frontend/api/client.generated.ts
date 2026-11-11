// AUTO-GENERATED —— 由 scripts/gen-api-client.mjs（runtime/codegen.ts）生成，勿手改。
//
// 类型来自 zod schema（import type，zod 运行时不进浏览器包）；运行时校验在服务端
//（runtime/zod-bridge.ts，CLI 与 HTTP 共用同一份 schema）。传输层是手写的那一半：
// 调 createApiClient 时传入 api/client.ts 的 api() 即可。
// 重新生成：pnpm gen:api。新鲜度由 tests/unit/api-client.test.mjs 对账。


import type {
  BootstrapAction,
  HealthAction,
} from '../../../modules/system/actions/_manifest.generated.js';

/** 传输层契约（手写的那一半）：返回 data（错误信封由 api() 拆好，失败即 throw）。 */
export interface Transport {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

export interface ApiClient {
/** 聚合上下文：版本 / 登录态 / 工作空间 / 命令表 */
  bootstrap(): Promise<Awaited<ReturnType<InstanceType<typeof BootstrapAction>['bootstrap']>>>;
/** 健康检查（本机配置 + 后端可达性） */
  health(): Promise<Awaited<ReturnType<InstanceType<typeof HealthAction>['health']>>>;
}

export function createApiClient(transport: Transport): ApiClient {
  return {
    // action: system.bootstrap
    async bootstrap() {
      const path = `/api/bootstrap`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof BootstrapAction>['bootstrap']>>;
    },
    // action: system.health
    async health() {
      const path = `/api/health`;
      return (await transport.request("GET", path)) as Awaited<ReturnType<InstanceType<typeof HealthAction>['health']>>;
    },
  };
}
