// （#54 自 service.js 拆出）进程内 waiter 注册表：主题级（同 key 覆盖）+ 全局 FIFO
// （工作窃取兜底）。
//
// T03：领取标记（status/claimed_at/审计字段）随 repo.tasks.claimTask 写库；
// 本文件只剩**进程内**的 waiter 注册表（跨进程的等待态在 topic_presence 表）。
// 旧的 markConsumed 已删：它的调用点全部改走 claimTask（带守卫的单条 UPDATE，
// 并发领取不重复由此保证）。
// ─── 进程内 waiter：key -> { resolve(task), summary, by } ───────────────
//
// 注册表**留在 localtask**（addTask 的唤醒路径要认领它），但注册/取走以 API 导出——
// wait/get 的阻塞编排住在 tasktool/wait.js，通过这组 API 挂钩，不碰队列内部。

/** 主题级 waiter 条目（resolve 回调收 JSON 形态任务）。 */
export interface TopicWaiterEntry {
  resolve(task: any): void;
  summary?: string;
  by?: string | null;
  [k: string]: any;
}

const waiters = new Map<string, TopicWaiterEntry>();

/** wait/get 编排侧：登记「本目录有阻塞中的 waiter」（同 key 旧登记被覆盖）。 */
export function registerTopicWaiter(key: string, entry: TopicWaiterEntry): void {
  waiters.set(key, entry);
}

/** addTask 唤醒路径：取走该 key 的 waiter（取出即注销，保证一条任务只唤醒一个）。 */
export function takeTopicWaiter(key: string): TopicWaiterEntry | null {
  const w = waiters.get(key);
  if (w) waiters.delete(key);
  return w || null;
}

/** wait 收尾：摘掉自己的登记（超时/取消/完成都走这里）。 */
export function unregisterTopicWaiter(key: string): void {
  waiters.delete(key);
}

/** waiter 的领取方身份（wait 传入，领取后记进 claimedBy / claimedByName 审计）。 */
export interface WaiterBy {
  key?: string;
  name?: string;
  cwd?: string;
}

/** 全局兜底 waiter 条目（FIFO）。 */
export interface GlobalWaiterEntry {
  onTask: (task: any) => void;
  summary: string;
  by: WaiterBy | null;
  settled: boolean;
}

// 进程内「愿意从全局领任务」的等待者（FIFO）。任何本地主题的 wait 在本地空、
// 全局也空而阻塞时，除了挂进 waiters（等本目录回填），还挂到这里——
// 同进程 addTask({global:true}) 投递时按先来后到投给最早阻塞的 waiter。
const globalWaiters: GlobalWaiterEntry[] = [];

// 注册全局兜底 waiter；返回注销函数（wait 在拿到任务/超时/被关闭时都要调用，
// 否则已结束的 wait 还留在队列里占位）。summary 随注册固化——全局投递领取时
// 记进 task.roundSummary 的是「领取方 agent 当时的现状」，而非全局池自己的现状。
// by 随注册固化——领取后记进 task.claimedBy，事后能看出「这条是谁领的」。
export function registerGlobalWaiter(onTask: (task: any) => void, summary?: string, by?: WaiterBy | null): () => void {
  const entry: GlobalWaiterEntry = { onTask, summary: summary || '', by: by || null, settled: false };
  globalWaiters.push(entry);
  return () => {
    if (entry.settled) return;
    entry.settled = true;
    const i = globalWaiters.indexOf(entry);
    if (i >= 0) globalWaiters.splice(i, 1);
  };
}

// 弹出第一个未注销的 waiter（FIFO）；无人等返回 null。
// 取出即标记 settled，保证一条任务只唤醒一个 waiter。
export function takeGlobalWaiter(): GlobalWaiterEntry | null {
  while (globalWaiters.length) {
    const entry = globalWaiters.shift()!;
    if (!entry.settled) {
      entry.settled = true;
      return entry;
    }
  }
  return null;
}
