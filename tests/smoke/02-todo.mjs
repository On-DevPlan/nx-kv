// 冒烟分组 2：todo 的 id 分配、CRUD 五操作、冻结/解冻、按内容定位的防护、归档。
export async function run(ctx) {
  const { check, cli, cliJson, backend, T } = ctx;

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
}
