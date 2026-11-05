// 跨域策略的纯逻辑（任务 #57）：放行名单解析、来源判定、预检识别、CORS 头生成。
// 端到端行为在 tests/smoke.mjs（真起服务打 OPTIONS 预检）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  corsHeaders,
  isPreflight,
  originAllowed,
  parseAllowOrigin,
  preflightHeaders,
} from '../../src/runtime/cors.js';

test('parseAllowOrigin：缺省 / * / 空串 = 放行全部', () => {
  for (const spec of [undefined, null, '', '   ', '*']) {
    assert.deepEqual(parseAllowOrigin(spec), { all: true, list: [] });
  }
});

test('parseAllowOrigin：逗号分隔的名单，去空白、去尾斜杠', () => {
  assert.deepEqual(parseAllowOrigin('https://a.example, https://b.example/'), {
    all: false,
    list: ['https://a.example', 'https://b.example'],
  });
});

test('originAllowed：名单内放行、名单外拒绝', () => {
  const allow = parseAllowOrigin('https://ok.example');
  assert.equal(originAllowed('https://ok.example', allow), true);
  assert.equal(originAllowed('https://ok.example/', allow), true);
  assert.equal(originAllowed('https://evil.example', allow), false);
  assert.equal(originAllowed('', allow), false);
});

test('originAllowed：放行全部时任何来源都过', () => {
  assert.equal(originAllowed('https://evil.example', parseAllowOrigin(undefined)), true);
});

test('originAllowed：支持 https://*.example.com 这种前缀通配', () => {
  const allow = parseAllowOrigin('https://*.example.com');
  assert.equal(originAllowed('https://a.example.com', allow), true);
  assert.equal(originAllowed('https://example.com.evil.net', allow), false);
});

test('isPreflight：OPTIONS + Access-Control-Request-Method 才算预检', () => {
  assert.equal(isPreflight({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } }), true);
  assert.equal(isPreflight({ method: 'OPTIONS', headers: {} }), false);
  assert.equal(isPreflight({ method: 'POST', headers: { 'access-control-request-method': 'POST' } }), false);
});

test('corsHeaders：无 Origin 的客户端（curl / 原生 App）不加头', () => {
  const h = corsHeaders({ headers: {} }, parseAllowOrigin(undefined));
  assert.equal(h['access-control-allow-origin'], undefined);
  assert.equal(h.vary, 'Origin');
});

test('corsHeaders：放行全部时回 *，名单模式回显具体来源', () => {
  const any = corsHeaders({ headers: { origin: 'https://evil.example' } }, parseAllowOrigin(undefined));
  assert.equal(any['access-control-allow-origin'], '*');
  const strict = corsHeaders(
    { headers: { origin: 'https://ok.example' } },
    parseAllowOrigin('https://ok.example'),
  );
  assert.equal(strict['access-control-allow-origin'], 'https://ok.example');
});

test('corsHeaders：名单外来源不给 allow-origin（浏览器自己拦）', () => {
  const h = corsHeaders(
    { headers: { origin: 'https://evil.example' } },
    parseAllowOrigin('https://ok.example'),
  );
  assert.equal(h['access-control-allow-origin'], undefined);
});

test('preflightHeaders：回显浏览器请求的方法与请求头', () => {
  const h = preflightHeaders(
    {
      headers: {
        origin: 'https://panel.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-custom',
      },
    },
    parseAllowOrigin(undefined),
  );
  assert.equal(h['access-control-allow-origin'], '*');
  assert.match(h['access-control-allow-methods'], /POST/);
  assert.equal(h['access-control-allow-headers'], 'content-type,x-custom');
  assert.ok(h['access-control-max-age']);
});
