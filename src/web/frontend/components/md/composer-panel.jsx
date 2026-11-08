// 评论 / 反馈编辑面板（#104）：工作区里新开的一块 **md 编辑页**。
//
// 顶部：模式徽标 + 引用信息（评论 = 被引用的那段话；反馈 = 「反馈 #xx 的任务」）。
// 中部：完整 md 编辑器（与任务正文同一套 live 块编辑器，粘贴/拖图片即附件）。
// 底部：提交（评论 = 回写本任务；反馈 = 新开一条任务）。
//
// 提交逻辑在任务页那边（带会话状态），这里按 token 取回回调——见 composer-launch.js。
import { useRef, useState } from 'react';
import { MdPanes } from './md-panes.jsx';
import { filesToAttachments } from './attachments.js';
import { insertAttachmentSnippet } from '../../modules/md/md-parse.js';
import { composerOf, restoreComposerSource } from './composer-launch.js';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../toast/index.jsx';
import { openBesideMain } from '../../workspace.js';
import '../../modules/md/style.css';

export default function ComposePanel({
  token,
  mode = 'comment',
  quote = '',
  prevQuote = '',
  taskLabel = '',
  taskTitle = '',
  src = null,
}) {
  const app = useApp() || {};
  const toast = useToast();
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy] = useState(false);
  const editorApiRef = useRef(null);
  const isFeedback = mode === 'feedback';

  // 收尾：把**来源面板**放回主区（#106）——主区是单面板位，评论页把任务页
  // 顶掉了；不放回去主区就空掉，只剩侧边栏。
  const finish = () => {
    restoreComposerSource(app.model, token);
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
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 编辑器里粘贴 / 拖图片 = 附件（沿用任务正文的通道：正文留 ![]() 片段 + 附件列表）
  const onFiles = async (fileList) => {
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
          onBody={setBody}
          attachments={attachments}
          docKey={'compose-' + token}
          editorApiRef={editorApiRef}
          onFiles={onFiles}
          onSave={submit}
          hideTitle
        />
      </div>
    </div>
  );
}
