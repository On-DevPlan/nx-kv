// 当前目录下展开的 MD 页面子行（对齐原型：目录挂 md）。
// 目录点击 = 展开/收起这组子行；点具体子行才进工作台全屏编辑。
// 末尾恒置「＋ 新建页」：空目录展开也有落点，新页以新页签打开。
import { Icon } from '../icons.jsx';
import { taskLabel } from './model.js';

export default function TaskChildren({ row, onNavigate, limit = 12 }) {
  const tasks = (row.tasks || []).slice(0, limit);
  const base = row.type === 'global' ? '#/global' : `#/dir/${encodeURIComponent(row.key)}`;
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
