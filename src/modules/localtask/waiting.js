// （#54 自 service.js 拆出）等待态生命周期：setWaiting（含毫秒精度截止时刻）/
// clearWaiting（绝不重建已删主题）/ 用户点「关闭等待」（cancelWait，只翻标记）/
// wait 端取消标记消费（consumeCancelRequest）。
//
// T03：等待态进 topic_presence 表（schema P0-4 的落地）—— wait 进程被 SIGKILL 时
// finally 不会执行，waiting:true 会永久残留；独立成表后残留只污染这张小表，
// 整表清空即可，不会让队列本身看起来像有人在等。
import { isGlobalKey, GLOBAL_NAME, resolveTopicKey } from './paths.js';
import { openLocaltaskStore as openStore, presence as presenceRepo, topics as topicsRepo, txw as tx } from './repo/index.js';

// 在库里把某主题置为等待/结束，并刷新现状。
// waitingSince 是「等待起点」，面板据此显示「已等多久」——waitingUntil（截止时刻）
// 只能反推剩余，反推不出起点（超时值可被改写），所以两者都存。
// 全局主题是任务源不是等待源，永不置等待态（no-op）。
export async function setWaiting(key, cwd, summary, waiting, deadline) {
  if (isGlobalKey(key)) return;
  openStore();
  tx(() => {
    topicsRepo.ensureTopic(key, { cwd });
    presenceRepo.setPresence(key, {
      waiting: !!waiting,
      untilMs: waiting && deadline ? deadline.getTime() : 0,
      // waitingSince 是等待起点；面板「已等多久」从它算
      sinceMs: waiting ? Date.now() : 0,
      // 新一轮等待不继承上一轮残留的「关闭」请求，否则刚进来就被立刻收尾
      cancelRequested: false,
      summary: summary || undefined,
    });
  });
}

// wait 结束复位：**仅当主题仍存在**时清等待态，绝不重建——主题可能已被 force 删除，
// 重建会让「删除主题」失效（曾在超时清理路径上把删掉的主题又建回来）。
export async function clearWaiting(key) {
  if (isGlobalKey(key)) return;
  openStore();
  presenceRepo.clearPresence(key);
}

/**
 * 用户在面板点「关闭」：关掉某主题的等待，让**阻塞中的 wait 立即收尾**。
 *
 * 只翻 cancelRequested 标记——wait 端每 0.5s 轮询到就结束本轮（返回
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
  openStore();
  const t = topicsRepo.getTopic(key);
  // 「真的在等」的判定在 requestCancel 里（waiting=1 且截止未过）——僵尸标志不算
  const cancelled = presenceRepo.requestCancel(key);
  if (!cancelled) {
    return { cancelled: false, key, name: (t && t.name) || '', cwd: (t && t.cwd) || '', reason: 'not_waiting' };
  }
  return { cancelled: true, key, name: t ? t.name : '', cwd: t ? t.cwd : '' };
}

// wait 端轮询：该主题是否被请求关闭；取到即清标记（只生效一次）。
export async function consumeCancelRequest(key) {
  openStore();
  return presenceRepo.consumeCancelRequest(key);
}
