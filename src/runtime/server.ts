// Web 服务器：node:http 零依赖。
// 职责只有两件事：发静态面板文件 + 把 /api/* 交给路由层（见 api.ts）。
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { ApiRouter, sendJson } from './api.js';
import { corsHeaders, isPreflight, parseAllowOrigin, preflightHeaders, type AllowOrigin, type CorsRequest } from './cors.js';
import { DEFAULT_PORT } from '../core/paths.js';
import { registry } from './registry.js';

// 静态目录：src/web/public（vite 构建产物，gitignore）。
// 相对路径对源码态（src/runtime/server.ts）与构建态（dist/runtime/server.js）都成立。
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../web/public/', import.meta.url)));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = resolve(PUBLIC_DIR, rel);

  // 越界校验：解析成绝对路径后必须仍落在 PUBLIC_DIR 内。
  // 比对解析结果，而不是剥离 '..' 字面量——后者挡不住编码变形。
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const buf = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

// /api/ping：纯本机快返回，供面板心跳与「面板还开着吗」观测。
// 不触网、不读盘、不查登录态——只为测「端口上还活着」。它与 /api/health 不同：
// /api/health 走的是更重的鉴权/状态检查，不适合每 15s 一次的高频探活。
async function handlePing(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { ok: true, data: { pong: true, ts: Date.now() } });
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  /** 活动观测：每个请求（静态与 /api）回调一次，供空闲自释放判活；异常必须吞掉。 */
  onRequest?: (req: IncomingMessage) => void;
  /** 跨域来源白名单（逗号分隔；缺省放行全部，见 cors.ts）。 */
  allowOrigin?: string;
}

/** 面板服务器：发静态文件 + 把 /api/* 交给 ApiRouter。 */
export class PanelServer {
  private readonly api: ApiRouter;

  constructor(api: ApiRouter) {
    this.api = api;
  }

  /** 起服务并返回底层 http.Server（调用方要读 address() 与 close()）。 */
  start({ port = DEFAULT_PORT, host = '127.0.0.1', onRequest, allowOrigin }: StartServerOptions = {}): Promise<http.Server> {
    // 跨域放行策略：缺省放行全部（面板要能被内网穿透 / 移动端访问，见 cors.ts）。
    const cors = parseAllowOrigin(allowOrigin);
    const server = http.createServer((req, res) => {
      void this.dispatch(req, res, cors, onRequest);
    });
    return new Promise((resolveServer, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolveServer(server));
    });
  }

  private async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    cors: AllowOrigin,
    onRequest?: (req: IncomingMessage) => void,
  ): Promise<void> {
    // 活动观测：每个请求（包括 /api/ping 与静态文件）都回调一次；
    // 回调只上报，不参与响应；异常必须吞掉以免影响主流程。
    if (typeof onRequest === 'function') {
      try {
        onRequest(req);
      } catch {
        /* ignore */
      }
    }
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      // CORS 头统一在这里补：静态页与 /api 都要带（跨源嵌入面板时静态资源也得能取）。
      // setHeader 的值会与后面 writeHead 的对象合并（同名以 writeHead 为准）。
      for (const [k, v] of Object.entries(corsHeaders(req as CorsRequest, cors))) res.setHeader(k, v);
      // 预检（OPTIONS + Access-Control-Request-Method）：不匹配路由，直接回 CORS 头。
      // 浏览器要求预检通过才发真正的跨源请求——同源（含隧道同源）根本不预检。
      if (url.pathname.startsWith('/api/') && isPreflight(req as CorsRequest)) {
        res.writeHead(204, preflightHeaders(req as CorsRequest, cors));
        res.end();
        return;
      }
      if (url.pathname === '/api/ping') {
        await handlePing(req, res);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await this.api.handle(req, res, url);
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: String((err as { message?: string } | null)?.message || err),
        code: 'INTERNAL',
      });
    }
  }
}

// 兼容入口：cmdServe（CliApp）与编程调用方都用它。
// 每次调用都用当前注册表新建 ApiRouter——路由表是构造期产物，注册表变了要重编译。
export function startServer(options: StartServerOptions = {}): Promise<http.Server> {
  return new PanelServer(new ApiRouter(registry.actions)).start(options);
}
