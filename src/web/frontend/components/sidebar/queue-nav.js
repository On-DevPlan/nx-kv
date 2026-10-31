// 仓库 → 任务队列的导航助手：「先建队列，再进工作台」。
//
// 侧边栏的仓库行以**仓库登记**为数据源，但工作台（#/dir/<key>）按**队列主题 key**
// 寻址——仓库还没有任务队列（topic）时两者对不上：直接跳会落「目录不存在」，
// 「新建页」也就无从谈起。这里补齐缺口：没有队列的仓库先
// POST /api/localtasks/topic 登记目录（幂等；manual 标记防 prune 清掉），
// 刷新本机队列数据后再跳——工作台按返回的 key 就找得到主题。
import { api } from '../../api/client.js';

/**
 * 确保仓库有任务队列，然后跳转到它的工作台。
 * @param {object} p
 * @param {object}   p.row            侧边栏行（repo / global；repo 需带 topicKey / cwd / name）
 * @param {Function} p.onNavigate     hash 导航
 * @param {Function} [p.refreshLocal] 本机队列数据刷新（建队列后必须刷，工作台才寻址得到）
 * @param {Function} [p.toast]        提示
 * @param {boolean}  [p.draft]        true = 进去直接开新草稿页签（?task=draft）
 */
export async function ensureQueueAndGo({ row, onNavigate, refreshLocal, toast, draft = false }) {
  const withTask = (base) => (draft ? `${base}?task=draft` : base);
  // 全局池 / 已有队列的仓库：直接跳
  if (row.type === 'global' || row.topicKey) {
    const base = row.type === 'global' ? '#/global' : `#/dir/${encodeURIComponent(row.topicKey)}`;
    onNavigate(withTask(base));
    return;
  }
  // 没队列的仓库：先登记目录再进。登记仓库没有路径（不该发生）给提示后停。
  if (!row.cwd) {
    toast && toast(`「${row.name}」没有目录路径，无法创建任务队列`);
    return;
  }
  try {
    const res = await api('/api/localtasks/topic', { method: 'POST', body: { cwd: row.cwd } });
    await refreshLocal?.();
    if (res && res.existed === false) toast && toast(`已为「${row.name}」创建任务队列`);
    onNavigate(withTask(`#/dir/${encodeURIComponent(res.key)}`));
  } catch (e) {
    toast && toast('创建任务队列失败: ' + (e.message || e));
  }
}
