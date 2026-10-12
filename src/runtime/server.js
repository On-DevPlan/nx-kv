// Web 服务器：node:http 零依赖。
// 职责只有两件事：发静态面板文件 + 把 /api/* 交给路由层（见 api.js）。
import http from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fsp from 'node:fs/promises';
import { handleApi, sendJson } from './api.js';
import { DEFAULT_PORT } from '../core/paths.js';

// vite 的 outDir：src/web/public（构建产物，gitignore）
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../web/public/', import.meta.url)));

const MIME = {
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

async function serveStatic(pathname, res) {
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
// 不触网、不读盘、不查登录态——只为测「端口上还活着」。这与 /api/health 不同：
// /api/health 走的是更重的鉴权/状态检查，不适合每 15s 一次的高频探活。
async function handlePing(_req, res) {
  sendJson(res, 200, { ok: true, data: { pong: true, ts: Date.now() } });
}

export function startServer({ port = DEFAULT_PORT, host = '127.0.0.1', onRequest } = {}) {
  const server = http.createServer(async (req, res) => {
    // 活动观测：每个请求（包括 /api/ping 与静态文件）都回调一次；
    // 回调只上报，不参与响应；异常必须吞掉以免影响主流程。
    if (typeof onRequest === 'function') {
      try { onRequest(req); } catch { /* ignore */ }
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/ping') {
        await handlePing(req, res);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(url.pathname, res);
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: String((err && err.message) || err),
        code: 'INTERNAL',
      });
    }
  });
  return new Promise((resolve_, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve_(server));
  });
}
