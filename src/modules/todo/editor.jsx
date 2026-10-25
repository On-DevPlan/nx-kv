// 任务编辑器：编辑正文时**直接上传图片 / docx 等附件**，插入标准 markdown 嵌入。
//
// 为什么不再是原来那个单行 dialog：
//   1. 正文现在会长出 markdown 嵌入，单行输入框看不见也编辑不了；
//   2. 上传必须发生在编辑现场（选完/粘完立刻插到光标处），
//      否则用户得先记住 fileId 再手拼语法 —— 那是给机器用的接口，不是给人用的。
//
// 三条上传路径共用一套逻辑（./upload.js）：**选择文件 / Ctrl+V 粘贴 / 拖进来**。
// 其中粘贴截图是最常用的那条 —— 截图工具连文件名都不给，所以 upload.js 会替它起名。
import { useEffect, useRef, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useToast } from '../../web/frontend/components/ui.jsx';
import { AttachmentText } from './markdown.jsx';
import { clipboardFiles, droppedFiles, snippetsOf, uploadMany } from './upload.js';

export default function TaskEditor({ task, pick, group, onSaved, onCancel }) {
  const toast = useToast();
  const [text, setText] = useState(task.text || '');
  const [note, setNote] = useState(task.note || '');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);

  // 正文的「权威值」。插入要同步读到**最新的** text，而 setState 是异步的 ——
  // 用 ref 保持同步，就不必在闭包里跟陈旧 state 斗智。
  const textRef = useRef(text);
  const writeText = (v) => {
    textRef.current = v;
    setText(v);
  };

  useEffect(() => {
    const ta = taRef.current;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length); // 光标落尾：粘贴/拖入紧接着追加
    }
  }, []);

  /** 插到**光标处**（未聚焦时落尾）。 */
  const insert = (snippet) => {
    if (!snippet) return;
    const ta = taRef.current;
    const cur = textRef.current;
    const start = ta && ta.selectionStart !== null ? ta.selectionStart : cur.length;
    const end = ta && ta.selectionEnd !== null ? ta.selectionEnd : start;
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    // 与前后内容之间垫一个空格，免得嵌入跟前文粘成一串
    const needBefore = before && !/\s$/.test(before) ? ' ' : '';
    const needAfter = after && !/^\s/.test(after) ? ' ' : '';
    const next = `${before}${needBefore}${snippet}${needAfter}${after}`;
    writeText(next);

    const caret = before.length + needBefore.length + snippet.length;
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const uploadAll = async (files) => {
    const list = Array.from(files || []).filter((f) => f && f.size > 0);
    if (!list.length || progress) return;
    setProgress({ done: 0, total: list.length });
    try {
      const results = await uploadMany(list, {
        group,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // 一次插入全部片段：连续插入会跟光标位置打架（见 upload.js 的注释）
      insert(snippetsOf(results));
      const imgs = results.filter((r) => r.isImage).length;
      toast(
        results.length === 1
          ? `已插入 ${results[0].name}`
          : `已插入 ${results.length} 个附件${imgs ? `（图片 ${imgs} 个）` : ''}`
      );
    } catch (err) {
      toast(String((err && err.message) || err));
    } finally {
      setProgress(null);
    }
  };

  const onPaste = (e) => {
    const files = clipboardFiles(e);
    // 没有文件就是普通文本粘贴：不要 preventDefault，
    // 交给浏览器按默认行为插到光标处 —— 「Ctrl+V 直接复制到对应位置」。
    if (!files.length) return;
    e.preventDefault();
    uploadAll(files);
  };

  // 拖拽挂在 **window** 上而不是编辑器容器上：用户是往弹窗里丢文件的，
  // 落点差一点（丢在标题上、丢在预览区外）也该接住，而不是让浏览器把文件打开。
  // 用 ref 拿最新的处理器，避免把 window 监听跟着每次状态变化重新注册。
  const dropRef = useRef(null);
  dropRef.current = (e) => uploadAll(droppedFiles(e));

  useEffect(() => {
    // 只在**拖文件**时介入：拖选中的文字/链接不该弹「松手即上传」
    const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    const over = (e) => { if (!hasFiles(e)) return; e.preventDefault(); setDragOver(true); };
    const leave = (e) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragOver(false);
      if (dropRef.current) dropRef.current(e);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const save = () => {
    if (busy) return;
    if (!String(textRef.current).trim()) {
      toast('正文不能为空');
      return;
    }
    const body = { group, ref: task.text, pick, matchTopic: task.topic, text: textRef.current };
    // 备注只在真的改过时才发：PATCH 的语义是「只改传入的字段」
    if (note !== (task.note || '')) body.note = note;
    setBusy(true);
    api('/api/todo/item', { method: 'PATCH', body })
      .then(() => { toast('已保存'); onSaved(); })
      .catch((err) => toast(String((err && err.message) || err)))
      .finally(() => setBusy(false));
  };

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };

  const uploadingLabel = progress
    ? `上传中 ${progress.done}/${progress.total}…`
    : '选择文件上传';
  const empty = !String(text).trim();

  return (
    <div className={'editor' + (dragOver ? ' drag' : '')}>
      <div className="ed-tip">
        粘贴（<kbd>Ctrl</kbd>+<kbd>V</kbd> 截图）、拖文件进来，或
        <button type="button" className="ed-link" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!progress}>
          选择文件
        </button>
        —— 会自动上传并插到光标处。
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            // ⚠️ 必须先拷成数组再清空 value：FileList 是**活的**，
            // `value = ''` 会当场把它清空，之后 uploadAll 拿到的是空列表。
            const picked = Array.from(e.target.files || []);
            e.target.value = '';
            uploadAll(picked);
          }}
        />
      </div>

      <div className="ed-field">
        <div className="ed-label">正文</div>
        <textarea
          ref={taRef}
          className="ed-textarea"
          rows={4}
          value={text}
          spellCheck="false"
          placeholder="要做什么…  图片写 ![说明](fileId)，其他文件写 [文件名](fileId)"
          onChange={(e) => writeText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
        />
        <div className="ed-meta">
          <span className="ed-acts">
            <button type="button" className="btn small" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!progress}>
              {uploadingLabel}
            </button>
            <span className="hint">图片 <code>![说明](id)</code>　文件 <code>[文件名](id)</code></span>
          </span>
          <span className="hint">{text.length} 字符</span>
        </div>
      </div>

      <div className="ed-field">
        <div className="ed-label">预览</div>
        <div className={'preview' + (empty ? ' empty' : '')}>
          {empty ? <span className="muted">（暂无内容）</span> : <AttachmentText text={text} />}
        </div>
      </div>

      <div className="ed-field">
        <div className="ed-label">备注</div>
        <textarea
          className="ed-textarea"
          rows={2}
          value={note}
          spellCheck="false"
          placeholder="可选：完成结果、上下文补充"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="ed-foot">
        <span className="hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存</span>
        <span className="ed-acts">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>取消</button>
          <button className="btn" onClick={save} disabled={busy || !!progress}>{busy ? '保存中…' : '保存'}</button>
        </span>
      </div>
    </div>
  );
}
