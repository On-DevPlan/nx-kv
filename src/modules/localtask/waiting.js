// （#54 自 service.js 拆出）等待态生命周期：setWaiting（含毫秒精度截止时刻）/
// clearWaiting（绝不重建已删主题）/ 用户点「关闭等待」（cancelWait，只翻标记）/
// wait 端取消标记消费（consumeCancelRequest）。
import { isGlobalKey, GLOBAL_NAME, resolveTopicKey } from './paths.js';
import { loadStore, saveStore, stampNow, topicOf } from './store-io.js';
import { isLiveWaiting } from './task-view.js';
// 在 store 里把某主题置为等待/结束，并刷新现状。
// waitingSince 是「等待起点」，面板据此显示「已等多久」——waitingUntil（截止时刻）
// 只能反推剩余，反推不出起点（超时值可被改写），所以两者都存。
// 全局主题是任务源不是等待源，永不置等待态（no-op）。
export async function setWaiting(key, cwd, summary, waiting, deadline) {
  if (isGlobalKey(key)) return;
  const store = await loadStore();
  const t = topicOf(store, key, cwd);
  t.waiting = !!waiting;
  t.waitingUntil = waiting && deadline ? stampNow(deadline) : '';
  // **毫秒精度的截止时刻**（epoch ms）。waitingUntil 那串是给人看的、只有秒级精度，
  // 而 stampNow 是「截断」不是「四舍五入」——短时限（秒级）时截断误差能吃掉整个窗口：
  // wait 若恰好在某秒最后 40ms 启动，真实 deadline 是 S+1.97s，存成 "S+1" 解析回来
  // 就是 S+1.000，比 now 还早 → 被判成「没在等」→ 事件流永远推不出 waiting。
  // 判据一律走 deadlineMsOf()：优先读这个精确值，老数据才回退解析字符串。
  t.waitingUntilMs = waiting && deadline ? deadline.getTime() : 0;
  t.waitingSince = waiting ? stampNow() : '';
  // 新一轮等待不继承上一轮残留的「关闭」请求，否则刚进来就被立刻收尾
  t.cancelRequested = false;
  if (summary) t.summary = summary;
  t.updatedAt = stampNow();
  await saveStore(store);
}

// wait 结束复位：**仅当主题仍存在**时清等待态，绝不重建——主题可能已被 force 删除，
// 重建会让「删除主题」失效（曾在超时清理路径上把删掉的主题又建回来）。
export async function clearWaiting(key) {
  if (isGlobalKey(key)) return;
  const store = await loadStore();
  const t = store.topics[key];
  if (!t) return;
  t.waiting = false;
  t.waitingUntil = '';
  t.waitingUntilMs = 0;
  t.waitingSince = '';
  t.cancelRequested = false;
  t.updatedAt = stampNow();
  await saveStore(store);
}

/**
 * 用户在面板点「关闭」：关掉某主题的等待，让**阻塞中的 wait 立即收尾**。
 *
 * 只翻 store 里的 cancelRequested 标记——wait 端每 0.5s 轮询到就结束本轮（返回
 * status:"timeout" + cancelled:true，与超时同一条出口，agent 照常收尾）。
 * **不删主题、不删任务、不动队列**：等待可以取消，历史照留。
 *
 * @returns {{cancelled:boolean,key:string,name:string,cwd:string,reason?:string}}
 */
export async function cancelWait({ cwd: rawCwd, key: rawKey } = {}) {
  if (!rawKey && !rawCwd) {
    const { badInput } = await import('../../core/errors.js');
    throw badInput('需要 --cwd "<工作目录>" 或 --key "<主题key>"');
  }
  const key = resolveTopicKey({ key: rawKey, cwd: rawCwd });
  // 全局主题不是等待源（永不 waiting），无从关闭
  if (isGlobalKey(key)) {
    return { cancelled: false, key, name: GLOBAL_NAME, cwd: '', reason: 'global_not_waitable' };
  }
  const store = await loadStore();
  const t = store.topics[key];
  if (!t || !isLiveWaiting(t)) {
    return { cancelled: false, key, name: (t && t.name) || '', cwd: (t && t.cwd) || '', reason: 'not_waiting' };
  }
  t.cancelRequested = true;
  t.updatedAt = stampNow();
  await saveStore(store);
  return { cancelled: true, key, name: t.name, cwd: t.cwd };
}

// wait 端轮询：该主题是否被请求关闭；取到即清标记（只生效一次）。
export async function consumeCancelRequest(key) {
  const store = await loadStore();
  const t = store.topics[key];
  if (!t || !t.cancelRequested) return false;
  t.cancelRequested = false;
  t.updatedAt = stampNow();
  await saveStore(store);
  return true;
}
