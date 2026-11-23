// 当前仓库下展开的 MD 页面子行（对齐原型：仓库挂 md）。
// 仓库点击 = 展开/收起这组子行；点具体子行才进工作台全屏编辑。
// 末尾恒置「＋ 新建页」：空仓库展开也有落点，新页以新页签打开。
//
// 任务来自**任务队列**（topic）：一个仓库路径下可能有多个队列主题，
// 它们的未删除任务汇总成一组子行。
// 仓库还没有队列时只剩「＋ 新建页」一个子行——点它先建队列再进工作台（queue-nav.js）。
//
// 显示序：**未完成（待领取）优先**（sortTasksForDisplay——追加序会把新任务
// 埋在历史底下）；长度：**不分页**——#181 去掉翻页控件后是全量铺开，但队列一长
// （实测 68 条）侧栏就被任务子行灌满，树形导航彻底失效。
// #188 用户口径：默认铺 8 条，尾部「…还有 N 条」**点一次只多加载 10 条**（继续点继续加载），
// 不再一次铺开全部——队列很长时一次全展开照样把侧栏灌满。
// 另有「收起」把窗口还原到 8 条。
import { useMemo, useState } from 'react';
import { Icon } from '../icons.jsx';
import { useToast } from '../toast/index.jsx';
import { taskLabel } from './model.js';
import type { SideRow } from './model.js';
import { ensureQueueAndGo } from './queue-nav.js';
import { statusTone, statusShort } from '../status-tag/model.js';
import { sortTasksForDisplay, isGroupTask } from '../../modules/board/board-view.js';
import type { LocalTask } from '../../types.js';

// 任务行的单字状态徽标（侧栏太窄，只放一个字）：等=待领取 / 跑=进行中 / 完=已完成 / 档=收口。
// 文案与配色的映射走 components/status-tag/model.js（#121 全应用唯一口径：
// 等=浅灰、跑=蓝 --doing、完=绿 --live；t.from 只是来源标记，不参与状态判断）。

// 兄弟模块类型桥：board-view 尚未类型化（`tasks = []` 默认值把形参推成 never[]），
// 这里按实际契约声明一次——它毕业成强类型后此桥退化为恒等。
const sortTasksForDisplayBridge = sortTasksForDisplay as unknown as (tasks: LocalTask[]) => LocalTask[];

/** 侧栏默认铺开的任务子行条数。 */
const SIDE_TASK_LIMIT = 8;
/** #188：点「…还有 N 条」时每次多加载几条。 */
const SIDE_TASK_STEP = 10;

/** TaskChildren 入参。 */
export interface TaskChildrenProps {
  row: SideRow;
  onNavigate?: (hash: string) => void;
  refreshLocal?: () => Promise<void>;
}

export default function TaskChildren({ row, onNavigate, refreshLocal }: TaskChildrenProps) {
  const toast = useToast();
  // 全局池：topic 直接带 tasks；仓库行：多个 topic 的 tasks 汇总；
  // 组行：model 已按「本组任务」口径（frontmatter.board）算好，直接铺
  const tasks = useMemo(() => {
    const list: LocalTask[] =
      row.type === 'global'
        ? (row.tasks || [])
        : row.type === 'board'
          ? (row.tasks || [])
          // #85 两种走向：仓库行下的子任务是**项目走向**的入口——组任务归组页管
          : (row.topics || []).flatMap((t) => (t.tasks || []).filter((x) => !x.deletedAt && !isGroupTask(x)));
    return sortTasksForDisplayBridge(list);
  }, [row]);
  // 导航基址：组 = 组页（#/group/<id>，任务详情带 ?task=）；仓库/全局 = 工作台，
  // 后者用 **topicKey**（工作台按它找队列），不是仓库 key
  const isBoard = row.type === 'board';
  const base = isBoard
    ? `#/group/${encodeURIComponent(String(row.id || row.key))}`
    : row.type === 'global'
      ? '#/global'
      : `#/dir/${encodeURIComponent(row.topicKey || row.key)}`;
  // #188：默认铺 8 条；「…还有 N 条」点一次多加载 10 条（分页式增量，不一次全铺）。
  const [limit, setLimit] = useState(SIDE_TASK_LIMIT);
  const shown = tasks.slice(0, limit);
  const rest = tasks.length - shown.length;
  return (
    <>
      {shown.map((t) => (
        <button
          key={`${row.topicKey || row.key}:t:${t.id}`}
          type="button"
          className="trow child task-child"
          title={String(t.text || '').slice(0, 200)}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate?.(`${base}?task=${encodeURIComponent(String(t.id))}`);
          }}
        >
          {/* #106：这里原本是统一的 list 图标——子行按类型只有 task 一种，图标没有
              信息量；换成任务编号（序列号）能一眼看出队列规模与位置。 */}
          <span className="gico num" aria-hidden="true">#{t.id}</span>
          <span className="nm">{taskLabel(t)}</span>
          <span className={`cnt ${statusTone(t)}`}>
            {statusShort(t)}
          </span>
        </button>
      ))}
      {/* 「…还有 N 条」：点一次只多加载 10 条（#188），不一次铺开全部 */}
      {rest > 0 && (
        <button
          type="button"
          className="trow child task-more"
          title={`还有 ${rest} 条任务没铺开——点一次多加载 ${Math.min(SIDE_TASK_STEP, rest)} 条`}
          onClick={(e) => {
            e.stopPropagation();
            setLimit((n) => n + SIDE_TASK_STEP);
          }}
        >
          <span className="gico"><Icon name="dots" size={12} /></span>
          <span className="nm">…还有 {rest} 条</span>
        </button>
      )}
      {limit > SIDE_TASK_LIMIT && (
        <button
          type="button"
          className="trow child task-more"
          title="收起，只留前几条"
          onClick={(e) => {
            e.stopPropagation();
            setLimit(SIDE_TASK_LIMIT);
          }}
        >
          <span className="gico"><Icon name="chevron" size={12} /></span>
          <span className="nm">收起</span>
        </button>
      )}
      {isBoard ? (
        // 组任务必须带 board + 归属项目两个 frontmatter，侧栏无从选择——
        // 入口给到组页（那里「＋ 新建页」会预置本组语义），不在这里造假草稿。
        <button
          type="button"
          className="trow child task-new"
          title="到组页新建任务（需要选归属项目）"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate?.(base);
          }}
        >
          <span className="gico"><Icon name="plus" size={12} /></span>
          <span className="nm">新建任务</span>
        </button>
      ) : (
        <button
          type="button"
          className="trow child task-new"
          title="新建一页 MD（新页签打开；仓库还没有任务队列时先创建队列）"
          onClick={(e) => {
            e.stopPropagation();
            ensureQueueAndGo({ row, onNavigate, refreshLocal, toast, draft: true });
          }}
        >
          <span className="gico"><Icon name="plus" size={12} /></span>
          <span className="nm">新建页</span>
        </button>
      )}
    </>
  );
}
