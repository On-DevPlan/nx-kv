// 仓库 → 任务队列的导航助手：「先建队列，再进工作台」。
//
// 侧边栏的仓库行以**仓库登记**为数据源，但工作台（#/dir/<key>）按**队列主题 key**
// 寻址——仓库还没有任务队列（topic）时两者对不上：直接跳会落「目录不存在」，
// 「新建页」也就无从谈起。这里补齐缺口：没有队列的仓库先
// POST /api/localtasks/topic 登记目录（幂等；manual 标记防 prune 清掉），
// 刷新本机队列数据后再跳——工作台按返回的 key 就找得到主题。
import { api } from '../../api/client.js';
import type { SideRow } from './model.js';

/** ensureQueueAndGo 入参。 */
export interface QueueNavOptions {
  /** 侧边栏行（repo / global；repo 需带 topicKey / cwd / name） */
  row: SideRow;
  /** hash 导航 */
  onNavigate?: (hash: string) => void;
  /** 本机队列数据刷新（建队列后必须刷，工作台才寻址得到） */
  refreshLocal?: () => Promise<void>;
  /** 提示 */
  toast?: (msg: string) => void;
}

/**
 * 确保仓库有任务队列，然后跳转到它的工作台。
 * @param {object} p
 * @param {object}   p.row            侧边栏行（repo / global；repo 需带 topicKey / cwd / name）
 * @param {Function} p.onNavigate     hash 导航
 * @param {Function} [p.refreshLocal] 本机队列数据刷新（建队列后必须刷，工作台才寻址得到）
 * @param {Function} [p.toast]        提示
 */
export async function ensureQueueKey({ row, refreshLocal, toast }: QueueNavOptions): Promise<string | null> {
  // 已有队列的仓库：直接用（#190 全局池行已删除）
  if (row.topicKey) return String(row.topicKey);
  // 没队列的仓库：先登记目录。登记仓库没有路径（不该发生）给提示后停。
  if (!row.cwd) {
    toast?.(`「${row.name}」没有目录路径，无法创建任务队列`);
    return null;
  }
  try {
    const res = await api('/api/localtasks/topic', { method: 'POST', body: { cwd: row.cwd } });
    await refreshLocal?.();
    if (res && res.existed === false) toast?.(`已为「${row.name}」创建任务队列`);
    return res && res.key ? String(res.key) : null;
  } catch (e) {
    // catch 变量是 unknown：只取 message（其余 String() 兜底）
    toast?.('创建任务队列失败: ' + ((e as Error).message || e));
    return null;
  }
}

/** 确保仓库有任务队列，然后跳转工作台。 */
export async function ensureQueueAndGo(opts: QueueNavOptions): Promise<void> {
  const key = await ensureQueueKey(opts);
  if (!key) return;
  opts.onNavigate?.(`#/dir/${encodeURIComponent(key)}`);
}
