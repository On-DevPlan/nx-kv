// 评论 / 反馈编辑面板（#104）：工作区里新开的一块 **md 编辑页**。
//
// 顶部：模式徽标 + 引用信息（评论 = 被引用的那段话；反馈 = 「反馈 #xx 的任务」）。
// 中部：完整 md 编辑器（与任务正文同一套 live 块编辑器，粘贴/拖图片即附件）。
// 底部：提交（评论 = 回写本任务；反馈 = 新开一条任务）。
//
// 提交逻辑在任务页那边（带会话状态），这里按 token 取回回调——见 composer-launch.js。
import { useRef, useState } from 'react';
import { MdPanes } from '../panes/md-panes.jsx';
import AttachBar from '../attachments/attach-bar.jsx';
import { filesToAttachments } from '../attachments/attachments.js';
import { insertAttachmentSnippet } from '../../../modules/md/md-parse.js';
import { composerOf, restoreComposerSource } from './composer-launch.js';
import type { ComposerSrc } from './composer-launch.js';
import { pushHistory, undoHistory, redoHistory, clearHistory } from '../../../modules/md/md-history.js';
import { useApp } from '../../../app-context.jsx';
import { useToast } from '../../toast/index.jsx';
import { openBesideMain } from '../../../workspace.js';
import type { Attachment } from '../attachments/attach-common.js';
import type { EditorApi } from '../panes/md-panes-helpers.js';
import '../../../modules/md/style.css';

// 附件区（#278）：直接放在面板内——不再有展开/收起的 dock 与绿色激活底
// （nxkv.cmpDock*，不与任务页的 nxkv.taskDock* 串台）。

interface ComposePanelProps {
  token: string;
  mode?: string;
  quote?: string;
  prevQuote?: string;
  taskLabel?: string;
  taskTitle?: string;
  src?: ComposerSrc | null;
}

