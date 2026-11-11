// 共享任务行（#164）：group 面板与 dir 任务页统一的「一行任务」。
//
// 以组面板的行结构为准：拖把 →（多选框）→ #id →（项目 tag）→ 标题 →
// 时间目标 / 闸门 / 锁定 →（创建/领取时间）→ 状态药丸 →（行尾操作）。
// 状态一律走 StatusTag（#121 全应用唯一口径：蓝=进行中 / 绿=已交付 /
// 浅灰=待领取 / 灰虚线=收口）——组页旧「已领取一律蓝」、dir 页单字徽标
// （等/跑/完/档）都收口到这一个组件。
//
// 整行可点开任务（div role=button，键盘可达）；行内多选框 / 操作按钮
// stopPropagation，点它们不触发开任务。拖拽视觉类复用 rp-proj-row
// 的 dragging / drop-before / drop-after（styles-v2/dag.css）。
import type { DragEvent as ReactDragEvent, ReactNode } from 'react';
import { Icon } from '../icons.jsx';
import StatusTag from '../status-tag/index.jsx';
import { taskLabel } from '../sidebar/model.js';
import type { LocalTask } from '../../types.js';

/**
 * 行级拖拽处理器（HTML5 DnD）。
 *
 * 事件泛型取 `HTMLElement`：同一个处理器会同时挂到行容器（div）与把手（span）上，
 * 取公共父类型两边都收。
 */
export interface TaskRowDragHandlers {
  onDragStart?: (e: ReactDragEvent<HTMLElement>) => void;
  onDragOver?: (e: ReactDragEvent<HTMLElement>) => void;
  onDragLeave?: (e: ReactDragEvent<HTMLElement>) => void;
  onDrop?: (e: ReactDragEvent<HTMLElement>) => void;
  onDragEnd?: (e: ReactDragEvent<HTMLElement>) => void;
}

/** 拖拽视觉态（只影响 class，不参与落盘）。 */
export interface TaskRowDragVisual {
  dragging?: boolean;
  /** `before` / `after`；保持 string 是为了兼容调用方自己的落点枚举。 */
  drop?: string | null;
}

export interface TaskRowProps {
  /** 任务行（id/text/status/timegoal/blocksFollowing/ready/blockBy/consumedAt/createdAt…） */
  t: LocalTask;
  /** 归属项目名（组面板用；目录页不传） */
  projectTag?: string;
  /** 项目 tag 的悬浮提示（缺省用 projectTag） */
  projectTitle?: string;
  /** 行首多选框（批量操作） */
  selectable?: boolean;
  /** 当前是否已选中 */
  picked?: boolean;
  /** (id) => void */
  onTogglePick?: (id: number | string) => void;
  /** 显示可用的拖动排序把手 */
  draggable?: boolean;
  /** { onDragStart,onDragOver,onDragLeave,onDrop,onDragEnd } */
  dragHandlers?: TaskRowDragHandlers | null;
  /** { dragging:boolean, drop:null|'before'|'after' } */
  dragVisual?: TaskRowDragVisual | null;
  /** 点击行（开任务） */
  onOpen?: (row: LocalTask) => void;
  /** 行内显示 创建→领取 时间（目录页） */
  showTimes?: boolean;
  /** 闸门挡住的下游任务 id（tooltip 展示） */
  downs?: Array<number | string>;
  /** 历史行（弱化透明度；状态药丸显示真实状态） */
  history?: boolean;
  /** 行尾操作（菜单 / 反馈 / 删除；容器已 stopPropagation） */
  ops?: ReactNode;
}

