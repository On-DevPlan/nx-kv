// 冒烟测试：CLI 全链路 + HTTP API + 静态页。
//
// **对着假后端跑**（tests/fake-backend.mjs），不碰生产服务器上的真实清单。
// 使用临时配置（NX_KV_CONFIG），不污染 ~/.nx-kv。
// 运行：pnpm test（或 node tests/smoke.mjs）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// 附件本地镜像目录也指向临时目录：绝不在测试里往真实的 ~/.nx-kv/attachments/ 写东西
process.env.NX_KV_ATTACHMENTS = join(tmp, 'attachments');

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

  // ─── 4b. 工作空间的 CRUD（group 是集合资源，五操作齐备）───
  const newG = await cliJson(['group', 'add', '__smoke__', '--description', '自测']);
  check('group add 新建', newG.id > 500 && newG.name === '__smoke__', JSON.stringify(newG));
  check('group get 单条', (await cliJson(['group', 'get', String(newG.id)])).name === '__smoke__');
  check('group update 改名', (await cliJson(['group', 'update', String(newG.id), '--name', '__smoke2__'])).name === '__smoke2__');
  check('group update 后 get 能读到', (await cliJson(['group', 'get', String(newG.id)])).name === '__smoke2__');
  check('group get 不存在报错', (await cli(['group', 'get', '99999'])).status === 1);
  check('group members', (await cliJson(['group', 'members', '24'])).members.length > 0);
  check('group update 无字段报错', (await cli(['group', 'update', String(newG.id)])).status === 1);

  // 解散：切到该组时应被拦住（否则后续读写会打到一个不存在的组）
  await cli(['group', 'use', String(newG.id)]);
  check('不能解散当前使用中的工作空间', (await cli(['group', 'remove', String(newG.id)])).status === 1);
  await cli(['group', 'use', 'default']);
  check('切走后可解散', (await cli(['group', 'remove', String(newG.id)])).status === 0);
  check('解散后查不到', (await cli(['group', 'get', String(newG.id)])).status === 1);

  // 组内还有 KV 时拒绝解散（后端的前置条件）
  const withKv = await cliJson(['group', 'add', '__smoke_kv__']);
  await cli(['todo', 'add', '--topic', 'x', '占位', '--group', String(withKv.id)]);
  const refuse = await cli(['group', 'remove', String(withKv.id)]);
  check('组内有 KV 时拒绝解散', refuse.status === 1, (refuse.stdout + refuse.stderr).slice(0, 80));

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
  check('todo.get 命中待办（按内容定位，不用 id）', (await cliJson(['todo', 'get', '--ref', '第一条'])).text === '第一条');

  const upd = await cliJson(['todo', 'update', '--ref', '第一条', '--text', '第一条（改）', '--note', '备注']);
  check('todo.update 只改传入字段', upd.task.text === '第一条（改）' && upd.task.note === '备注');
  check('todo.update 不动 topic', upd.task.topic === 'go');
  check('todo.update 后能读回（用改后的内容）', (await cliJson(['todo', 'get', '--ref', '第一条（改）'])).text === '第一条（改）');
  check('update 后旧内容查不到', (await cli(['todo', 'get', '--ref', '第一条'])).status === 1);

  check('todo.done 成功', (await cli(['todo', 'done', '--ref', '第一条（改）', '--result', '做完了'])).status === 0);
  const afterDone = await cliJson(['todo', 'get', '--ref', '第一条（改）']);
  check('done 后进了已完成桶', afterDone.bucket === 'done' && !!afterDone.doneAt);
  check('done 写了 note', afterDone.note === '做完了');
  check('done 后待办里没有它了', !(await cliJson(['todo', 'list', '--status', 'open'])).open.some((t) => t.text === '第一条（改）'));

  check('todo.remove 成功', (await cli(['todo', 'remove', '--ref', '第二条'])).status === 0);
  check('remove 后查不到', (await cli(['todo', 'get', '--ref', '第二条'])).status === 1);

  // ─── 7. 状态流转：冻结 / 解冻 ────────────────────────────────
  // 定位一律按内容，与 id 无关 —— 这里刻意用与 done 里旧记录**不同的**文本，
  // 证明「同 id 会互相干扰」这件事已经不再是问题。
  await cliJson(['todo', 'add', '--topic', 'fz', '要冻结的']);
  const forFreeze = (await cliJson(['todo', 'list', '--status', 'open'])).open.find((t) => t.text === '要冻结的');
  check('todo.freeze 按内容定位成功', (await cli(['todo', 'freeze', '--ref', '要冻结的'])).status === 0);
  check('freeze 保留原 id 并写 frozenAt', await (async () => {
    const t = await cliJson(['todo', 'get', '--ref', '要冻结的']);
    return t.bucket === 'freeze' && t.id === forFreeze.id && !!t.frozenAt;
  })());
  check('todo.unfreeze 成功', (await cli(['todo', 'unfreeze', '--ref', '要冻结的'])).status === 0);
  check('unfreeze 清 frozenAt', (await cliJson(['todo', 'get', '--ref', '要冻结的'])).frozenAt === '');
  check('重复解冻报错', (await cli(['todo', 'unfreeze', '--ref', '要冻结的'])).status === 1);

  // ─── 8. ⚠️ 按内容定位的防护（真实踩过的坑）──────────────────
  // 先把 open/freeze 清空，让「同内容候选数」确定下来
  backend.seed('todo:open', JSON.stringify([]));
  backend.seed('todo:freeze', JSON.stringify([]));
  // done 里放 3 条同内容：这正是真实数据里最常见的情况——
  // 同一个主题下「修复登录页」这类任务会被反复投递。**它们的 id 故意各不相同**，
  // 证明按 id 定位根本帮不上忙，只有按内容 + --pick 才收敛得到。
  backend.seed('todo:done', JSON.stringify([
    T(29, 'qus', '旧记录', { doneAt: '2026-08-15T15:09:00+08:00' }),
    T(31, 'qus', '旧记录', { doneAt: '2026-08-22T10:40:12+08:00' }),
    T(33, 'fr', '旧记录', { doneAt: '2026-08-30T10:36:25+08:00' }),
  ]));

  check('同内容多条时 get 拒绝猜（exit 1）', (await cli(['todo', 'get', '--ref', '旧记录'])).status === 1);
  check('报错里列出候选项', ((await cli(['todo', 'get', '--ref', '旧记录'])).stdout + (await cli(['todo', 'get', '--ref', '旧记录'])).stderr).includes('[0]'));
  check('--pick 可精确选中', await (async () => {
    const t = await cliJson(['todo', 'get', '--ref', '旧记录', '--pick', '1']);
    return t.id === 31 && t.bucket === 'done';
  })());
  check('--topic 能收窄到唯一', (await cliJson(['todo', 'get', '--ref', '旧记录', '--topic', 'fr'])).id === 33);
  check('--pick 越界报错', (await cli(['todo', 'get', '--ref', '旧记录', '--pick', '9'])).status === 1);

  // 关键回归：删除必须只删一条，不能把同内容的全部删掉
  check('同内容多条时 remove 拒绝执行', (await cli(['todo', 'remove', '--ref', '旧记录'])).status === 1);
  check('remove 前 done 有 3 条同内容', JSON.parse(backend.get('todo:done')).filter((t) => t.text === '旧记录').length === 3);
  check('--pick 定向删除成功', (await cli(['todo', 'remove', '--ref', '旧记录', '--pick', '1'])).status === 0);
  const remain = JSON.parse(backend.get('todo:done')).filter((t) => t.text === '旧记录');
  check('只删掉了 1 条，其余 2 条保留', remain.length === 2, `剩 ${remain.length} 条`);
  check('删掉的是选中的那条（id=31）', !remain.some((t) => t.id === 31));
  check('另外两条 id 都还在', remain.map((t) => t.id).sort().join(',') === '29,33');

  // ─── 8c. --ref 是必填；空 ref 不能被当成「匹配空文本」 ──────
  check('不带 --ref 报错 exit 1', (await cli(['todo', 'get'])).status === 1);
  check('报错提到 --ref', /--ref/.test((await cli(['todo', 'get'])).stdout + (await cli(['todo', 'get'])).stderr));
  check('空 --ref 报错而不是乱命中', (await cli(['todo', 'get', '--ref', ''])).status === 1);

  // ─── 8b. 归档：completed 里较旧的移到冷 key ──────────────────
  backend.seed('todo:done', JSON.stringify([
    T(1, 'go', '很久以前完成的', { doneAt: '2020-01-01T00:00:00+08:00' }),
    T(2, 'go', '最近完成的', { doneAt: new Date().toISOString() }),
  ]));
  const arch = await cliJson(['todo', 'archive', '--before', '2021-01-01']);
  check('归档移走旧记录', arch.moved === 1 && arch.remaining === 1, JSON.stringify(arch));
  check('冷 key 按日期分片', /^todo:done:cold:\d{4}-\d{2}-\d{2}$/.test(arch.coldKey), arch.coldKey);
  check('冷 key 里确实有那条', (backend.get(arch.coldKey) || '').includes('很久以前完成的'));
  check('未到期的仍在 done 里', (await cliJson(['todo', 'list', '--status', 'done'])).done.length === 1);
  check('没有可归档时不报错', (await cliJson(['todo', 'archive', '--before', '2021-01-01'])).moved === 0);

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

  // ─── 11b. 实时任务输入 localtask（工作目录为主题、主题拥有队列，本机不依赖后端）─
  process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'localtasks.json');
  // 这一段用例校验 wait 行为：先把收尾追加语关掉，避免自动追加污染 task.text 严格相等断言
  await cliJson(['localtask', 'config', '--no-suffix']);
  const topicA = join(tmp, 'projA');
  const topicB = join(tmp, 'projB');
  mkdirSync(topicA, { recursive: true });
  mkdirSync(topicB, { recursive: true });

  const emptyOv = await cliJson(['localtask', 'list']);
  check(
    'localtask 初始总览为空',
    emptyOv.waiting === 0 && Array.isArray(emptyOv.topics) && emptyOv.topics.length === 0,
    JSON.stringify(emptyOv)
  );

  const sumA = '已完成登录，等待选择工作空间';
  const addedA = await cliJson(['localtask', 'add', '选择工作空间 A', '--cwd', topicA, '--summary', sumA]);
  check('localtask add 排队（含 key）', addedA.queued === true && addedA.task.id === 1 && !!addedA.key, JSON.stringify(addedA));
  check('总览 1 个主题、待领取 1', (await cliJson(['localtask', 'list'])).topics[0].pending === 1);

  const waitA = await cliJson(['localtask', 'wait', '--cwd', topicA, '--summary', sumA]);
  check(
    'localtask wait 立即取走排队任务',
    waitA.status === 'ok' && waitA.queued === true && waitA.task.text === '选择工作空间 A' && waitA.summary === sumA,
    JSON.stringify(waitA)
  );

  // 不同目录 → 不同主题、空队列超时
  const sumB = '已选好工作空间，等待下一步指令';
  const waitTimeout = await cliJson(['localtask', 'wait', '--cwd', topicB, '--summary', sumB, '--timeout', '1', '--no-open']);
  check(
    '不同主题另起队列、空队列超时 → timeout',
    waitTimeout.status === 'timeout' && waitTimeout.summary === sumB,
    JSON.stringify(waitTimeout)
  );

  const ov = await cliJson(['localtask', 'list']);
  check('总览 2 个主题（目录分散）、无等待中', ov.topics.length === 2 && ov.waiting === 0, JSON.stringify(ov.topics.map((t) => t.name)));

  // 同主题不同现状复用队列：再回填，id 接续为 2，wait（换现状措辞）取走
  const addedA2 = await cliJson(['localtask', 'add', '再给 A 的任务', '--cwd', topicA]);
  check('同主题复用：新任务 id=2', addedA2.task.id === 2, JSON.stringify(addedA2));
  const waitA2 = await cliJson(['localtask', 'wait', '--cwd', topicA, '--summary', '新的现状措辞']);
  check('wait 取走同主题新回填（跨现状）', waitA2.task.text === '再给 A 的任务' && waitA2.summary === '新的现状措辞', JSON.stringify(waitA2));

  check('localtask get 缺 id 报错', (await cli(['localtask', 'get', '--cwd', topicA])).status === 1);
  check(
    'localtask remove 按主题+id 删除',
    (await cli(['localtask', 'remove', '--id', String(addedA2.task.id), '--cwd', topicA])).status === 0
  );

  const stCfg = await cliJson(['localtask', 'config', '--timeout', '300']);
  check('localtask config 设置超时（推荐 180、最大 600）', stCfg.timeoutSec === 300 && stCfg.maxSec === 600, JSON.stringify(stCfg));

  // 收尾追加语：默认 / 自定义 / 关闭 / 恢复
  const stSuffixOn = await cliJson(['localtask', 'config', '--suffix', 'SMOKE_TAIL 计划最后再次 nx-kv localtask wait']);
  check('config 自定义收尾追加语已开启', stSuffixOn.suffixEnabled === true && /SMOKE_TAIL/.test(stSuffixOn.taskSuffix), JSON.stringify(stSuffixOn));

  // 加一条任务 → wait 拿到的 task.text 末尾应包含自定义追加语
  await cliJson(['localtask', 'add', '任务本体', '--cwd', topicA]);
  const waitWithSuffix = await cliJson(['localtask', 'wait', '--cwd', topicA, '--summary', '追加语冒烟']);
  check(
    'wait 返回末尾追加收尾语',
    waitWithSuffix.status === 'ok' && /任务本体[\s\S]*SMOKE_TAIL/.test(waitWithSuffix.task.text),
    JSON.stringify(waitWithSuffix)
  );

  // 库存原文不应被改写
  const listAfter = await cliJson(['localtask', 'list']);
  const consumed = listAfter.topics.find((t) => t.key === waitWithSuffix.key).tasks.find((x) => x.id === waitWithSuffix.task.id);
  check('库存原文不含追加语', consumed && consumed.text === '任务本体', JSON.stringify(consumed));

  // 关闭追加：PATCH suffix=''
  const stSuffixOff = await cliJson(['localtask', 'config', '--no-suffix']);
  check('--suffix "" 关闭追加', stSuffixOff.suffixEnabled === false && stSuffixOff.taskSuffix === '', JSON.stringify(stSuffixOff));

  // 收尾追加语冒烟主题用完即清（避免影响后续用例）
  await cliJson(['localtask', 'topic', 'remove', '--key', waitWithSuffix.key, '--force']);

  // cancel：非等待中的主题为无操作（cancelled:false + reason:not_waiting）
  const cancelIdle = await cliJson(['localtask', 'cancel', '--cwd', topicA]);
  check('localtask cancel 非等待主题为无操作（cancelled:false）', cancelIdle.cancelled === false && cancelIdle.reason === 'not_waiting', JSON.stringify(cancelIdle));
  check('localtask cancel 缺定位报错', (await cli(['localtask', 'cancel'])).status === 1);

  // 删除主题 / 批量删除
  const delA = await cliJson(['localtask', 'add', '待删 A', '--cwd', topicA]);
  const delB = await cliJson(['localtask', 'add', '待删 B', '--cwd', topicB]);
  check('单删主题 topic remove（按 key）', (await cli(['localtask', 'topic', 'remove', '--key', delA.key])).status === 0);
  check('单删缺定位报错', (await cli(['localtask', 'topic', 'remove'])).status === 1);
  check('总览剩 1 个（B）', (await cliJson(['localtask', 'list'])).topics.length === 1);
  const batch = await cliJson(['localtask', 'topic', 'remove-many', '--keys', delB.key]);
  check('批量删除主题 remove-many', batch.count === 1, JSON.stringify(batch));
  check('remove-many 缺条件报错', (await cli(['localtask', 'topic', 'remove-many'])).status === 1);
  check('总览清空', (await cliJson(['localtask', 'list'])).topics.length === 0);

  // ─── 11c. 附件：上传 / 嵌入任务 / 同步到本地 / 自动下载 ──────
  //
  // 这一段的要害是「附件能不能变成 agent 手上的一个本地文件」——
  // 上传只认 multipart、后端不回原名、本地名字只能自己定，这些都在这里钉死。
  const attHome = process.env.NX_KV_ATTACHMENTS;
  const pngPath = join(tmp, 'logo.png');
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  writeFileSync(pngPath, pngBytes);

  const up = await cliJson(['file', 'upload', '--path', pngPath]);
  check('file upload 返回 32 位 hex fileId', /^[0-9a-f]{32}$/.test(up.fileId || ''), JSON.stringify(up).slice(0, 160));
  check(
    'file upload 认出图片并给出 markdown 片段',
    up.isImage === true && up.markdown.image === `![logo.png](${up.fileId})`,
    JSON.stringify(up.markdown)
  );

  const docxPath = join(tmp, '报告.docx');
  writeFileSync(docxPath, Buffer.from('PK\u0003\u0004 fake docx body'));
  const upDoc = await cliJson(['file', 'upload', '--path', docxPath]);
  check(
    'file upload 支持 docx（按链接语法）',
    upDoc.isImage === false && upDoc.markdown.file === `[报告.docx](${upDoc.fileId})`,
    JSON.stringify(upDoc.markdown)
  );

  check('file list 看到两个附件', (await cliJson(['file', 'list'])).total === 2);
  check('未同步时 localPath 为空', (await cliJson(['file', 'list'])).files.every((f) => f.localPath === ''));
  check(
    'file get 读到元数据',
    await (async () => {
      const fi = await cliJson(['file', 'get', up.fileId]);
      return fi.fileId === up.fileId && fi.size === pngBytes.length;
    })()
  );
  check('file get 不存在的 id 报错', (await cli(['file', 'get', 'f'.repeat(32)])).status === 1);

  await cli(['todo', 'add', '--topic', 'att', '待办带附件']);
  const attached = await cliJson(['todo', 'attach', '--ref', '待办带附件', '--fileId', up.fileId, '--name', 'logo.png', '--kind', 'image']);
  check(
    'todo attach 把嵌入追加进正文末尾',
    attached.task.text === `待办带附件 ![logo.png](${up.fileId})`,
    attached.task.text
  );
  const attached2 = await cliJson(['todo', 'attach', '--ref', attached.task.text, '--fileId', upDoc.fileId, '--kind', 'file']);
  check('再追加一个 docx 附件', attached2.task.text.includes(`[${upDoc.fileId}](${upDoc.fileId})`), attached2.task.text);
  check(
    'todo attach 拒绝不像附件 id 的值',
    (await cli(['todo', 'attach', '--ref', attached2.task.text, '--fileId', 'http://evil/x.png'])).status === 1
  );

  const attList = await cliJson(['todo', 'attachments', '--ref', attached2.task.text]);
  check('todo attachments 列出 2 个附件且类型正确', attList.count === 2 && attList.attachments[0].kind === 'image', JSON.stringify(attList.attachments));

  const sync1 = await cliJson(['file', 'sync']);
  check('file sync 下载两个附件', sync1.downloaded === 2, JSON.stringify(sync1).slice(0, 200));
  check('落盘目录在 nx-kv 用户目录下（测试用 NX_KV_ATTACHMENTS 覆盖）', sync1.usedDir.startsWith(attHome), sync1.usedDir);
  check('返回的是**本地绝对路径**且文件真的在', sync1.files.every((f) => existsSync(f.path)), JSON.stringify(sync1.files.map((f) => f.path)));
  check('非图片附件保留扩展名（否则双击打不开）', sync1.files.some((f) => f.path.endsWith('.docx')), JSON.stringify(sync1.files.map((f) => f.name)));

  const sync2 = await cliJson(['file', 'sync']);
  check('二次同步跳过未变更（不重复下载）', sync2.downloaded === 0 && sync2.skipped === 2, JSON.stringify(sync2).slice(0, 160));

  check('setting 默认不开自动下载', (await cliJson(['setting', 'get'])).autoSyncAttachments === false);
  check('setting set 打开自动下载', (await cliJson(['setting', 'set', '--autoSyncAttachments'])).autoSyncAttachments === true);
  check('setting.set 无参数报错', (await cli(['setting', 'set'])).status === 1);

  // 换一个目录，验证「读任务时自动下载」这条链路真的会落盘并回传全路径
  const attHome2 = join(tmp, 'attachments-2');
  process.env.NX_KV_ATTACHMENTS = attHome2;
  const read = await cliJson(['todo', 'get', '--ref', attached2.task.text]);
  check('todo get 回传 attachments', Array.isArray(read.attachments) && read.attachments.length === 2, JSON.stringify(read).slice(0, 240));
  check('每个附件都带存在的本地全路径', read.attachments.every((a) => existsSync(a.localPath)), JSON.stringify(read.attachments.map((a) => a.localPath)));
  check('图片按 markdown 里的说明取名落盘', read.attachments[0].localPath.endsWith('logo.png'), read.attachments[0].localPath);
  check('读取时自动下载有如实报告', !!read.attachmentsSync && read.attachmentsSync.downloaded === 2, JSON.stringify(read.attachmentsSync));
  check(
    'todo list 也带本地路径',
    await (async () => {
      const l = await cliJson(['todo', 'list', '--topic', 'att']);
      const t = l.open.find((x) => x.text === attached2.task.text);
      return !!t && t.attachments.length === 2 && existsSync(t.attachments[0].localPath);
    })()
  );
  // 关掉开关后：不再触网同步（无 attachmentsSync），但**附件标注仍在**
  // ——「这条任务挂了附件」本身是清单事实，与「要不要下载」是两回事。
  check('关掉自动下载后不再同步，但附件标注仍保留', await (async () => {
    await cli(['setting', 'set', '--autoSyncAttachments=false']);
    const l = await cliJson(['todo', 'list', '--status', 'open']);
    const t = l.open.find((x) => x.text === attached2.task.text);
    return l.attachmentsSync === undefined && !!t && t.attachments.length === 2 && t.attachments[0].synced === true;
  })());
  process.env.NX_KV_ATTACHMENTS = attHome;

  check(
    'file content（CLI）给出地址与本地路径',
    await (async () => {
      const c = await cliJson(['file', 'content', up.fileId]);
      return /^https?:\/\//.test(c.url) && c.localPath.endsWith('.png');
    })()
  );

  const removed = await cliJson(['file', 'remove', upDoc.fileId]);
  check('file remove 软删成功', removed.status === 'ok' && removed.deleted === true, JSON.stringify(removed));
  check('remove 后只剩一个附件', (await cliJson(['file', 'list'])).total === 1);

  // 附件必须与任务落在**同一个**工作空间。这里刻意用 `group use shared`（改本机配置）
  // 而不是 `--group` —— 「配置里是 190、这条命令没传 --group」正是最容易静默错位的路径。
  await cli(['group', 'use', 'shared']);
  const sharedUp = await cliJson(['file', 'upload', '--path', pngPath, '--name', 'shared.png']);
  check('切组后上传落进该空间', /^[0-9a-f]{32}$/.test(sharedUp.fileId || ''));
  check('该空间 list 能看到它', (await cliJson(['file', 'list'])).files.some((f) => f.fileId === sharedUp.fileId));
  check(
    '切回默认组后就看不到它（空间隔离生效）',
    await (async () => {
      await cli(['group', 'use', 'default']);
      return (await cliJson(['file', 'list'])).files.every((f) => f.fileId !== sharedUp.fileId);
    })()
  );
  check(
    'sync 落到该工作空间的目录（不是 default）',
    await (async () => {
      await cli(['group', 'use', 'shared']);
      const s = await cliJson(['file', 'sync']);
      await cli(['group', 'use', 'default']);
      return /[\\/]190$/.test(s.usedDir) && s.files.length === 1 && existsSync(s.files[0].path);
    })()
  );

  // ─── 12. Web API 与静态页 ────────────────────────────────────
  const { startServer } = await import(pathToFileURL(join(ROOT, '..', 'src', 'runtime', 'server.js')).href);
  const server = await startServer({ port: 0 });
  const base = 'http://127.0.0.1:' + server.address().port;

  const boot = await (await fetch(base + '/api/bootstrap')).json();
  check('api bootstrap', boot.ok && boot.data.loggedIn === true && Array.isArray(boot.data.commands));
  check('bootstrap 命令表含 http 字段', boot.data.commands.some((c) => c.http && c.http.path === '/api/todo'));

  const html = await (await fetch(base + '/')).text();
  check('web 首页', html.includes('nx-kv') && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html));

  // 图标走 vite publicDir（src/web/frontend/public/）拷进产物；
  // ico 兜底若 404，浏览器页签就是一片空白——这里钉住它。
  check('web 图标可达', (await fetch(base + '/favicon.ico')).status === 200);

  const todoRes = await (await fetch(base + '/api/todo')).json();
  check('api todo 列表', todoRes.ok && Array.isArray(todoRes.data.open));

  // ---- 附件（面板链路：base64 上传 → 服务端转 multipart；<img> 走 content 代理）----
  const apiFiles0 = await (await fetch(base + '/api/file')).json();
  check('api file 列表可达', apiFiles0.ok && Array.isArray(apiFiles0.data.files) && apiFiles0.data.files.length === 1);

  const upHttp = await (
    await fetch(base + '/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'panel.png', content: pngBytes.toString('base64'), contentType: 'image/png', group: 0 }),
    })
  ).json();
  check('api file 上传（面板 base64 路径）', upHttp.ok && /^[0-9a-f]{32}$/.test(upHttp.data.fileId || ''), JSON.stringify(upHttp).slice(0, 200));
  check('上传后列表变成 2', (await (await fetch(base + '/api/file')).json()).data.total === 2);

  const imgRes = await fetch(base + '/api/file/content/' + up.fileId);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  check('api file content 直出字节（面板图片预览走这条）', imgRes.status === 200 && imgBuf.length === pngBytes.length, `${imgRes.status}/${imgBuf.length}`);

  const apiSetting = await (await fetch(base + '/api/setting')).json();
  check('api setting 可读', apiSetting.ok && apiSetting.data.autoSyncAttachments === false, JSON.stringify(apiSetting).slice(0, 200));

  const groupsRes = await (await fetch(base + '/api/groups')).json();
  // 不assert精确数量：前面的用例会新建/解散组，数量是流动的
  check(
    'api groups',
    groupsRes.ok && groupsRes.data.groups.some((g) => g.name === '个人空间') && groupsRes.data.groups.some((g) => g.name === 'shared')
  );

  const notFound = await (await fetch(base + '/api/nothing')).json();
  check('api 404', !notFound.ok);

  // 跨站写请求必须被拒
  const blocked = await fetch(base + '/api/todo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ topic: 'x', text: 'y' }),
  });
  check('跨站写请求被拒（403）', blocked.status === 403);

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
    'api sessiontasks/cancel 可达且对未知主题无操作',
    cancelHttp.ok === true && cancelHttp.data && cancelHttp.data.cancelled === false && cancelHttp.data.reason === 'not_waiting',
    JSON.stringify(cancelHttp)
  );

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
