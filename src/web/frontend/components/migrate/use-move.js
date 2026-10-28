// 任务迁移（本机队列 ⇄ 云端清单）的发起与执行。
//
// 迁移的语义在设计稿 plan/uiux-redesign.html §5：
//   发起 → 确认（源→目标映射 + 同内容消歧）→ 执行 → 回执（可撤销）
// 这里只管「发起」和「执行」——确认框在 migrate/dialog.jsx，撤销在 migrate/undo.jsx。
import { useState } from 'react';
import { api } from '../../api/client.js';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';

/**
 * @param {object} p
 * @param {string}  p.dirName      当前目录名（迁到云端时的 topic）
 * @param {string}  p.cwd          本机目录（迁回本机时用）
 * @param {boolean} p.isGlobal     当前视图是不是全局池
 * @param {object}  p.cloud        云端数据（算同内容用）
 * @param {boolean} p.loggedIn     云端是否登录
 * @param {Array}   p.pending      本机待领取列表（批量迁移用）
 * @param {Function} p.toast
 * @param {Function} p.refreshAll  执行完成后刷新两侧
 * @param {Function} p.undo        撤销入口（来自 migrate/undo.jsx 的 useUndo）
 */
export function useDirMove({ dirName, cwd, isGlobal, cloud, loggedIn, pending, toast, refreshAll, undo }) {
  const [moveDlg, setMoveDlg] = useState(null);   // {move, dups, onConfirm}
  const [flashId, setFlashId] = useState('');     // 迁出后高亮目标
  const [failId, setFailId] = useState('');       // 失败红闪

  const markFail = (id) => { setFailId(id); setTimeout(() => setFailId(''), 1900); };

  // 执行一次迁移：POST /api/task/move → 给回执（含撤销参数）→ 刷新两侧
  const doMove = async (params) => {
    const r = await api('/api/task/move', { method: 'POST', body: params });
    undo({
      label:
        r.from === 'local'
          ? `已迁到云端「${r.topic}」${r.merged ? '（合并）' : `#${r.targetId}`}`
          : `已迁到本机「${r.dirName}」#${r.targetId}`,
      undoParams: {
        from: r.from, to: r.to, 'target-id': r.targetId, merged: !!r.merged,
        id: r.tombstoneId || undefined, cwd: isGlobal ? undefined : cwd,
        key: isGlobal ? GLOBAL_KEY : undefined, topic: r.topic, text: r.text,
      },
    });
    refreshAll();
    return r;
  };

  // 卡片菜单发起：先算目标端同内容，弹确认框
  const startMove = (side, item) => {
    if (side === 'local' && !loggedIn) { toast('云端清单需登录，迁移入口不可用'); return; }
    const text = item.text;
    const cloudTopic = side === 'local' ? dirName : item.topic;
    const dups =
      side === 'local'
        ? (cloud?.items?.open || []).filter((t) => t.text === text && t.topic === cloudTopic)
        : [];
    setMoveDlg({
      move: { from: side, to: side === 'local' ? 'cloud' : 'local', dirName, topic: cloudTopic, text },
      dups,
      onConfirm: ({ merge }) => doMove({
        from: side, to: side === 'local' ? 'cloud' : 'local',
        ...(side === 'local'
          ? { cwd: isGlobal ? undefined : cwd, key: isGlobal ? GLOBAL_KEY : undefined, id: item.id, ...(merge ? { merge: true } : {}) }
          : { topic: item.topic, text: item.text, cwd: isGlobal ? undefined : cwd, key: isGlobal ? GLOBAL_KEY : undefined }),
      }),
    });
  };

  // 批量迁移：把本机待领取整列迁到云端（逐条，失败不中断，最后汇总）
  const batchToCloud = () => {
    if (!loggedIn) { toast('云端清单需登录，迁移入口不可用'); return; }
    const list = pending || [];
    if (!list.length) { toast('待领取列为空'); return; }
    let done = 0; const errs = [];
    (async () => {
      for (const t of list) {
        try {
          await doMove({ from: 'local', to: 'cloud', cwd: isGlobal ? undefined : cwd, key: isGlobal ? GLOBAL_KEY : undefined, id: t.id });
          done++;
        } catch (e) { errs.push(`#${t.id} ${e.message || e}`); }
      }
      toast(`批量迁移完成 ${done}/${list.length}${errs.length ? '，失败 ' + errs.length + ' 条' : ''}`);
    })();
  };

  return { moveDlg, setMoveDlg, flashId, setFlashId, failId, markFail, doMove, startMove, batchToCloud };
}
