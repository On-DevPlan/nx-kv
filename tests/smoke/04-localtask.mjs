// 冒烟分组 4：实时任务输入 localtask（工作目录为主题、主题拥有队列，本机不依赖后端）。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function run(ctx) {
  const { check, cli, cliJson, tmp } = ctx;

  // ─── 11b. 实时任务输入 localtask ─────────────────────────────
  process.env.NX_KV_LOCALTASK_STORE = join(tmp, 'localtasks.json');
  // 这一段用例校验 wait 行为：系统提示词只进 instruction，task.text 保持库存原文
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

  const waitA = await cliJson(['localtask', 'wait', '--cwd', topicA]);
  check(
    'localtask wait 立即取走排队任务',
    waitA.status === 'ok' && waitA.queued === true && waitA.task.text === '选择工作空间 A' && waitA.summary === '',
    JSON.stringify(waitA)
  );

  // 不同目录 → 不同主题、空队列超时
  const waitTimeout = await cliJson(['localtask', 'wait', '--cwd', topicB, '--timeout', '1', '--no-open']);
  check(
    '不同主题另起队列、空队列超时 → timeout',
    waitTimeout.status === 'timeout' && waitTimeout.summary === '',
    JSON.stringify(waitTimeout)
  );

  const ov = await cliJson(['localtask', 'list']);
  check('总览 2 个主题（目录分散）、无等待中', ov.topics.length === 2 && ov.waiting === 0, JSON.stringify(ov.topics.map((t) => t.name)));

  // 同主题不同现状复用队列：再回填，id 接续为 2，wait（换现状措辞）取走
  const addedA2 = await cliJson(['localtask', 'add', '再给 A 的任务', '--cwd', topicA]);
  check('同主题复用：新任务 id=2', addedA2.task.id === 2, JSON.stringify(addedA2));
  const waitA2 = await cliJson(['localtask', 'wait', '--cwd', topicA]);
  check('wait 取走同主题新回填（跨现状）', waitA2.task.text === '再给 A 的任务' && waitA2.summary === '', JSON.stringify(waitA2));

  // #171：localtask get 是**领取**语义（查看走 localtask show）——缺 id 不再报错；
  //      get 也不再要求 --summary（面板上没有对应输入界面）。
  check('localtask show 缺 id 报错', (await cli(['localtask', 'show', '--cwd', topicA])).status === 1);
  check(
    'localtask remove 按主题+id 删除',
    (await cli(['localtask', 'remove', '--id', String(addedA2.task.id), '--cwd', topicA])).status === 0
  );

  const stCfg = await cliJson(['localtask', 'config', '--timeout', '300']);
  check('localtask config 设置超时（推荐 180、最大 600）', stCfg.timeoutSec === 300 && stCfg.maxSec === 600, JSON.stringify(stCfg));

  // ack 汇报要求：默认（内置 done 指令）/ 自定义 / 恢复内置
  const stAckDefault = await cliJson(['localtask', 'config', '--ack', '']);
  check(
    'config 恢复内置 ack（仍带 done 指令）',
    /localtask done/.test(stAckDefault.ackPromptList.join('\n')),
    JSON.stringify(stAckDefault)
  );

  const stAckOn = await cliJson([
    'localtask', 'config', '--ack', 'SMOKE_ACK 计划最后再次 nx-kv localtask wait',
  ]);
  check(
    'config 自定义 ack 已开启',
    /SMOKE_ACK/.test(stAckOn.ackPromptList.join('\n')),
    JSON.stringify(stAckOn)
  );

  // 加一条任务 → wait 拿到的 instruction（ack 段）应包含自定义 ack；正文保持原文
  await cliJson(['localtask', 'add', '任务本体', '--cwd', topicA]);
  const waitWithAck = await cliJson(['localtask', 'wait', '--cwd', topicA]);
  check(
    'wait 返回 instruction 带自定义 ack（task.text 保持原文）',
    waitWithAck.status === 'ok' &&
      waitWithAck.task.text === '任务本体' &&
      /SMOKE_ACK/.test(waitWithAck.instruction || ''),
    JSON.stringify(waitWithAck)
  );

  // 库存原文不应被改写
  const listAfter = await cliJson(['localtask', 'list']);
  const consumed = listAfter.topics.find((t) => t.key === waitWithAck.key).tasks.find((x) => x.id === waitWithAck.task.id);
  check('库存原文不含 ack 痕迹', consumed && consumed.text === '任务本体', JSON.stringify(consumed));

  // ack **模板**（含 {{ 占位符）：渲染进 instruction 字段，task.text 保持库存原文
  const stTpl = await cliJson([
    'localtask', 'config', '--ack',
    '{{task.text}} TPL_ACK {{#if goal}}〔{{goal.remainingHuman}}〕{{/if}}',
  ]);
  check(
    'config 设置 ack 模板',
    /\{\{task\.text\}\}/.test(stTpl.ackPromptList.join('\n')),
    JSON.stringify(stTpl)
  );
  await cliJson(['localtask', 'add', '模板任务本体', '--cwd', topicA]);
  const waitTpl = await cliJson(['localtask', 'wait', '--cwd', topicA]);
  check(
    'wait ack 模板渲染：instruction 含正文与 TPL_ACK，task.text 保持原文',
    waitTpl.status === 'ok' &&
      waitTpl.task.text === '模板任务本体' &&
      /模板任务本体[\s\S]*TPL_ACK/.test(waitTpl.instruction || ''),
    JSON.stringify(waitTpl)
  );
  // 模板模式同样不回写库存
  const listAfterTpl = await cliJson(['localtask', 'list']);
  const consumedTpl = listAfterTpl.topics
    .find((t) => t.key === waitTpl.key)
    .tasks.find((x) => x.id === waitTpl.task.id);
  check('模板模式库存原文不含模板痕迹', consumedTpl && consumedTpl.text === '模板任务本体', JSON.stringify(consumedTpl));

  // 恢复内置 ack，让主题清理不受影响
  await cliJson(['localtask', 'config', '--ack', '']);

  // ack 冒烟主题用完即清（避免影响后续用例）
  await cliJson(['localtask', 'topic', 'remove', '--key', waitWithAck.key, '--force']);

  // cancel：非等待中的主题为无操作（cancelled:false + reason:not_waiting）
  const cancelIdle = await cliJson(['localtask', 'cancel', '--cwd', topicA]);
  check('localtask cancel 非等待主题为无操作（cancelled:false）', cancelIdle.cancelled === false && cancelIdle.reason === 'not_waiting', JSON.stringify(cancelIdle));
  check('localtask cancel 缺定位报错', (await cli(['localtask', 'cancel'])).status === 1);

  // 删除主题 / 批量删除
  // 队列里还有**未领取**任务的主题默认删不掉（保护还没人领的活），要 --force 才强删。
  const delA = await cliJson(['localtask', 'add', '待删 A', '--cwd', topicA]);
  const delB = await cliJson(['localtask', 'add', '待删 B', '--cwd', topicB]);
  check('有未领取任务的主题默认拒绝删除', (await cli(['localtask', 'topic', 'remove', '--key', delA.key])).status === 1);
  check('单删缺定位报错', (await cli(['localtask', 'topic', 'remove'])).status === 1);
  check('单删主题 topic remove（按 key，--force）', (await cli(['localtask', 'topic', 'remove', '--key', delA.key, '--force'])).status === 0);
  check('总览剩 1 个（B）', (await cliJson(['localtask', 'list'])).topics.length === 1);
  const batch = await cliJson(['localtask', 'topic', 'remove-many', '--keys', delB.key]);
  check('批量删除：有未领取任务时跳过（reason:has_pending）', batch.count === 0 && batch.skipped[0] && batch.skipped[0].reason === 'has_pending', JSON.stringify(batch));
  check('remove-many 缺条件报错', (await cli(['localtask', 'topic', 'remove-many'])).status === 1);
  check('批量删除 --force 连未领取任务一起删', (await cliJson(['localtask', 'topic', 'remove-many', '--keys', delB.key, '--force'])).count === 1);
  check('总览清空', (await cliJson(['localtask', 'list'])).topics.length === 0);

  // 任务级删除是**可恢复**的软删除
  const softA = await cliJson(['localtask', 'add', '待软删', '--cwd', topicA]);
  const softRm = await cliJson(['localtask', 'remove', '--id', String(softA.task.id), '--cwd', topicA]);
  check('任务软删除：带 deletedAt 标记', !!(softRm.removed && softRm.removed.deletedAt), JSON.stringify(softRm.removed));
  const softBack = await cliJson(['localtask', 'task', 'restore', '--id', String(softA.task.id), '--cwd', topicA]);
  check('任务可恢复（撤销删除）', softBack.restored === true, JSON.stringify(softBack));
  await cliJson(['localtask', 'topic', 'remove', '--key', softA.key, '--force']);
}
