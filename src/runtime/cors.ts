// 跨域（CORS）策略：面板对外来请求的态度。
//
// 为什么不按 Origin 拒绝写请求（任务 #57）：
// 浏览器对 POST/PUT/DELETE **一律带 Origin 头，哪怕请求与页面同源**。
// 面板原先那道校验是「Origin 的主机名必须是 127.0.0.1/localhost」——
// 走内网穿透（frp / cloudflared / ngrok）从手机或外网访问时，Origin 变成隧道
// 域名（如 https://abc.trycloudflare.com），明明是**自己面板的同源请求**，
// 却因为主机名不是本机被判成跨站 → 403，用户从外网提交任务直接失败。
// 换句话说：这道校验想拦「浏览器里的陌生网页」，却把「自己的面板从外网访问」
// 一起拦了——误伤远大于收益。
//
// 现在的分工：
//   - 同源请求（含隧道同源）：不需要 CORS 头，直接放行；
//   - 跨源请求：浏览器先发 OPTIONS 预检，服务端回 CORS 头才放行；
//   - 非浏览器客户端（curl / 原生 App / agent）：本来就不带 Origin，不受影响。
//
// 安全边界（要紧）：面板只绑 127.0.0.1，是本机工具。**一旦经内网穿透暴露到公网，
// 真正的边界是隧道自身的访问控制**（访问密码 / basic auth / IP 白名单）——
// 任何非浏览器客户端都能直接调 API，从头到尾不经过 Origin 校验。
// 想收紧来源：`nx-kv serve --allow-origin <origin>`（逗号分隔多个，支持 * 通配）。

const DEFAULT_ALLOWED_METHODS = 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS';
const DEFAULT_ALLOWED_HEADERS = 'content-type,authorization,x-requested-with';
const PREFLIGHT_MAX_AGE = '600';

/** 请求头里我们关心的形状（Node 的 IncomingHttp.headers 是 (string|string[]|undefined)）。 */
export type ReqHeaders = Record<string, string | string[] | undefined>;

/** 极简请求形状：cors 只看 method 与 headers。 */
export interface CorsRequest {
  method?: string;
  headers?: ReqHeaders;
}

/** 放行策略：all = 放行全部；否则精确/通配名单。 */
export interface AllowOrigin {
  all: boolean;
  list: string[];
}

function header(req: CorsRequest | undefined, name: string): string {
  const v = req?.headers?.[name];
  return Array.isArray(v) ? (v[0] ?? '') : String(v ?? '');
}

/**
 * 解析 --allow-origin 规格。
 * @param spec 逗号分隔的来源列表；'*' 或缺省 = 放行全部
 */
export function parseAllowOrigin(spec: string | undefined | null): AllowOrigin {
  if (spec === undefined || spec === null) return { all: true, list: [] };
  const raw = String(spec).trim();
  if (!raw || raw === '*') return { all: true, list: [] };
  const list = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (!list.length) return { all: true, list: [] };
  if (list.includes('*')) return { all: true, list: [] };
  return { all: false, list };
}

/**
 * 名单项匹配：支持通配（https://*.example.com）。只有通配是「宽松」的语义，
 * 其余字符按字面量比对。
 */
function patternMatches(pattern: string, origin: string): boolean {
  if (!pattern.includes('*')) return pattern === origin;
  const parts = pattern.split('*');
  let rest = origin;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part) continue;
    const idx = rest.indexOf(part);
    if (idx === -1) return false;
    if (i === 0 && idx !== 0) return false; // 首段必须贴在开头
    rest = rest.slice(idx + part.length);
  }
  const tail = parts[parts.length - 1]!;
  return !tail || origin.endsWith(tail);
}

/**
 * 来源是否在放行名单里。
 * @param origin 请求的 Origin 头
 * @param allow 放行策略
 */
export function originAllowed(origin: string, allow: AllowOrigin): boolean {
  if (!origin) return false;
  if (!allow || allow.all) return true;
  const o = String(origin).replace(/\/+$/, '');
  return allow.list.some((p) => patternMatches(p, o));
}

/**
 * 是否是 CORS 预检请求（OPTIONS + Access-Control-Request-Method）。
 */
export function isPreflight(req: CorsRequest | undefined): boolean {
  return (
    String((req && req.method) || '').toUpperCase() === 'OPTIONS' &&
    !!header(req, 'access-control-request-method')
  );
}

/**
 * 给响应补 CORS 头。
 * 非浏览器客户端（无 Origin）不加头；来源不在名单里也**故意不加** allow-origin
 * ——让浏览器自己拦下这次跨源请求（而不是服务端回 403，那会把「跨源不支持」
 * 和「请求出错」混成一种状态码）。
 */
export function corsHeaders(req: CorsRequest | undefined, allow: AllowOrigin): Record<string, string> {
  const origin = header(req, 'origin');
  if (!origin) return { vary: 'Origin' };
  if (!originAllowed(origin, allow)) return { vary: 'Origin' };
  return {
    'access-control-allow-origin': allow.all ? '*' : origin,
    vary: 'Origin',
  };
}

/**
 * 预检响应头：回显浏览器这次请求的方法与请求头（只回该次预检涉及的）。
 */
export function preflightHeaders(req: CorsRequest | undefined, allow: AllowOrigin): Record<string, string> {
  const requested = header(req, 'access-control-request-headers');
  return {
    ...corsHeaders(req, allow),
    'access-control-allow-methods': DEFAULT_ALLOWED_METHODS,
    'access-control-allow-headers': requested ? String(requested) : DEFAULT_ALLOWED_HEADERS,
    'access-control-max-age': PREFLIGHT_MAX_AGE,
  };
}
