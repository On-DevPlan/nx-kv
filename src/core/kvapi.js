// 后端 KV 客户端 —— 对接 47 服务器的 goframe 接口。
//
// 信封约定：**HTTP 状态恒为 200，成败看 body 里的 `code`**（0 = 成功）。
// 这一点与常见的 REST 直觉相反，所以统一收在本文件里判断；
// 上层 service 只看到「成功返回 data / 失败抛异常」，不必各自解析信封。
//
// 端点（来自 Flutter 端 api/goframe/kv/kv_endpoint.dart 与 user/user_auth_service.dart）：
//   POST   /api/v1/user/login   { email, password }        → { token, userId }
//   GET    /api/v1/kv/{key}[?groupId=N]                    → { key, value, expires_at, tags }
//   POST   /api/v1/kv           { key, value, ttl, groupId }
//   DELETE /api/v1/kv/{key}[?groupId=N]
//   GET    /api/v1/kv?limit=&offset=[&groupId=N]           → { items, total }
//   GET    /api/v1/groups                                  → { groups: [...] }
import { badInput, external, notFound } from './errors.js';
import { loadConfig, normalizeGroupId } from './config.js';

const TIMEOUT_MS = 20000;

async function call({ method, path, body, token, baseUrl, allowMissing = false }) {
  const cfg = baseUrl ? { baseUrl, token } : await loadConfig();
  const url = cfg.baseUrl.replace(/\/$/, '') + path;

  const headers = {};
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw external(`请求超时（${TIMEOUT_MS}ms）: ${method} ${path}`);
    throw external(`无法连接后端 ${cfg.baseUrl}: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  let envelope;
  try {
    envelope = JSON.parse(await res.text());
  } catch {
    throw external(`后端返回了非 JSON（HTTP ${res.status}）: ${method} ${path}`);
  }

  const code = envelope.code ?? res.status;
  if (code !== 0) {
    // 401 单独识别成「未登录」——这是 agent 最需要一眼看懂的失败
    if (code === 401) throw badInput('未登录或登录已过期（执行 nx-kv auth login <email>）');
    // 业务上"这个 key 不存在"不是错误，由调用方决定怎么处理
    if (allowMissing && (code === 404 || /not\s*found|不存在/i.test(envelope.message || ''))) {
      return null;
    }
    throw external(`后端 code=${code}: ${envelope.message || '(无消息)'}`, { code, path });
  }
  return envelope.data ?? null;
}

const gid = (groupId) => {
  const n = normalizeGroupId(groupId);
  return n === undefined ? '' : `?groupId=${n}`;
};

// ---- 认证 ----

export async function login(email, password, { baseUrl } = {}) {
  if (!email || !password) throw badInput('邮箱与密码不能为空');
  const data = await call({
    method: 'POST',
    path: '/api/v1/user/login',
    body: { email, password },
    baseUrl,
    token: '', // 登录本身不需要 token（显式传空，避免用旧 token）
  });
  if (!data || !data.token) throw external('登录成功但未返回 token');
  return { token: data.token, userId: Number(data.userId ?? data.user?.id ?? 0) };
}

export async function userInfo() {
  return call({ method: 'GET', path: '/api/v1/user/info' });
}

// ---- 工作空间 ----

function normalizeGroup(g) {
  return {
    id: Number(g.id) || 0,
    name: g.name ?? '',
    description: g.description ?? '',
    myRole: g.myRole ?? '',
    memberCount: Number(g.memberCount) || 0,
    ownerId: Number(g.ownerId) || 0,
    createdAt: g.createdAt ?? '',
  };
}

export async function listGroups() {
  const data = await call({ method: 'GET', path: '/api/v1/groups' });
  return (data?.groups ?? []).map(normalizeGroup);
}

// 建组。返回后端给的完整对象——建完立刻能拿到 id，不必再列一次。
export async function createGroup({ name, description } = {}) {
  const n = String(name || '').trim();
  if (!n) throw badInput('工作空间名称不能为空');
  const data = await call({
    method: 'POST',
    path: '/api/v1/groups',
    body: { name: n, description: String(description ?? '') },
  });
  return normalizeGroup(data?.group ?? {});
}

// 改名 / 改描述。只发传入的字段（PATCH 语义）。
export async function updateGroup(id, { name, description } = {}) {
  const body = {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) throw badInput('工作空间名称不能为空');
    body.name = n;
  }
  if (description !== undefined) body.description = String(description);
  if (!Object.keys(body).length) throw badInput('至少要给出 --name 或 --description');
  const data = await call({ method: 'PATCH', path: `/api/v1/groups/${Number(id)}`, body });
  return normalizeGroup(data?.group ?? {});
}

// 解散工作空间。后端有前置条件：组内不能还有 KV，
// 报错文案会把原因带回来（例如「组内存在 KV，请先删除或转移后再解散组」），
// 这里原样透出——调用方需要知道到底卡在哪一步。
export async function deleteGroup(id) {
  await call({ method: 'DELETE', path: `/api/v1/groups/${Number(id)}` });
  return { id: Number(id), deleted: true };
}

export async function listGroupMembers(id) {
  const data = await call({ method: 'GET', path: `/api/v1/groups/${Number(id)}/members` });
  return (data?.members ?? []).map((m) => ({
    userId: Number(m.userId) || 0,
    email: m.email ?? '',
    nickname: m.nickname ?? '',
    role: m.role ?? m.myRole ?? '',
  }));
}

// ---- KV 读写 ----
//
// 注意：后端**没有「单条更新」接口**。任何写都是「读整把 key → 改数组 → 整把覆盖」，
// 所以上层必须先读后写，且两把 key 要一起写（见 modules/todo/service.js 的契约注释）。

// 读一个 key。key 不存在时返回 null（不是错误）。
export async function kvGet(key, groupId) {
  const data = await call({
    method: 'GET',
    path: '/api/v1/kv/' + encodeURIComponent(key) + gid(groupId),
    allowMissing: true,
  });
  if (!data) return null;
  return {
    key: data.key ?? key,
    value: data.value ?? '',
    expiresAt: data.expires_at ?? data.expiresAt ?? null,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
  };
}

export async function kvSet({ key, value, ttl = 0, groupId }) {
  const n = normalizeGroupId(groupId);
  const body = { key, value, ttl };
  if (n !== undefined) body.groupId = n;
  await call({ method: 'POST', path: '/api/v1/kv', body });
  return { key, bytes: Buffer.byteLength(String(value), 'utf8') };
}

export async function kvDelete(key, groupId) {
  await call({ method: 'DELETE', path: '/api/v1/kv/' + encodeURIComponent(key) + gid(groupId) });
  return { key, deleted: true };
}

export async function kvList({ limit = 50, offset = 0, groupId } = {}) {
  const n = normalizeGroupId(groupId);
  const q = `?limit=${limit}&offset=${offset}` + (n === undefined ? '' : `&groupId=${n}`);
  const data = await call({ method: 'GET', path: '/api/v1/kv' + q });
  return {
    total: Number(data?.total) || 0,
    items: (data?.items ?? []).map((it) => ({
      key: it.key ?? '',
      value: it.value ?? '',
      expiresAt: it.expires_at ?? it.expiresAt ?? null,
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
    })),
  };
}

// 供 service 层判断「key 不存在」时抛的错（保持错误码语义）
export { notFound };