export default function ComposePanel({
  token,
  mode = 'comment',
  quote = '',
  prevQuote = '',
  taskLabel = '',
  taskTitle = '',
  src = null,
}: ComposePanelProps) {
  const app = useApp();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // 隐藏文件 input：右上「＋」添加文件走它（附件直接进附件区，不再经过 dock）
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const editorApiRef = useRef<EditorApi | null>(null);
  const isFeedback = mode === 'feedback';
  // 撤销栈（#156）：composer 自己一份——MdPanes 的按键拦截会吃掉 Ctrl+Z 再调
  // onUndo；不接历史的话原生撤销也一起被拦死（「编辑器无法撤回」的根因）。
  // md-history 仍是 JS 模块：快照形状由它自己管（title/body）
  const histRef = useRef<Map<string, any>>(new Map());
  const histId = 'compose-' + token;

  // 收尾：把**来源面板**放回主区（#106）——主区是单面板位，评论页把任务页
  // 顶掉了；不放回去主区就空掉，只剩侧边栏。撤销栈一并销号（防泄漏）。
  const finish = () => {
    clearHistory(histRef.current, histId);
    restoreComposerSource(app.model, token);
  };

  // 正文写入统一走这里：先记历史再改状态（Ctrl+Z / Ctrl+⇧Z 走同一份栈）
  const onBody = (next: string, kind: string = 'op') => {
    pushHistory(histRef.current, histId, { title: '', body }, kind);
    setBody(next);
  };
  const undo = () => {
    const snap = undoHistory(histRef.current, histId, { title: '', body });
    if (!snap) return;
    setBody(snap.body);
  };
  const redo = () => {
    const snap = redoHistory(histRef.current, histId, { title: '', body });
    if (!snap) return;
    setBody(snap.body);
  };

  const submit = async () => {
    const text = String(body || '').trim();
    if (!text && !attachments.length) {
      toast(isFeedback ? '写一下要改的地方' : '写一下要提的问题');
      return;
    }
    const h = composerOf(token);
    if (!h || !h.onSubmit) {
      toast('提交入口已失效（来源页面已关闭）');
      return;
    }
    setBusy(true);
    try {
      await h.onSubmit({ text, attachments, inserts: '' });
      finish();
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 编辑器里粘贴 / 拖图片 = 附件（沿用任务正文的通道：正文留 ![]() 片段 + 附件列表）
  const onFiles = async (fileList: File[]) => {
    if (!fileList || !fileList.length) return;
    const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
    const snippet = [...imageInserts, ...fileInserts].join('');
    if (snippet) setBody((b) => insertAttachmentSnippet(b, snippet, {}).body);
    if (items.length) setAttachments((a) => [...a, ...items]);
  };

  // 点引用区 → 主区右侧并排打开**原文**（旁路原文面板），方便对照（#107）
  const openOriginal = () => {
    const m = app.model;
    if (!m || !src || !src.task) return;
    openBesideMain(m, {
      component: 'page',
      name: src.name || '原文',
      config: { dirKey: src.dirKey, task: String(src.task) },
    });
  };
  const canOpenOriginal = !!(src && src.task);

  return (
    <div className="cmp">
      <div className="cmp-head">
        <span className={'cmp-tag' + (isFeedback ? ' is-fb' : '')}>{isFeedback ? '反馈' : '评论'}</span>
        <div className="cmp-ctx">
          {isFeedback ? (
            <span className="cmp-ctx-line" title={taskTitle || ''}>
              反馈 {taskLabel || ''} 的任务{taskTitle ? ` · ${taskTitle}` : ''}
            </span>
          ) : (
            <span className="cmp-ctx-line">对本任务提出问题</span>
          )}
        </div>
        <span className="grow" />
        <button
          type="button"
          className="btn ghost sm"
          onClick={finish}
          disabled={busy}
        >
          关闭
        </button>
        <button type="button" className="btn sm" onClick={submit} disabled={busy}>
          {isFeedback ? '提交反馈' : '提交评论'}
        </button>
      </div>
      {/* 引用段（#105）：引用不是头部一行小字，而是**页面里的一段引用**——
          评论 = 被评论的那段话；反馈 = 之前的引用（上轮总结，没有就退回原任务正文）。
          #107：引用区**可点**——点在右侧并排打开原文，方便对照。 */}
      {isFeedback ? (
        <div className="cmp-quote-wrap">
          <div className="cmp-quote-cap">
            之前的引用
            {canOpenOriginal && (
              <button type="button" className="cmp-quote-cmp" onClick={openOriginal} title="在右侧并排显示原文，方便对照">
                对照原文 ↗
              </button>
            )}
          </div>
          {canOpenOriginal ? (
            <button type="button" className="cmp-quote" onClick={openOriginal} title="点击在右侧并排显示原文，方便对照">
              {prevQuote || '（这条任务还没有可引用的上轮总结）'}
            </button>
          ) : (
            <div className="cmp-quote">{prevQuote || '（这条任务还没有可引用的上轮总结）'}</div>
          )}
        </div>
      ) : quote ? (
        <div className="cmp-quote-wrap">
          <div className="cmp-quote-cap">
            引用
            {canOpenOriginal && (
              <button type="button" className="cmp-quote-cmp" onClick={openOriginal} title="在右侧并排显示原文，方便对照">
                对照原文 ↗
              </button>
            )}
          </div>
          {canOpenOriginal ? (
            <button type="button" className="cmp-quote" onClick={openOriginal} title="点击在右侧并排显示原文，方便对照">
              {quote}
            </button>
          ) : (
            <div className="cmp-quote">{quote}</div>
          )}
        </div>
      ) : null}
      <div className="cmp-body">
        <MdPanes
          mode="split"
          title=""
          body={body}
          onTitle={() => {}}
          onBody={onBody}
          attachments={attachments}
          docKey={'compose-' + token}
          editorApiRef={editorApiRef}
          onFiles={onFiles}
          onSave={submit}
          onUndo={undo}
          onRedo={redo}
          hideTitle
        />
      </div>

      {/* ─── 附件区（#278）：直接放在面板里——去掉展开/收起开关与绿色激活底 ─── */}
      <div className="cmp-attach">
        {attachments.length ? (
          <AttachBar
            attachments={attachments}
            onRemove={(aid) => setAttachments((a) => a.filter((x) => x.id !== aid))}
          />
        ) : (
          <div className="cmp-attach-empty">
            还没有附件——粘贴 / 拖图片进正文即附件，或点右上「＋」添加文件。
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          // ⚠️ 先拷贝再清 value：`e.target.files` 是活的 FileList，`value = ''`
          // 会把它清空（引用还在、length 归零）——先清后读就一个文件都拿不到。
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
