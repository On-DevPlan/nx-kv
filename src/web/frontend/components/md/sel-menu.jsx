/** 划选浮层：格式条（源码/live 编辑）与任务操作（阅读/live 阅读态）统一外壳 */

const FMT = [
  { op: 'bold', label: 'B', title: '粗体', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体', cls: 'i' },
  { op: 'code', label: '</>', title: '代码', cls: 'code' },
  { op: 'link', label: '链', title: '链接', cls: 'link' },
];

export default function SelMenu({
  at,
  onFormat,
  onIssue,
  onAppend,
  onCopy,
}) {
  if (!at) return null;
  const kind = at.kind || 'task';
  const showFmt = kind === 'format' || kind === 'both';
  const showTask = kind === 'task' || kind === 'both';

  return (
    <div
      id="mdw-sel-menu"
      className={`mdw-sel-menu open kind-${kind}`}
      style={{ left: at.x, top: at.y }}
      role="menu"
      onMouseDown={(e) => e.preventDefault()}
    >
      {showFmt && (
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
          {showTask && <span className="mdw-sel-sep" aria-hidden />}
          <button type="button" className="mdw-sel-fmt-btn" title="复制" onClick={onCopy}>
            复制
          </button>
        </div>
      )}
      {showTask && (
        <>
          {showFmt && <div className="sep" />}
          {!showFmt && <div className="cap">选区</div>}
          <button type="button" onClick={onIssue}>此区域有问题 → 新 MD</button>
          <button type="button" onClick={onAppend}>追加任务 MD</button>
          {!showFmt && (
            <>
              <div className="sep" />
              <button type="button" onClick={onCopy}>复制选区</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
