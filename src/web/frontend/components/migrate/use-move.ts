// 任务迁移（本机队列 ⇄ 云端清单）的发起与执行。
//
// 迁移的语义在设计稿 plan/uiux-redesign.html §5：
//   发起 → 确认（源→目标映射 + 同内容消歧）→ 执行 → 回执（可撤销）
// 这里只管「发起」和「执行」——确认框在 migrate/dialog.jsx，撤销在 migrate/undo.jsx。
import { useState } from 'react';
import { api } from '../../api/client.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import type { UndoInfo } from './undo.jsx';

/** 云端清单的一条（/api/todo 的 items.open[]；算同内容用）。 */
export interface CloudTask {
  id?: number | string;
  text?: string;
  topic?: string;
  [k: string]: any;
}

/** /api/todo 的出站形状（这里只读 items.open）。 */
export interface CloudData {
  items?: { open?: CloudTask[]; [k: string]: any };
  [k: string]: any;
}

/** 本机待领取条目（批量迁移用）。队列里的任务一定有正文，故 text 必填。 */
export interface PendingTask {
  id: number | string;
  text: string;
  topic?: string;
  [k: string]: any;
}

/** 待确认的一次迁移（弹窗的数据面）。 */
export interface MoveDraft {
  move: { from: string; to: string; dirName?: string; topic?: string; text: string };
  /** 目标端同内容条目 */
  dups: CloudTask[];
  onConfirm: (opts: { merge: boolean }) => Promise<unknown>;
}

export interface UseDirMoveParams {
  /** 当前目录名（迁到云端时的 topic） */
  dirName: string;
  /** 本机目录（迁回本机时用） */
  cwd?: string;
  /** 当前视图是不是全局池 */
  isGlobal: boolean;
  /** 云端数据（算同内容用） */
  cloud: CloudData | null;
  /** 云端是否登录 */
  loggedIn: boolean;
  /** 本机待领取列表（批量迁移用） */
  pending?: PendingTask[];
  toast: (msg: string) => void;
  /** 执行完成后刷新两侧 */
  refreshAll: () => void;
  /** 撤销入口（来自 migrate/undo.jsx 的 useUndo） */
  undo: (info: UndoInfo) => void;
}

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
export function useDirMove({ dirName, cwd, isGlobal, cloud, loggedIn, pending, toast, refreshAll, undo }: UseDirMoveParams) {
  const [moveDlg, setMoveDlg] = useState<MoveDraft | null>(null);   // {move, dups, onConfirm}
  const [flashId, setFlashId] = useState('');     // 迁出后高亮目标
  const [failId, setFailId] = useState('');       // 失败红闪

  const markFail = (id: string) => { setFailId(id); setTimeout(() => setFailId(''), 1900); };

  // 执行一次迁移：POST /api/task/move → 给回执（含撤销参数）→ 刷新两侧
  const doMove = async (params: Record<string, unknown>) => {
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
  const startMove = (side: 'local' | 'cloud', item: PendingTask) => {
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
    let done = 0; const errs: string[] = [];
    (async () => {
      for (const t of list) {
        try {
          await doMove({ from: 'local', to: 'cloud', cwd: isGlobal ? undefined : cwd, key: isGlobal ? GLOBAL_KEY : undefined, id: t.id });
          done++;
        } catch (e) { errs.push(`#${t.id} ${(e as Error).message || e}`); }
      }
      toast(`批量迁移完成 ${done}/${list.length}${errs.length ? '，失败 ' + errs.length + ' 条' : ''}`);
    })();
  };

  return { moveDlg, setMoveDlg, flashId, setFlashId, failId, markFail, doMove, startMove, batchToCloud };
}
