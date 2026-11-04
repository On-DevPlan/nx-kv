// MD 工作台快捷键速查：专业编辑器的必备「键盘地图」。
// Ctrl/⌘ / 唤起（Notion 习惯），工具栏问号按钮也可打开；Esc / 点遮罩关闭。
// 外壳走 popup/Modal（全站统一模态），本文件只管快捷键内容。
import { Modal } from '../popup/index.jsx';

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
  return (
    <Modal title="快捷键" onClose={onClose} size="lg" className="mdw-sheet">
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
    </Modal>
  );
}
