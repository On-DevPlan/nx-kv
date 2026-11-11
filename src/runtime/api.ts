// HTTP 路由层：路由表由 action.http 编译而来，与 CLI 同源。
//
// 这里没有手写路由 —— 每条路由都来自某个模块的 action 声明，
// 所以「面板上有按钮、CLI 里没命令」在结构上不可能发生。
// ApiRouter 在构造期把注册表的 actions 编译成排好序的路由表，
// handle() 是 server 的 /api/* 入口——一次编译，常驻复用。
//
// **双通道**：业务 action 走 fields + normalizeCliValue + parseZodInput；
// legacy flags 表契约只服务 runtime 内建命令。路由匹配 / stream 透传 / 错误信封
// 两通道完全一致。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileRoute, applySpec, usageOf, type AnyAction } from './spec.js';
import { normalizeCliValue, parseZodInput } from './zod-bridge.js';
import type { ZodBoundAction } from './action-decorator.js';
import { toErrorPayload, httpStatusOf } from '../core/errors.js';

interface RouteEntry {
  action: AnyAction;
  method: string;
  keys: string[];
  regex: RegExp;
}

// 逐段比较两条模式，决定谁该先匹配：**字面量段优先于参数段**，段数多的优先。
//
// 为什么要排序而不是按声明顺序：`GET /api/repos/status` 与 `GET /api/repos/:id`
// 都能匹配 `/api/repos/status`，谁先声明谁赢。一旦有人调整 actions 顺序，
// 前者就会被后者抢走——这种 bug 只在运行时、且只在特定路径上出现，极难排查。
// 排序后，声明顺序不再影响匹配结果。
function routeSpecificity([, pattern]: readonly [string, string]): string[] {
  return pattern.split('/').filter(Boolean);
}

function compareRoutes(a: RouteEntry, b: RouteEntry): number {
  const pa = routeSpecificity(a.action.http!);
  const pb = routeSpecificity(b.action.http!);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const litA = !pa[i]!.startsWith(':');
    const litB = !pb[i]!.startsWith(':');
    if (litA !== litB) return litA ? -1 : 1; // 字面量在前
  }
  return pb.length - pa.length; // 更长的（更具体）在前
}

export function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

// 请求体上限。定得比较宽是因为**附件上传走 base64 JSON**（面板选图 → data URL →
// 这里），base64 有 ~33% 膨胀，10MB 的图片会变成 ~13MB 的 JSON。
// 仍然有上限：本机单用户工具，但没有上限就等于「一个请求能吃掉全部内存」。
const MAX_BODY_BYTES = 24 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error(`请求体过大（上限 ${MAX_BODY_BYTES / 1024 / 1024}MB）`);
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export class ApiRouter {
  private readonly routes: RouteEntry[];

  constructor(actions: readonly AnyAction[]) {
    this.routes = actions
      .filter((a) => a.http)
      .map((action) => {
        const compiled = compileRoute(action as { http: readonly [string, string] });
        return { action, method: compiled.method, keys: compiled.keys, regex: compiled.regex };
      })
      .sort(compareRoutes);
  }

  /** server 的 /api/* 入口：逐条尝试路由表，命中即执行并回 JSON。 */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = (req.method || 'GET').toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(url.pathname);
      if (!m) continue;

      try {
        const action = route.action;
        // 这里不再按 Origin 拒绝写请求（任务 #57）。
        // 原先那道校验比对 Origin 主机名是不是 127.0.0.1——但浏览器对 POST 一律带
        // Origin（哪怕同源），于是走内网穿透从手机访问时 Origin 是隧道域名，
        // 自己面板的同源写请求被判成跨站 → 403，任务提交不了。
        // 跨域改由标准 CORS 头处理（预检 + allow-origin），见 runtime/cors.ts。

        const raw: Record<string, unknown> = {};
        route.keys.forEach((k, i) => {
          raw[k] = decodeURIComponent(m[i + 1]!);
        });
        if (method === 'GET' || method === 'HEAD') {
          for (const [k, v] of url.searchParams) raw[k] = v;
        } else {
          Object.assign(raw, await readBody(req).catch(() => ({})));
        }

        // 双通道分叉点：zod 走 fields 归一化 + zod 校验；legacy 走 applySpec。
        const input = action.channel === 'zod'
          ? parseZodChannelInput(action as ZodBoundAction, raw)
          : applySpec(action, raw);

        // stream 模式：把 req/res/url 透传给 run，让 action 自己接管响应（SSE 等）
        if (action.stream) {
          await action.run!({ ...input, __raw: { req, res, url } }, { transport: 'http' });
          return;
        }
        const data = await action.run!(input, { transport: 'http' });
        sendJson(res, 200, { ok: true, data });
      } catch (err) {
        // 错误码 → HTTP 状态只在这一处映射（core/errors.ts 提供表）
        const p = toErrorPayload(err);
        const payload: Record<string, unknown> = { ok: false, error: p.message, code: p.code };
        if (p.details !== undefined) payload.details = p.details;
        sendJson(res, httpStatusOf(p.code), payload);
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: '接口不存在: ' + method + ' ' + url.pathname });
  }
}

/** zod 通道的 HTTP 输入解析：路由参数 / query / body 统一过 normalizeCliValue 再校验。 */
function parseZodChannelInput(cmd: ZodBoundAction, raw: Record<string, unknown>): Record<string, unknown> {
  const fields = cmd.fields;
  const usage = usageOf(cmd);
  const out: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(raw)) {
    const f = fields.find((x) => x.name === k);
    if (f) out[k] = normalizeCliValue(f, v);
  }
  return parseZodInput(cmd.input, out, usage) as Record<string, unknown>;
}