/** 短时间戳：MM-DD HH:MM（放不下原样截 16 字）。 */
export function shortTime(v: unknown): string {
  const s = String(v || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  // 两个捕获组由正则固定给出，但 noUncheckedIndexedAccess 下仍是 T | undefined
  const day = m?.[1];
  const time = m?.[2];
  return day && time ? `${day.slice(5)} ${time}` : s.slice(0, 16);
}

/**
 * 一行任务。
 * @param {object} props
 * @param {object} props.t 任务行（id/text/status/timegoal/blocksFollowing/ready/blockBy/consumedAt/createdAt…）
 * @param {string} [props.projectTag] 归属项目名（组面板用；目录页不传）
 * @param {string} [props.projectTitle] 项目 tag 的悬浮提示（缺省用 projectTag）
 * @param {boolean} [props.selectable] 行首多选框（批量操作）
 * @param {boolean} [props.picked] 当前是否已选中
 * @param {Function} [props.onTogglePick] (id) => void
 * @param {boolean} [props.draggable] 显示可用的拖动排序把手
 * @param {object|null} [props.dragHandlers] { onDragStart,onDragOver,onDragLeave,onDrop,onDragEnd }
 * @param {object} [props.dragVisual] { dragging:boolean, drop:null|'before'|'after' }
 * @param {Function} [props.onOpen] 点击行（开任务）
 * @param {boolean} [props.showTimes] 行内显示 创建→领取 时间（目录页）
 * @param {Array} [props.downs] 闸门挡住的下游任务 id（tooltip 展示）
 * @param {boolean} [props.history] 历史行（弱化透明度；状态药丸显示真实状态）
 * @param {React.ReactNode} [props.ops] 行尾操作（菜单 / 反馈 / 删除；容器已 stopPropagation）
 */
export default function TaskRow({
  t,
  projectTag = '',
  projectTitle = '',
  selectable = false,
  picked = false,
  onTogglePick,
  draggable = false,
  dragHandlers = null,
  dragVisual,
  onOpen,
  showTimes = false,
  downs = [],
  history = false,
  ops = null,
}: TaskRowProps) {
  const rowCls =
    'rp-proj-row'
    + (dragVisual?.dragging ? ' dragging' : '')
    + (dragVisual?.drop ? ' drop-' + dragVisual.drop : '');
  const locked = t.status === 'pending' && t.ready === false;
  return (
    <div
      className={rowCls}
      {...(dragHandlers
        ? {
            onDragOver: dragHandlers.onDragOver,
            onDragLeave: dragHandlers.onDragLeave,
            onDrop: dragHandlers.onDrop,
          }
        : {})}
    >
      {draggable ? (
        <span
          className="rp-drag-handle"
          draggable
          title="拖动调整队列内顺序"
          aria-label="拖动排序"
          onDragStart={dragHandlers?.onDragStart}
          onDragEnd={dragHandlers?.onDragEnd}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="grip" size={12} />
        </span>
      ) : (
        <span className="rp-drag-handle off" aria-hidden="true" />
      )}
      {selectable ? (
        <span
          className="rp-proj-pick"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={picked}
            onChange={() => onTogglePick?.(t.id)}
            aria-label={`选择任务 #${t.id}`}
          />
        </span>
      ) : null}
      <div
        className={'rp-proj-task' + (history ? ' done' : '')}
        role="button"
        tabIndex={0}
        title="打开这条任务"
        onClick={() => onOpen?.(t)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen?.(t);
          }
        }}
      >
        <span className="mono">#{t.id}</span>
        {projectTag ? (
          <span className="rp-ptag" title={`归属项目：${projectTitle || projectTag}`}>
            {projectTag}
          </span>
        ) : null}
        <span className="rp-proj-task-tx">{taskLabel(t)}</span>
        {t.timegoal && (
          <span
            className="rp-proj-goal"
            title={`时间目标 ${t.timegoal.duration}：领取即计时，未到点不许标完成`}
          >
            <Icon name="clock" size={11} /> {t.timegoal.duration}
          </span>
        )}
        {t.blocksFollowing && (
          <span
            className="rp-tgate"
            title={
              downs.length
                ? `闸门：未完成前挡住 ${downs.length} 个后续任务（#${downs.join(', #')}）`
                : '闸门：未完成前挡住队列里排在后面的待领取任务'
            }
          >
            闸门{downs.length ? `×${downs.length}` : ''}
          </span>
        )}
        {locked && (
          <span
            className="rp-tlock"
            title={t.blockBy?.length ? `等待依赖完成：#${t.blockBy.join(', #')}` : '被前方闸门挡住'}
          >
            锁定
          </span>
        )}
        {showTimes && (
          <span
            className="rp-proj-times mono"
            title={`创建 ${t.createdAt || '—'}${t.consumedAt ? ` · 领取 ${t.consumedAt}` : ''}`}
          >
            {shortTime(t.createdAt)}
            {t.consumedAt ? ` → ${shortTime(t.consumedAt)}` : ''}
          </span>
        )}
        {/* 状态药丸：历史行也显示真实状态（已交付/已作废不再被吞成「已领取」） */}
        <StatusTag t={t} />
        {ops ? (
          <span className="rp-proj-ops" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {ops}
          </span>
        ) : null}
      </div>
    </div>
  );
}
