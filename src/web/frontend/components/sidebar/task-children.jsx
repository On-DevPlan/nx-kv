// 当前目录下展开的 MD 任务子行（对齐原型：目录挂 md）
import { Icon } from '../icons.jsx';
import { taskLabel } from './model.js';

export default function TaskChildren({ row, onNavigate, limit = 12 }) {
  const tasks = (row.tasks || []).slice(0, limit);
  if (!tasks.length) return null;
  return (
    <>
      {tasks.map((t) => (
        <button
          key={`${row.key}:t:${t.id}`}
          type="button"
          className="trow child task-child"
          title={String(t.text || '').slice(0, 200)}
          onClick={(e) => {
            e.stopPropagation();
            const base = row.type === 'global' ? '#/global' : `#/dir/${encodeURIComponent(row.key)}`;
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
    </>
  );
}
