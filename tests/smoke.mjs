// 冒烟测试：CLI 全链路 + HTTP API + 静态页。
//
// **对着假后端跑**（tests/fake-backend.mjs），不碰生产服务器上的真实清单。
// 使用临时配置（NX_KV_CONFIG），不污染 ~/.nx-kv。
// 运行：pnpm test（或 node tests/smoke.mjs）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFakeBackend } from './fake-backend.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BIN = join(ROOT, '..', 'bin', 'cli.mjs');

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-smoke-'));
const cfgPath = join(tmp, 'config.json');
// 进程内的 server.js 也要读这份配置 —— 只给子进程设 env 是不够的
process.env.NX_KV_CONFIG = cfgPath;

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  -- ' + extra : ''));
}

let backend;

// ⚠️ 必须用**异步** execFile，不能用 spawnSync。
// 假后端就跑在本进程里；spawnSync 会阻塞本进程的事件循环，
// 子进程发的请求因此得不到响应，全部超时。
const execFileAsync = promisify(execFile);
async function cli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      env: { ...process.env, NX_KV_CONFIG: cfgPath },
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
async function cliJson(args) {
  const r = await cli([...args, '--json']);
  if (r.status !== 0) return { __error: (r.stdout + r.stderr).trim() };
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { __error: '非 JSON: ' + r.stdout.slice(0, 120) };
  }
}

const T = (id, topic, text, extra = {}) => ({
  id,
  topic,
  text,
  createdAt: '2026-08-01T00:00:00.000000',
  doneAt: '',
  note: '',
  frozenAt: '',
  ...extra,
});

