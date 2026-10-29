// 当前仓库下展开的 MD 页面子行（对齐原型：仓库挂 md）。
// 仓库点击 = 展开/收起这组子行；点具体子行才进工作台全屏编辑。
// 末尾恒置「＋ 新建页」：空仓库展开也有落点，新页以新页签打开。
//
// 任务来自**任务队列**（topic）：一个仓库路径下可能有多个队列主题，
// 它们的未删除任务汇总成一组子行。
import { Icon } from '../icons.jsx';
import { taskLabel } from './model.js';

export default function TaskChildren({ row, onNavigate, limit = 12 }) {
  // 全局池：topic 直接带 tasks；仓库行：多个 topic 的 tasks 汇总
  const tasks = row.type === 'global'
    ? (row.tasks || [])
    : (row.topics || []).flatMap((t) => (t.tasks || []).filter((x) => !x.deletedAt));
  const shown = tasks.slice(0, limit);
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
            onNavigate(`${base}?task=${encodeURIComponent(t.id)}`);
          }}
        >
          <span className="gico"><Icon name="list" size={12} /></span>
          <span className="nm">{taskLabel(t)}</span>
          <span className="cnt">
            {t.status === 'consumed' ? '完' : (t.from ? '跑' : '等')}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="trow child task-new"
        title="新建一页 MD（新页签打开）"
        onClick={(e) => {
          e.stopPropagation();
          onNavigate(`${base}?task=draft`);
        }}
      >
        <span className="gico"><Icon name="plus" size={12} /></span>
        <span className="nm">新建页</span>
      </button>
    </>
  );
}
