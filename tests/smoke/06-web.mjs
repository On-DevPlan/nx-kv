// 冒烟分组 6：Web API 与静态页（含面板附件链路、CORS 预检与收紧模式）。
// server 实例挂到 ctx 上，由入口在所有分组跑完后统一关闭。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './harness.mjs';

export async function run(ctx) {
  const { check, pngBytes, upFileId } = ctx;

  // ─── 12. Web API 与静态页 ────────────────────────────────────
  const { startServer } = await import(pathToFileURL(join(REPO_ROOT, 'src', 'runtime', 'server.js')).href);
  const server = await startServer({ port: 0 });
  const base = 'http://127.0.0.1:' + server.address().port;
  ctx.server = server;
  ctx.base = base;

  const boot = await (await fetch(base + '/api/bootstrap')).json();
  check('api bootstrap', boot.ok && Array.isArray(boot.data.commands) && !!boot.data.version);
  check(
    'bootstrap 命令表含 http 字段',
    boot.data.commands.some((c) => c.http && c.http.path === '/api/localtasks')
  );

  const html = await (await fetch(base + '/')).text();
  check('web 首页', html.includes('nx-kv') && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html));

  // 图标走 vite publicDir（src/web/frontend/public/）拷进产物；
  // ico 兜底若 404，浏览器页签就是一片空白——这里钉住它。
  check('web 图标可达', (await fetch(base + '/favicon.ico')).status === 200);

  const localRes = await (await fetch(base + '/api/localtasks')).json();
  check('api localtasks 列表', localRes.ok && Array.isArray(localRes.data.topics));

  // ---- 附件（面板链路：base64 上传 → 本机附件仓；<img> 走 content 代理）----
  const upHttp = await (
    await fetch(base + '/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'panel.png', content: pngBytes.toString('base64'), contentType: 'image/png' }),
    })
  ).json();
  check(
    'api file 上传（面板 base64 路径，落本机仓）',
    upHttp.ok && /^[0-9a-f]{32}$/.test(upHttp.data.fileId || '') &&
      upHttp.data.storage === 'local' && existsSync(upHttp.data.localPath),
    JSON.stringify(upHttp).slice(0, 240)
  );

  const imgRes = await fetch(base + '/api/file/content/' + upFileId);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  check('api file content 直出字节（面板图片预览走这条）', imgRes.status === 200 && imgBuf.length === pngBytes.length, `${imgRes.status}/${imgBuf.length}`);

  const apiSetting = await (await fetch(base + '/api/setting')).json();
  check(
    'api setting 可读（只剩本机路径设置）',
    apiSetting.ok && typeof apiSetting.data.gitRepoRoot === 'string' && apiSetting.data.autoSyncAttachments === undefined,
    JSON.stringify(apiSetting).slice(0, 240)
  );

  const notFound = await (await fetch(base + '/api/nothing')).json();
  check('api 404', !notFound.ok);

  // Origin 校验已放行：带异站 Origin 的写请求应正常落库（主防线仍是绑 127.0.0.1）
  const crossOrigin = await (
    await fetch(base + '/api/localtasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ text: '冒烟：异站 Origin 写入' }),
    })
  ).json();
  check('异站 Origin 写请求放行', crossOrigin.ok === true, JSON.stringify(crossOrigin).slice(0, 200));
  // 跨域（CORS）：光「不拦」不够——浏览器要先过预检才发真正的跨源请求，
  // 预检与实际响应都得带 allow-origin，否则跨源提交依然发不出去。
  const preflight = await fetch(base + '/api/localtasks', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://panel.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  check(
    '跨域预检 204 且带 allow-origin',
    preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === '*',
    `${preflight.status}/${preflight.headers.get('access-control-allow-origin')}`
  );
  check(
    '预检回显允许的方法与请求头',
    /POST/.test(preflight.headers.get('access-control-allow-methods') || '') &&
      /content-type/.test(preflight.headers.get('access-control-allow-headers') || ''),
  );
  const corsGet = await fetch(base + '/api/ping', { headers: { origin: 'https://panel.example' } });
  check('实际响应也带 CORS 头', corsGet.headers.get('access-control-allow-origin') === '*');

  // 收紧模式（serve --allow-origin）：只放行白名单来源，
  // 其余来源不给 allow-origin——由浏览器拦下，服务端不再回 403。
  const strictServer = await startServer({ port: 0, allowOrigin: 'https://ok.example' });
  const strictBase = 'http://127.0.0.1:' + strictServer.address().port;
  const okPre = await fetch(strictBase + '/api/localtasks', {
    method: 'OPTIONS',
    headers: { origin: 'https://ok.example', 'access-control-request-method': 'POST' },
  });
  check(
    '白名单来源预检放行（回显该来源）',
    okPre.status === 204 && okPre.headers.get('access-control-allow-origin') === 'https://ok.example',
    `${okPre.status}/${okPre.headers.get('access-control-allow-origin')}`
  );
  const evilPre = await fetch(strictBase + '/api/localtasks', {
    method: 'OPTIONS',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  });
  check(
    '非白名单来源不给 allow-origin（浏览器自己拦）',
    evilPre.headers.get('access-control-allow-origin') === null
  );
  await new Promise((r) => strictServer.close(r));

  // /api/ping：纯本机心跳，serve --auto-exit 据此判面板是否还开着
  const pingRes = await (await fetch(base + '/api/ping')).json();
  check('api ping 可达且不触网', pingRes.ok === true && pingRes.data && pingRes.data.pong === true);

  // /api/localtasks/cancel：HTTP 路径上对未知主题也是无操作（reason:not_waiting）
  const cancelHttp = await (
    await fetch(base + '/api/localtasks/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'no-such-topic' }),
    })
  ).json();
  check(
    'api localtasks/cancel 可达且对未知主题无操作',
    cancelHttp.ok === true && cancelHttp.data && cancelHttp.data.cancelled === false && cancelHttp.data.reason === 'not_waiting',
    JSON.stringify(cancelHttp)
  );
}