try {
  backend = await startFakeBackend();

  // ─── 1. 基础命令 ─────────────────────────────────────────────
  const pkg = JSON.parse(
    (await import('node:fs')).readFileSync(join(ROOT, '..', 'package.json'), 'utf8')
  );
  check('cli version', (await cli(['version'])).stdout.trim() === pkg.version);
  check('cli help 含 todo add', (await cli(['help'])).stdout.includes('todo add'));
  check('cli 未知命令 -> exit 1', (await cli(['nope'])).status === 1);
  check('help todo 可用', (await cli(['help', 'todo'])).status === 0);

  // ─── 2. 未登录时的行为 ───────────────────────────────────────
  check('未登录时 todo list 失败', (await cli(['todo', 'list'])).status === 1);
  check(
    '未登录报错含「未登录」锚点',
    ((await cli(['todo', 'list'])).stdout + (await cli(['todo', 'list'])).stderr).includes('未登录')
  );

  // ─── 3. 登录 ─────────────────────────────────────────────────
  // baseUrl 必须显式指向假后端：默认值是生产服务器，测试绝不能打到那里
  check(
    '登录失败时退出码非 0',
    (await cli(['auth', 'login', 'user@test', '--password', 'wrong', '--baseUrl', backend.url])).status === 1
  );
  check(
    '登录成功',
    (await cli(['auth', 'login', 'user@test', '--password', 'secret', '--baseUrl', backend.url])).status === 0
  );

  const cfg = JSON.parse((await import('node:fs')).readFileSync(cfgPath, 'utf8'));
  check('baseUrl 已指向假后端', cfg.baseUrl === backend.url, cfg.baseUrl);
  check('token 已写入本机配置', !!cfg.token);
  check('密码未写入本机配置', !JSON.stringify(cfg).includes('secret'), JSON.stringify(cfg));

  const status = await cliJson(['auth', 'status']);
  check('auth status 已登录', status.loggedIn === true && status.email === 'user@test');

  // ─── 4. 工作空间 ─────────────────────────────────────────────
  const gs = await cliJson(['group', 'list']);
  check('group list 返回两个空间', Array.isArray(gs.groups) && gs.groups.length === 2, JSON.stringify(gs));
  check('group current 默认组', (await cliJson(['group', 'current'])).id === 0);
  check('group use shared 成功', (await cli(['group', 'use', 'shared'])).status === 0);
  check('group current 已切换到 190', (await cliJson(['group', 'current'])).id === 190);
  check('group use 不存在的名字报错', (await cli(['group', 'use', 'nope'])).status === 1);
  await cli(['group', 'use', 'default']);
  check('group use default 回默认组', (await cliJson(['group', 'current'])).id === 0);

  // ─── 5. 四把 key 与 id 分配 ──────────────────────────────────
  backend.seed('todo:freeze', JSON.stringify([T(2, 'py'), T(10, 'go'), T(28, 'fr', '', { frozenAt: 'x' })]));
  backend.seed('todo:done', JSON.stringify([T(1, 'go')]));
  backend.seed('todo:topics', JSON.stringify([]));

  const add1 = await cliJson(['todo', 'add', '--topic', 'go', '第一条']);
  check('待办为空但冻结有 id 时，新 id 从冻结最大值续（不是 1）', add1.id === 29, JSON.stringify(add1));
  check('新主题自动进快捷列表', add1.topicAdded === true, JSON.stringify(add1));
  check('快捷列表已含 go', (backend.get('todo:topics') || '').includes('go'));

  const add2 = await cliJson(['todo', 'add', '--topic', 'new', '第二条']);
  check('第二条 id 递增', add2.id === 30, JSON.stringify(add2));
  check('新主题 new 也被写入 topics', (backend.get('todo:topics') || '').includes('new'));

  // ─── 6. CRUD 五操作端到端 ────────────────────────────────────
  check('todo.list 三桶都在', await (async () => {
    const d = await cliJson(['todo', 'list']);
    return Array.isArray(d.open) && Array.isArray(d.done) && Array.isArray(d.freeze);
  })());
  check('todo.list --status open 只给 open', await (async () => {
    const d = await cliJson(['todo', 'list', '--status', 'open']);
    return d.open !== null && d.done === null && d.freeze === null;
  })());
  check('todo.get 命中待办', (await cliJson(['todo', 'get', '29'])).text === '第一条');

  const upd = await cliJson(['todo', 'update', '29', '--text', '第一条（改）', '--note', '备注']);
  check('todo.update 只改传入字段', upd.task.text === '第一条（改）' && upd.task.note === '备注');
  check('todo.update 不动 topic', upd.task.topic === 'go');
  check('todo.update 后能读回', (await cliJson(['todo', 'get', '29'])).text === '第一条（改）');

  check('todo.done 成功', (await cli(['todo', 'done', '29', '--result', '做完了'])).status === 0);
  const afterDone = await cliJson(['todo', 'get', '29']);
  check('done 后进了已完成桶', afterDone.bucket === 'done' && !!afterDone.doneAt);
  check('done 写了 note', afterDone.note === '做完了');
  check('done 后待办里没有它了', !(await cliJson(['todo', 'list', '--status', 'open'])).open.some((t) => t.id === 29));

  check('todo.remove 成功', (await cli(['todo', 'remove', '30'])).status === 0);
  check('remove 后查不到', (await cli(['todo', 'get', '30'])).status === 1);

  // ─── 7. 状态流转：冻结 / 解冻 ────────────────────────────────
  // 用独立 topic 'fz'：新任务会复用刚刚完成掉的 id（契约：分配不扫 done），
  // 于是与 done 里的旧记录同 id。用 --topic 消歧 —— 这正是在演示真实用法。
  await cliJson(['todo', 'add', '--topic', 'fz', '要冻结的']);
  const forFreeze = (await cliJson(['todo', 'list', '--status', 'open'])).open.find((t) => t.text === '要冻结的');
  const fzId = String(forFreeze.id);
  check('同 id 撞上 done 时，不带消歧的 freeze 会被拒绝', (await cli(['todo', 'freeze', fzId])).status === 1);
  check('todo.freeze 带 --topic 消歧后成功', (await cli(['todo', 'freeze', fzId, '--topic', 'fz'])).status === 0);
  check('freeze 保留原 id 并写 frozenAt', await (async () => {
    const t = await cliJson(['todo', 'get', fzId, '--topic', 'fz']);
    return t.bucket === 'freeze' && t.id === forFreeze.id && !!t.frozenAt;
  })());
  check('todo.unfreeze 成功', (await cli(['todo', 'unfreeze', fzId, '--topic', 'fz'])).status === 0);
  check('unfreeze 清 frozenAt', (await cliJson(['todo', 'get', fzId, '--topic', 'fz'])).frozenAt === '');
  check('重复解冻报错', (await cli(['todo', 'unfreeze', fzId, '--topic', 'fz'])).status === 1);

  // ─── 8. ⚠️ id 不唯一的防护（真实踩过的坑）────────────────────
  // 先把 open/freeze 清空，让「同 id 候选数」确定下来
  backend.seed('todo:open', JSON.stringify([]));
  backend.seed('todo:freeze', JSON.stringify([]));
  // done 里放 3 条同 id：分配只扫 open+freeze，所以完成过的 id 会被复用
  backend.seed('todo:done', JSON.stringify([
    T(29, 'qus', '旧记录A', { doneAt: '2026-08-15T15:09:00+08:00' }),
    T(29, 'qus', '旧记录B', { doneAt: '2026-08-22T10:40:12+08:00' }),
    T(29, 'fr', '旧记录C', { doneAt: '2026-08-30T10:36:25+08:00' }),
  ]));

  check('同 id 多条时 get 拒绝猜（exit 1）', (await cli(['todo', 'get', '29'])).status === 1);
  check('报错里列出候选项', ((await cli(['todo', 'get', '29'])).stdout + (await cli(['todo', 'get', '29'])).stderr).includes('[0]'));
  check('--pick 可精确选中', (await cliJson(['todo', 'get', '29', '--pick', '1'])).text === '旧记录B');
  check('--topic 能收窄到唯一', (await cliJson(['todo', 'get', '29', '--topic', 'fr'])).text === '旧记录C');
  check('--pick 越界报错', (await cli(['todo', 'get', '29', '--pick', '9'])).status === 1);

  // 关键回归：删除必须只删一条，不能把同 id 的全部删掉
  check('同 id 多条时 remove 拒绝执行', (await cli(['todo', 'remove', '29'])).status === 1);
  check('remove 前 done 有 3 条同 id', JSON.parse(backend.get('todo:done')).filter((t) => t.id === 29).length === 3);
  check('--pick 定向删除成功', (await cli(['todo', 'remove', '29', '--pick', '1'])).status === 0);
  const remain = JSON.parse(backend.get('todo:done')).filter((t) => t.id === 29);
  check('只删掉了 1 条，其余 2 条保留', remain.length === 2, `剩 ${remain.length} 条`);
  check('删掉的是选中的那条', !remain.some((t) => t.text === '旧记录B'));

  // ─── 9. topic 与 prompt ──────────────────────────────────────
  check('topic.list 带计数', await (async () => {
    const l = await cliJson(['topic', 'list']);
    return Array.isArray(l) && l.every((t) => typeof t.open === 'number');
  })());
  check('topic.add 幂等', await (async () => {
    await cli(['topic', 'add', 'zzz']);
    return (await cliJson(['topic', 'add', 'zzz'])).added === false;
  })());
  check('topic.remove 提示仍在使用的数量', await (async () => {
    const r = await cliJson(['topic', 'remove', 'go']);
    return r.removed === true && typeof r.inUse === 'number';
  })());
  check('topic.remove 不存在的主题不报错', (await cli(['topic', 'remove', 'never'])).status === 0);

  check('prompt.set 写入', (await cli(['prompt', 'set', 'go', 'Go 1.25; 优先标准库'])).status === 0);
  check('prompt.get 读回', (await cliJson(['prompt', 'get', 'go'])).prompt === 'Go 1.25; 优先标准库');
  check('prompt.get 不存在的主题 hasPrompt=false', (await cliJson(['prompt', 'get', 'nope'])).hasPrompt === false);
  check('prompt.remove 成功', (await cli(['prompt', 'remove', 'go'])).status === 0);
  check('prompt.remove 后再读为空', (await cliJson(['prompt', 'get', 'go'])).hasPrompt === false);

  // ─── 10. 工作空间隔离真的生效 ────────────────────────────────
  backend.seed('todo:open', JSON.stringify([T(1, 'g190', '只在 shared 组')]), 190);
  const defOpen = (await cliJson(['todo', 'list', '--status', 'open'])).open.length;
  await cli(['group', 'use', 'shared']);
  const sharedOpen = (await cliJson(['todo', 'list', '--status', 'open'])).open;
  check('切组后读到的是另一空间的数据', sharedOpen.length !== defOpen || sharedOpen.some((t) => t.topic === 'g190'), JSON.stringify(sharedOpen.map((t) => t.topic)));
  check('--group 可临时覆盖当前空间', await (async () => {
    const r = await cliJson(['todo', 'list', '--status', 'open', '--group', '190']);
    return r.open.some((t) => t.topic === 'g190');
  })());
  await cli(['group', 'use', 'default']);

  // ─── 11. 命令 ↔ 路由双向可查 ─────────────────────────────────
  check('routes --module todo', (await cliJson(['routes', '--module', 'todo'])).length > 5);
  check('routes --http 反查', (await cli(['routes', '--http', 'POST /api/todo'])).stdout.includes('todo add'));

  // ─── 12. Web API 与静态页 ────────────────────────────────────
  const { startServer } = await import(pathToFileURL(join(ROOT, '..', 'src', 'runtime', 'server.js')).href);
  const server = await startServer({ port: 0 });
  const base = 'http://127.0.0.1:' + server.address().port;

  const boot = await (await fetch(base + '/api/bootstrap')).json();
  check('api bootstrap', boot.ok && boot.data.loggedIn === true && Array.isArray(boot.data.commands));
  check('bootstrap 命令表含 http 字段', boot.data.commands.some((c) => c.http && c.http.path === '/api/todo'));

  const html = await (await fetch(base + '/')).text();
  check('web 首页', html.includes('nx-kv') && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html));

  const todoRes = await (await fetch(base + '/api/todo')).json();
  check('api todo 列表', todoRes.ok && Array.isArray(todoRes.data.open));

  const groupsRes = await (await fetch(base + '/api/groups')).json();
  check('api groups', groupsRes.ok && groupsRes.data.groups.length === 2);

  const notFound = await (await fetch(base + '/api/nothing')).json();
  check('api 404', !notFound.ok);

  // 跨站写请求必须被拒
  const blocked = await fetch(base + '/api/todo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ topic: 'x', text: 'y' }),
  });
  check('跨站写请求被拒（403）', blocked.status === 403);

  await new Promise((r) => server.close(r));
} finally {
  if (backend) await backend.close();
  rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项: ' + failed.map((f) => f.name).join(', '));
  process.exit(1);
}
