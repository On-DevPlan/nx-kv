// API 客户端：全部面板操作走 /api，与 CLI 共享同一份 action 声明。
//
// 响应包约定 { ok: true, data } / { ok: false, error, code }。
// 失败时抛 Error 并带上 .code —— 调用方可据此区分「业务冲突」与「参数错误」，
// 而不是像改造前那样只能对错误文案做字符串匹配。
const DEFAULT_TIMEOUT_MS = 30000;

/** 请求选项（与 fetch 的 init 同形，只收我们真正用到的三项）。 */
export interface ApiOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

/** 带业务码的错误（服务端 { ok:false, code } 原样带出，调用方按 code 分支）。 */
export type ApiError = Error & { code?: string; details?: unknown };

/**
 * 发一个 /api 请求并返回 data。
 *
 * 返回类型默认 `any`：data 的形状由后端 action 的 zod 契约决定，前端逐处标注
 * 反而会与生成物（api/client.generated.ts）形成第二份真相。调用方需要类型时
 * 显式传泛型（`api<LocalTopic[]>(...)`）。
 */
export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    // 信封是外部数据：字段按后端约定读，这里不逐字段建模
    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new Error(`HTTP ${res.status}`);
    }
    if (!json.ok) {
      const err = new Error(json.error || '请求失败') as ApiError;
      err.code = json.code;
      err.details = json.details;
      throw err;
    }
    return json.data as T;
  } catch (e) {
    // AbortError 的原生文案是「The operation was aborted」，对用户没有意义
    if (e && (e as Error).name === 'AbortError') throw new Error('请求超时（本地服务无响应）');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
