// ─── 定位：一律按**内容**，不按 id ⚠️ ──────────────────────────────
//
// **id 非常容易重复，不足以定位一条任务。** 两条独立的原因：
//
//   1. 分配只扫 open + freeze（契约 1），任务完成、open 清空后新任务会重新
//      用上已占过的 id。实测 done 有 68 条、其中 id=29 有 7 条。
//   2. 同一个主题里，写「修复登录页」这样内容的任务本来就会反复出现——
//      即使 id 不撞，光看 id 也说不清调用方指的是哪一条。
//
// 所以 `id` 在本项目里**只是给人和外部系统看的元数据**：继续分配、继续出现在
// 输出里，但**不再是任何命令的入参**。定位一律用文本内容，见下面的 ref。
//
// 由此推出两条硬约束，违反其一都会静默改错数据：
//
//   1. **命中多条时必须消歧，不能猜一条。** 用 `findIndex` 取第一条，
//      在 done 上取到的是最老的记录，而调用方往往以为自己在操作刚创建的那条。
//   2. **变更必须按 index 定位，禁止 `filter(t => t.text !== ref)`。**
//      后者会把**所有**同内容的条目一起删掉。
import { badInput, notFound, conflict } from '../../core/errors.js';
import { BUCKETS } from './store.js';

/** 找出所有内容匹配的条目（跨桶，含同桶内重复）。
 *  用整串精确比对——不做前缀/模糊匹配，避免「看起来像」被当成「就是它」。 */
export function locateAll(all, ref) {
  const want = String(ref ?? '');
  const hits = [];
  for (const bucket of BUCKETS) {
    all[bucket].forEach((task, index) => {
      if (task.text === want) hits.push({ bucket, index, task });
    });
  }
  return hits;
}

/**
 * 定位唯一一条。`ref` 是任务**内容**（整串）。
 *
 * 消歧手段有两个，按需组合：
 *   `--topic <名字>`  按主题收窄（同内容散落在不同主题时的快捷方式）
 *   `--pick <n>`      按编号选择（最通用；同内容且同主题时唯一可靠的手段）
 *
 * 报错时把候选项编号列出来，调用方（人或 agent）照着选即可——**绝不替调用方猜**。
 */
export function locateUnique(all, ref, { topic, pick } = {}) {
  const want = String(ref ?? '');

  // 空 ref 是**参数错误**而不是 NOT_FOUND：绝大多数时候是忘了传 --ref，
  // 而空串恰好会匹配上数据里 text 为空的坏条目——那等于随机改一条，必须挡在门外。
  if (!want) throw badInput('task 内容不能为空（用 --ref 指定要操作的任务文本）');

  const allHits = locateAll(all, want);
  const hits = topic ? allHits.filter((h) => h.task.topic === topic) : allHits;
  const shown = want.length > 40 ? want.slice(0, 40) + '…' : want;

  if (!hits.length) {
    if (allHits.length) {
      const topics = [...new Set(allHits.map((h) => h.task.topic))].join(', ');
      throw notFound(`task「${shown}」存在，但 topic 不是 ${topic}（实际 topic: ${topics}）`);
    }
    throw notFound(`task「${shown}」不存在（待办 / 已完成 / 冻结里都没有）`);
  }

  if (pick !== undefined && pick !== null) {
    const n = Number(pick);
    if (!Number.isInteger(n) || n < 0 || n >= hits.length) {
      throw badInput(`--pick 必须是 0..${hits.length - 1} 之间的整数，收到: ${pick}`);
    }
    return hits[n];
  }

  if (hits.length > 1) {
    const list = hits
      .map((h, i) => `  [${i}] ${h.bucket.padEnd(6)} ${h.task.topic.padEnd(5)} ${h.task.createdAt}`)
      .join('\n');
    throw conflict(
      `task「${shown}」命中 ${hits.length} 条，无法确定是哪一条。用 --pick <n> 选择：\n${list}` +
        (topic ? '' : `\n（也可先用 --topic <名字> 收窄）`),
      { candidates: hits.map((h, i) => ({ pick: i, bucket: h.bucket, topic: h.task.topic, createdAt: h.task.createdAt })) }
    );
  }
  return hits[0];
}
