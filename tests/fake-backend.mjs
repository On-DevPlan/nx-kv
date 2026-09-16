// 假后端：内存版 goframe KV 接口，供 smoke 测试用。
//
// 为什么必须有它：nx-kv 的真实后端是生产服务器，上面是用户的真实清单数据。
// 自动化测试**绝不能**对着它跑——写路径会整把覆盖 key，一次误操作就是真实数据丢失。
// （这不是假想：开发过程中确实因为一个 id 定位 bug 误删过 7 条真实记录。）
//
// 它只实现 nx-kv 实际用到的那几个端点，并如实复刻信封语义：
// **HTTP 一律 200，成败看 body 里的 `code`**。
import http from 'node:http';

export function startFakeBackend({ token = 'fake-token-123', userId = 8 } = {}) {
  // 每个 groupId 一份独立存储，复刻真实后端的空间隔离
  const stores = new Map();
  const storeFor = (gid) => {
    if (!stores.has(gid)) stores.set(gid, new Map());
    return stores.get(gid);
  };

  const groups = [
    { id: 24, name: '个人空间', description: '个人默认工作空间', myRole: 'owner', memberCount: 1 },
    { id: 190, name: 'shared', description: '共享', myRole: 'owner', memberCount: 3 },
  ];

  const ok = (res, data) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: 0, message: 'OK', data }));
  };
  const fail = (res, code, message) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code, message }));
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const gid = Number(url.searchParams.get('groupId') || 0) || 0;
    const auth = req.headers.authorization || '';

    // 登录不需要 token
    if (p === '/api/v1/user/login' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.email === 'user@test' && b.password === 'secret') return ok(res, { token, userId });
      return fail(res, 50, '邮箱或密码错误');
    }

    if (auth !== `Bearer ${token}`) return fail(res, 401, '未登录');

    if (p === '/api/v1/user/info' && req.method === 'GET') {
      return ok(res, { userId, email: 'user@test' });
    }

    if (p === '/api/v1/groups' && req.method === 'GET') {
      return ok(res, { groups: gid === 190 ? [groups[1]] : groups });
    }

    if (p === '/api/v1/kv' && req.method === 'GET') {
      const items = [...storeFor(gid)].map(([key, value]) => ({ key, value, tags: [] }));
      return ok(res, { items, total: items.length });
    }

    if (p === '/api/v1/kv' && req.method === 'POST') {
      const b = await readBody(req);
      const target = Number(b.groupId || 0) || 0;
      if (!b.key) return fail(res, 51, 'key 必填');
      storeFor(target).set(b.key, String(b.value ?? ''));
      return ok(res, {});
    }

    const kvMatch = /^\/api\/v1\/kv\/(.+)$/.exec(p);
    if (kvMatch) {
      const key = decodeURIComponent(kvMatch[1]);
      if (req.method === 'GET') {
        const v = storeFor(gid).get(key);
        if (v === undefined) return fail(res, 404, 'key not found');
        return ok(res, { key, value: v, tags: [] });
      }
      if (req.method === 'DELETE') {
        storeFor(gid).delete(key);
        return ok(res, {});
      }
    }

    return fail(res, 404, '接口不存在: ' + p);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        // 直接读写内存，供测试断言服务端状态
        seed: (key, value, group = 0) => storeFor(group).set(key, value),
        get: (key, group = 0) => storeFor(group).get(key),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
