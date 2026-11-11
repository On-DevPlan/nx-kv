// 当前仓库下展开的 MD 页面子行（对齐原型：仓库挂 md）。
// 仓库点击 = 展开/收起这组子行；点具体子行才进工作台全屏编辑。
// 末尾恒置「＋ 新建页」：空仓库展开也有落点，新页以新页签打开。
//
// 任务来自**任务队列**（topic）：一个仓库路径下可能有多个队列主题，
// 它们的未删除任务汇总成一组子行。
// 仓库还没有队列时只剩「＋ 新建页」一个子行——点它先建队列再进工作台（queue-nav.js）。
//
// 显示序：**未完成（待领取）优先**（sortTasksForDisplay——追加序会把新任务
// 埋在历史底下）；长度：分页而不是硬截断（以前 limit=12 静默丢弃第 13 条起，
// 用户既看不到也够不着）。
import { useMemo } from 'react';
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
import Pager, { usePager } from '../pager.jsx';

const PAGE_SIZE = 12; // 每页条数（与旧 limit 同值，但不再截断——有翻页出口）

// 兄弟模块类型桥：board-view 尚未类型化（`tasks = []` 默认值把形参推成 never[]），
// 这里按实际契约声明一次——它毕业成强类型后此桥退化为恒等。
const sortTasksForDisplayBridge = sortTasksForDisplay as unknown as (tasks: LocalTask[]) => LocalTask[];

/** TaskChildren 入参。 */
export interface TaskChildrenProps {
  row: SideRow;
  onNavigate?: (hash: string) => void;
  refreshLocal?: () => Promise<void>;
  limit?: number;
}

export default function TaskChildren({ row, onNavigate, refreshLocal, limit = PAGE_SIZE }: TaskChildrenProps) {
  const toast = useToast();
  // 全局池：topic 直接带 tasks；仓库行：多个 topic 的 tasks 汇总
  const tasks = useMemo(() => {
    const list: LocalTask[] =
      row.type === 'global'
        ? (row.tasks || [])
        // #85 两种走向：仓库行下的子任务是**项目走向**的入口——组任务归组页管
        : (row.topics || []).flatMap((t) => (t.tasks || []).filter((x) => !x.deletedAt && !isGroupTask(x)));
    return sortTasksForDisplayBridge(list);
  }, [row]);
  const pager = usePager(tasks, limit);
  const shown = pager.items;
  // 导航基址用 **topicKey**（工作台按它找队列），不是仓库 key
  const base = row.type === 'global'
    ? '#/global'
    : `#/dir/${encodeURIComponent(row.topicKey || row.key)}`;
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
          <span className="gico"><Icon name="list" size={12} /></span>
          <span className="nm">{taskLabel(t)}</span>
          <span className={`cnt ${statusTone(t)}`}>
            {statusShort(t)}
          </span>
        </button>
      ))}
      {pager.pageCount > 1 && (
        <div className="trow child task-pager">
          <Pager
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            onPage={pager.setPage}
            unit="条任务"
          />
        </div>
      )}
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
    </>
  );
}
