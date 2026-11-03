/** 划选浮层：格式条（源码/live 编辑）与划线评论（任意选区） */
import { useEffect, useRef, useState } from 'react';

const FMT = [
  { op: 'bold', label: 'B', title: '粗体', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体', cls: 'i' },
  { op: 'code', label: '</>', title: '代码', cls: 'code' },
  { op: 'link', label: '链', title: '链接', cls: 'link' },
];

export default function SelMenu({
  at,
  onFormat,
  onComment,
  onCopy,
  onCompose,
  onClose,
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const taRef = useRef(null);

  useEffect(() => {
    setComposing(!!at?.comment);
    setDraft('');
  }, [at?.text, at?.x, at?.y, at?.comment]);

  useEffect(() => {
    if (!composing) return undefined;
    const id = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [composing]);

  if (!at) return null;
  const kind = at.kind || 'task';
  const showFmt = kind === 'format' || kind === 'both';
  const quote = String(at.text || '');
  const quoteShort = quote.length > 72 ? `${quote.slice(0, 72)}…` : quote;
  // 重做模式：针对整条任务（不锚定选区），没有引文可显示
  const isRedo = at.mode === 'redo';
  const cap = isRedo ? '重做：写下要改的地方' : '划线评论';

  const startCompose = () => {
    setComposing(true);
    onCompose?.(); // 父级打上 comment:true，避免选区塌缩时关掉浮层
  };

  const cancelCompose = () => {
    setComposing(false);
    setDraft('');
    onClose?.(); // 取消直接收起：选区已塌，格式条也没用了
  };

  const submit = () => {
    const q = draft.trim();
    if (!q) return;
    onComment?.(q);
  };

  return (
    <div
      id="mdw-sel-menu"
      className={`mdw-sel-menu open kind-${composing ? 'comment' : kind}`}
      style={{ left: at.x, top: at.y }}
      role="menu"
      onMouseDown={(e) => {
        // 保划选：点按钮不丢选区；输入框要能聚焦，不能 preventDefault
        if (e.target.closest?.('textarea, input')) return;
        e.preventDefault();
      }}
    >
      {composing ? (
        <div className="mdw-sel-comment">
          <div className="mdw-sel-comment-cap">{cap}</div>
          {quote ? (
            <div className="mdw-sel-quote" title={quote}>{quoteShort}</div>
          ) : null}
          <textarea
            ref={taRef}
            className="mdw-sel-comment-ta"
            rows={3}
            value={draft}
            placeholder={isRedo ? '写下要改的地方…' : '对此处提出问题…'}
            aria-label="评论文本"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelCompose();
                return;
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="mdw-sel-comment-acts">
            <button type="button" className="ghost" onClick={cancelCompose}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={!draft.trim()}
              onClick={submit}
            >
              {isRedo ? '重开此任务' : '提交为任务'}
            </button>
          </div>
          <div className="mdw-sel-comment-hint">Ctrl/⌘+Enter 提交</div>
        </div>
      ) : (
        <>
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
                title="划线评论 → 新任务"
                onClick={startCompose}
              >
                评论
              </button>
            </div>
          ) : (
            <>
              <div className="cap">选区</div>
              <button type="button" onClick={startCompose}>
                评论
              </button>
              <div className="sep" />
              <button type="button" onClick={onCopy}>复制选区</button>
            </>
          )}
        </>
      )}
    </div>
  );
}
