/** 划选浮层：格式条 + 统一「评论/反馈」组件（可粘贴/添加图片附件） */
import { useEffect, useRef, useState } from 'react';
import { filesToAttachments } from './attachments.js';

const FMT = [
  { op: 'bold', label: 'B', title: '粗体', cls: 'b' },
  { op: 'italic', label: 'I', title: '斜体', cls: 'i' },
  { op: 'code', label: '</>', title: '代码', cls: 'code' },
  { op: 'link', label: '链', title: '链接', cls: 'link' },
];

function clipboardFiles(e) {
  const out = [];
  const cd = e.clipboardData;
  if (!cd) return out;
  if (cd.files?.length) {
    for (const f of cd.files) out.push(f);
  }
  if (!out.length && cd.items?.length) {
    for (const it of cd.items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}

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
  const [pendingAtt, setPendingAtt] = useState({ items: [], inserts: '' });
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setComposing(!!at?.comment);
    setDraft('');
    setPendingAtt({ items: [], inserts: '' });
  }, [at?.text, at?.x, at?.y, at?.comment, at?.mode]);

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
  const isFeedback = at.mode === 'feedback' || at.mode === 'redo';
  const cap = isFeedback ? '反馈：写下要改的地方（将新开任务）' : '划线评论（回写本任务）';
  const canSubmit = !!draft.trim() || pendingAtt.items.length > 0;

  const startCompose = () => {
    setComposing(true);
    onCompose?.();
  };

  const cancelCompose = () => {
    setComposing(false);
    setDraft('');
    setPendingAtt({ items: [], inserts: '' });
    onClose?.();
  };

  const submit = () => {
    if (!canSubmit || busy) return;
    onComment?.({
      text: draft.trim(),
      attachments: pendingAtt.items,
      inserts: pendingAtt.inserts,
      mode: isFeedback ? 'feedback' : 'comment',
      quote,
    });
  };

  const pickFiles = async (fileList) => {
    if (!fileList?.length) return;
    setBusy(true);
    try {
      const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
      const inserts = [...(imageInserts || []), ...(fileInserts || [])].join('');
      setPendingAtt((prev) => ({
        items: [...prev.items, ...items],
        inserts: `${prev.inserts}${inserts}`,
      }));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onPaste = (e) => {
    const files = clipboardFiles(e);
    if (!files.length) return; // 纯文本走默认粘贴
    e.preventDefault();
    pickFiles(files);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) pickFiles(files);
  };

  return (
    <div
      id="mdw-sel-menu"
      className={`mdw-sel-menu open kind-${composing ? 'comment' : kind}`}
      style={{ left: at.x, top: at.y }}
      role="menu"
      onMouseDown={(e) => {
        if (e.target.closest?.('textarea, input, button')) return;
        e.preventDefault();
      }}
    >
      {composing ? (
        <div
          className="mdw-sel-comment"
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={onDrop}
        >
          <div className="mdw-sel-comment-cap">{cap}</div>
          {quote ? (
            <div className="mdw-sel-quote" title={quote}>{quoteShort}</div>
          ) : null}
          <textarea
            ref={taRef}
            className="mdw-sel-comment-ta"
            rows={3}
            value={draft}
            placeholder={isFeedback ? '写下反馈…可粘贴/拖入图片' : '对此处提出问题…可粘贴/拖入图片'}
            aria-label={isFeedback ? '反馈文本' : '评论文本'}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={onPaste}
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
          {pendingAtt.items.length ? (
            <div className="mdw-sel-att-list">
              {pendingAtt.items.map((a) => (
                <span key={a.id} className="mdw-sel-att-chip" title={a.name}>
                  {a.type === 'image' ? '🖼' : '📎'} {a.name}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mdw-sel-comment-acts">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept="image/*,*/*"
              onChange={(e) => pickFiles(e.target.files)}
            />
            <button
              type="button"
              className="ghost"
              disabled={busy}
              title="添加图片或附件（也可粘贴/拖入）"
              onClick={() => fileRef.current?.click()}
            >
              {busy ? '上传中…' : '附件'}
            </button>
            <span className="grow" />
            <button type="button" className="ghost" onClick={cancelCompose}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={!canSubmit || busy}
              onClick={submit}
            >
              {isFeedback ? '新开任务' : '回写本任务'}
            </button>
          </div>
          <div className="mdw-sel-comment-hint">Ctrl/⌘+Enter 提交 · 粘贴/拖入图片 · 附件</div>
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
                title="划线评论 → 回写本任务"
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
