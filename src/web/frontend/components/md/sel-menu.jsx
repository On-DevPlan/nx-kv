/**
 * 划选浮层：格式条 + 「评论 / 复制」。
 *
 * #104：原先这里还带一套「撰写中」形态（浮层里直接展开一个 textarea 写评论
 * 或反馈）——用户口径是「评论和反馈不该是输入框弹窗，要新开一个 md 编辑
 * 页面」，所以撰写态整体移走（见 components/md/composer-panel.jsx）。这里只
 * 留**动作条**：格式按钮 / 复制 / 评论（点评论 → 打开那块 md 编辑面板）。
 */

const FMT = [
  { op: 'bold', label: 'B', title: '粗体', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体', cls: 'i' },
  { op: 'code', label: '</>', title: '代码', cls: 'code' },
  { op: 'link', label: '链', title: '链接', cls: 'link' },
];

export default function SelMenu({
  at,
  onFormat,
  onCopy,
  onCompose,
  onDelete,
}) {
  if (!at) return null;
  const kind = at.kind || 'task';
  const showFmt = kind === 'format' || kind === 'both';

  return (
    <div
      id="mdw-sel-menu"
      className={`mdw-sel-menu open kind-${kind}`}
      style={{ left: at.x, top: at.y }}
      role="menu"
      onMouseDown={(e) => {
        if (e.target.closest?.('textarea, input, button')) return;
        e.preventDefault();
      }}
    >
      {showFmt ? (
        <div className="mdw-sel-fmt" role="group" aria-label="选区格式">
          {FMT.map((f) => (
            <button
              key={f.op}
              type="button"
              className={`mdw-sel-fmt-btn ${f.cls}`}
              title={f.title}
              onClick={() => onFormat?.(f.op)}
            >
              {f.label}
            </button>
          ))}
          <span className="mdw-sel-sep" aria-hidden />
          <button type="button" className="mdw-sel-fmt-btn" title="复制" onClick={onCopy}>
            复制
          </button>
          <span className="mdw-sel-sep" aria-hidden />
          <button
            type="button"
            className="mdw-sel-fmt-btn comment"
            title="评论 → 打开 md 编辑面板"
            onClick={() => onCompose?.()}
          >
            评论
          </button>
        </div>
      ) : (
        <>
          <div className="cap">选区</div>
          <button type="button" onClick={() => onCompose?.()}>
            评论
          </button>
          <div className="sep" />
          <button type="button" onClick={onCopy}>复制选区</button>
          {/* 跨块选区才有「删除选区」（#124）：块粒度整段移除；单块选区维持
              原菜单（字符级删除走 Backspace，#98），不给误删整块的机会 */}
          {onDelete ? (
            <>
              <div className="sep" />
              <button type="button" className="danger" title="删除选区触到的整段块" onClick={onDelete}>
                删除选区
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
