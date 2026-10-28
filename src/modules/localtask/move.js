// task move —— 本机队列 ⇄ 云端清单的任务迁移（原型设计稿 §5 / §7.3）。
//
// 心智模型：本机队列 = 这台机器的 agent 队列；云端清单 = 跨机器共享的工作空间。
// 同一目录的任务可以在两侧之间迁移。原子性规则：**先写目标端、成功才改源端**——
// 目标端写失败（未登录、网络故障）直接抛错，源端一字不动、不产生迁出记录；
// 成功后才在本机条目上打 migratedTo（tombstone）。撤销按返回的 targetId 精确删，
// **不按文本匹配**（同内容 ×N 时按文本删会误伤）。
//
// 本文件只做编排；store 读写原语在 ./service.js，云端读写复用 todo 服务。
// 跨模块依赖刻意走**动态导入**：迁移不是启动路径，localtask 的启动不应拖上 todo
// （分层约束也要求模块之间不静态互依）。
import { badInput, notFound, conflict } from '../../core/errors.js';
import * as local from './service.js';

const SIDES = new Set(['local', 'cloud']);

let todoMod = null;
async function cloudTodo() {
  todoMod ||= await import('../todo/service.js');
  return todoMod;
}

// 云端读写可注入（单测用；HTTP/CLI 路径不传该字段——action run 显式挑选字段，
// body 里的多余键到不了这里）。缺省走真实 todo 服务。
async function cloudOf(p) {
  if (p && p._cloud) return p._cloud;
  return cloudTodo();
}

function assertSides(from, to) {
  if (!SIDES.has(from)) throw badInput('--from 只能是 local | cloud');
  if (!SIDES.has(to)) throw badInput('--to 只能是 local | cloud');
  if (from === to) throw badInput('--from 与 --to 不能相同（迁移要有方向）');
}

/** 迁移一条任务。参数见 localtask/index.js 的 task.move 声明。 */
export async function moveTask(p = {}) {
  const from = String(p.from || '');
  const to = String(p.to || '');
  if (p.undo) return undoMove(p);
  assertSides(from, to);
  if (from === 'local') return moveToCloud(p);
  return moveToLocal(p);
}

// ─── 本机 → 云端 ──────────────────────────────────────────────────

async function moveToCloud({ cwd, key, id, topic, merge = false, group } = {}) {
  const cloud = await cloudOf(arguments[0]);
  const loc = await local.getTopicTask({ cwd, key, id });
  const t = loc.task;
  if (t.migratedTo) {
    throw conflict(`#${t.id} 已迁移到云端「${t.migratedTo.topic}」（撤销请用 task move --undo）`);
  }
  if (t.status === 'consumed') throw conflict(`#${t.id} 已被领取，不能再迁移`);
  if (t.deletedAt) throw conflict(`#${t.id} 已被删除，先恢复再迁移`);

  const cloudTopic = String(topic || '').trim() || loc.name; // 默认用目录名
  const all = await cloud.loadAll(group); // 未登录在这里抛 → 源端不动 ✓
  const dups = all.open.filter((x) => x.text === t.text && x.topic === cloudTopic);

  let targetId;
  let merged = false;
  if (merge && dups.length) {
    targetId = dups[0].id;
    merged = true;
  } else {
    const added = await cloud.addTodo({ topic: cloudTopic, text: t.text, groupId: group, from: 'local' });
    targetId = added.id;
  }

  // 目标端已写成功 → 才给源端打迁出标记
  const marked = await local.markTaskMigrated({
    key: loc.key,
    id: t.id,
    migratedTo: { side: 'cloud', topic: cloudTopic, targetId, at: local.stampNow() },
  });
  return {
    from: 'local',
    to: 'cloud',
    dirName: loc.name,
    topic: cloudTopic,
    text: t.text,
    targetId,
    tombstoneId: t.id,
    merged,
    dupCount: dups.length,
    movedAt: marked.task.migratedTo.at,
  };
}

// ─── 云端 → 本机 ──────────────────────────────────────────────────

async function moveToLocal({ topic, text, pick, cwd, key, group } = {}) {
  const cloud = await cloudOf(arguments[0]);
  const body = String(text || '').trim();
  if (!body) throw badInput('--text 必填（云端任务按内容定位，不按 id——id 会被复用）');
  const t = String(topic || '').trim();
  if (!t) throw badInput('--topic 必填（云端主题 = 目录名）');
  if (!cwd && !key) throw badInput('需要 --cwd <目标目录> 或 --key <主题 key>（迁到哪个本机队列）');

  const all = await cloud.loadAll(group); // 未登录在这里抛 → 本机不动 ✓
  const hits = [];
  all.open.forEach((task, index) => {
    if (task.text === body && task.topic === t) hits.push({ task, index });
  });
  if (!hits.length) {
    const where = t ? `主题「${t}」` : '';
    throw notFound(`云端待办${where}里没有这条任务: ${body.slice(0, 60)}`);
  }
  if (hits.length > 1 && (pick === undefined || pick === null)) {
    throw conflict(
      `云端待办有 ${hits.length} 条同内容任务，用 --pick <编号> 消歧`,
      { candidates: hits.map((h, i) => ({ pick: i, id: h.task.id, createdAt: h.task.createdAt, from: h.task.from || '' })) }
    );
  }
  const hit = hits[Math.min(Math.max(0, Number(pick) || 0), hits.length - 1)];

  // 先写目标端（本机待领取首位），成功才删云端那条
  const ins = await local.insertTaskAtTop({ cwd, key, text: hit.task.text, from: 'cloud' });
  await cloud.removeOpenById(hit.task.id, { groupId: group });
  return {
    from: 'cloud',
    to: 'local',
    dirName: ins.name,
    topic: t,
    text: hit.task.text,
    targetId: ins.task.id,
    tombstoneId: null,
    cloudTaskId: hit.task.id,
    movedAt: local.stampNow(),
  };
}

// ─── 撤销 ────────────────────────────────────────────────────────
//
// 传入**原 move 的同组参数** + --undo + --target-id（move 返回的 targetId）。
// 撤销不是"再来一次反向 move"——它按精确 id 回退，不触发新的确认/消歧。

async function undoMove(p) {
  const { from, to, 'target-id': targetId, merged = false, cwd, key, id, topic, text, group } = p;
  const cloud = await cloudOf(p);
  assertSides(from, to);
  const wantTarget = Number(targetId);
  if (!Number.isFinite(wantTarget) || wantTarget <= 0) {
    throw badInput('撤销需要 --target-id <迁移时返回的 targetId>');
  }

  if (from === 'local') {
    // local → cloud 的撤销：删掉云端那条（合并过的没新增，只清标记），清本机 tombstone
    if (!merged) await cloud.removeOpenById(wantTarget, { groupId: group });
    const cleared = await local.clearTaskMigrated({ cwd, key, id });
    if (!cleared.restored) {
      throw conflict('这条任务没有迁出记录，无从撤销');
    }
    return { undone: true, from, to, targetId: wantTarget, tombstoneId: cleared.task.id, dirName: cleared.name, text: cleared.task.text };
  }

  // cloud → local 的撤销：删掉本机那条（必须还没被领取），云端原样加回
  const rm = await local.removeTask({ cwd, key, id: wantTarget, purge: true });
  const body = String(text || '').trim() || rm.removed.text;
  const cloudTopic = String(topic || '').trim() || rm.name;
  const added = await cloud.addTodo({ topic: cloudTopic, text: body, groupId: group });
  return { undone: true, from, to, targetId: wantTarget, cloudId: added.id, dirName: rm.name, text: body };
}
