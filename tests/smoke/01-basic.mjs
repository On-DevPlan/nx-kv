// 冒烟分组 1：基础命令、未登录行为、登录、工作空间（含 CRUD 与解散保护）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './harness.mjs';

export async function run(ctx) {
  const { check, cli, cliJson, backend, cfgPath } = ctx;

  // ─── 1. 基础命令 ─────────────────────────────────────────────
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
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

  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
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
}
