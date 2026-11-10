// 编辑器查找条：实时预览（块级匹配）与源码（全文匹配）共用的 UI。
export function EditorFindBar({ query, setQuery, index, total, onNext, onPrev, onClose, inputRef }) {
  return (
    <div className="mdw-find" role="search">
      <input
        ref={inputRef}
        className="mdw-find-input"
        value={query}
        placeholder="查找…"
        aria-label="查找"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === 'F3') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
      />
      <span className="mdw-find-count">
        {total ? `${index + 1}/${total}` : '无结果'}
      </span>
      <button type="button" className="mdw-find-nav" title="上一个" aria-label="上一个匹配" onClick={onPrev}>↑</button>
      <button type="button" className="mdw-find-nav" title="下一个" aria-label="下一个匹配" onClick={onNext}>↓</button>
      <button type="button" className="mdw-find-nav" title="关闭" aria-label="关闭查找" onClick={onClose}>×</button>
    </div>
  );
}
