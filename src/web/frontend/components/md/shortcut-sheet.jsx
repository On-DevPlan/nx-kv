// MD 工作台快捷键速查：专业编辑器的必备「键盘地图」。
// Ctrl/⌘ / 唤起（Notion 习惯），工具栏问号按钮也可打开；Esc / 点遮罩关闭。
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const GROUPS = [
  {
    title: '格式',
    items: [
      ['Ctrl/⌘ B', '粗体'],
      ['Ctrl/⌘ I', '斜体'],
      ['Ctrl/⌘ E', '行内代码'],
      ['Ctrl/⌘ K', '链接'],
      ['1 – 6', '正文 / 标题 / 小标题 / 列表 / 待办 / 引用'],
    ],
  },
  {
    title: '编辑',
    items: [
      ['/', '行首唤起命令菜单'],
      ['Tab / ⇧Tab', '缩进 / 反缩进'],
      ['Enter', '新建块（列表自动续行）'],
      ['⇧Enter', '块内软换行'],
      ['Ctrl/⌘ Z', '撤销'],
      ['Ctrl/⌘ ⇧Z', '重做'],
    ],
  },
  {
    title: '导航与文件',
    items: [
      ['Ctrl/⌘ F', '查找（Enter 下一个，F3 继续）'],
      ['Ctrl/⌘ S', '保存并同步'],
      ['Ctrl/⌘ /', '打开 / 关闭本速查'],
      ['Enter（标题内）', '跳到正文'],
    ],
  },
];

export default function ShortcutSheet({ onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  return createPortal(
    <div
      className="mdw-sheet-back"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mdw-sheet" role="dialog" aria-modal="true" aria-label="快捷键速查" ref={ref}>
        <div className="mdw-sheet-head">
          <span className="mdw-sheet-title">快捷键</span>
          <button type="button" className="mdw-sheet-x" onClick={onClose} aria-label="关闭快捷键速查">
            ×
          </button>
        </div>
        <div className="mdw-sheet-cols">
          {GROUPS.map((g) => (
            <section key={g.title} className={g.title === '导航与文件' ? 'wide' : undefined}>
              <h4>{g.title}</h4>
              <dl>
                {g.items.map(([k, d]) => (
                  <div className="mdw-sheet-row" key={k}>
                    <dt><kbd>{k}</kbd></dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
