// 冒烟分组 3：topic 与 prompt、工作空间隔离、命令 ↔ 路由双向可查。
export async function run(ctx) {
  const { check, cli, cliJson, backend, T } = ctx;

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
}
