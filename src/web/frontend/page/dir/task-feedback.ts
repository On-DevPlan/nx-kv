// 验收反馈 / 划选评论动作（#75、#79、#104）。
import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { openComposer } from '../../components/md/composer-launch.js';
import { persistAtt } from '../../components/md/attachments.js';
import type { Attachment } from '../../components/md/attach-common.js';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { docIdOf, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import {
  buildReopenText,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  quoteBlock,
} from '../../modules/board/reopen-text.js';
import type { LocalTask, LocalTopic } from '../../types.js';
import type { AppSlice, DocState, Guard, SelMenuState } from './task-utils.js';

/** 评论编辑面板回传的内容（composer 尚未类型化，按本文件用到的字段收口）。 */
interface FeedbackPayload {
  text?: string;
  attachments?: Attachment[];
  inserts?: string;
  quote?: string;
}

interface UseFeedbackArgs {
  doc: DocState | null;
  isDraft: boolean;
  task: string;
  taskRow: LocalTask | null;
  topicKey: string;
  topic: LocalTopic | null;
  isGlobal: boolean;
  dirKey?: string;
  groupAnchored: boolean;
  groupId?: string;
  app: AppSlice;
  model: Model | null;
  tabId?: string;
  refreshLocal?: () => Promise<void>;
  closeSelMenu: () => void;
  lastSel: RefObject<string>;
  selMenu: SelMenuState | null;
  dirty: boolean;
  setDirty: Dispatch<SetStateAction<boolean>>;
  guard: Guard;
}

export function useFeedback({
  doc, isDraft, task, taskRow, topicKey, topic, isGlobal, dirKey,
  groupAnchored, groupId, app, model, tabId, refreshLocal,
  closeSelMenu, lastSel, selMenu, dirty, setDirty, guard,
}: UseFeedbackArgs) {
  const toast = useToast();

  /** 服务端当前任务（#79）：评论/反馈的 base 以**盘上正文**为准——会话 doc 可能过期。 */
  const fetchServerTask = useCallback(async () => {
    if (isDraft || task == null || /^draft/i.test(String(task))) return null;
    const q = isGlobal
      ? `key=${encodeURIComponent(GLOBAL_KEY)}&id=${Number(task)}`
      : `cwd=${encodeURIComponent(topic?.cwd || '')}&id=${Number(task)}`;
    return api(`/api/localtasks/item?${q}`).catch(() => null);
  }, [isDraft, task, isGlobal, topic?.cwd]);

  /** 反馈：开一块 **md 编辑面板** 写意见；提交后**新建一条任务**（forkOf 指回本条），原任务不动。 */
  const openFeedback = useCallback(() => {
    const m = model || app.model;
    if (!m) return;
    openComposer(m, {
      mode: 'feedback',
      taskLabel: task != null ? '#' + task : '',
      taskTitle: String(doc?.title || '').replace(/^#+\s*/, ''),
      // 之前的引用（#105）：反馈针对的是**上轮总结**；没有就退回原任务正文开头
      prevQuote: String(taskRow?.roundSummary || '').trim()
        || String(doc?.body || '').trim().slice(0, 400),
      // 原文定位（#107）：点引用区在右侧并排打开这条任务的原文
      src: { dirKey: topicKey || dirKey || GLOBAL_KEY, task: String(task), name: `原文 #${task}` },
      onSubmit: (payload: FeedbackPayload) => spawnFeedbackTask(payload),
    });
  }, [model, app.model, task, doc, taskRow, topicKey, dirKey]);

  /** 验收反馈 → 新开任务（#75）：正文 = 完整之前的任务 + 上轮总结 + 本轮反馈；forkOf 指回本条。 */
  const spawnFeedbackTask = useCallback(({ text: fbRaw, attachments = [], inserts = '' }: FeedbackPayload = {}) => {
    const fb = String(fbRaw || '').trim();
    closeSelMenu();
    if (!fb && !(attachments && attachments.length)) {
      toast('写一下反馈');
      return;
    }
    const title = doc?.title || `#${task}`;
    guard(async () => {
      const fresh = await fetchServerTask();
      const baseText = String(fresh?.text ?? '').trim() || String(doc?.body ?? '').trim();
      if (!baseText && !isDraft) {
        toast('拿不到任务当前正文，已取消反馈（防止丢内容）');
        return;
      }
      let feedbackBody = fb || '（见附件）';
      if (inserts) feedbackBody = `${feedbackBody}${inserts}`;
      // 拼装参数先收进变量：reopen-text 的入参形状仍在迁移（字面量直接传会被多余属性检查拦下）
      const reopenArgs = {
        base: baseText,
        feedback: feedbackBody,
        ackSummary: fresh?.roundSummary || taskRow?.roundSummary || '',
        feedbackHeading: FEEDBACK_HEADING,
        bold: true,
      };
      const text = buildReopenText(reopenArgs);
      const linkFields =
        !isDraft && task != null && !/^draft/i.test(String(task))
          ? { forkOf: String(task), forkKind: 'reopen' }
          : {};
      const res = await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal
          ? { global: true, text, ...linkFields }
          : { cwd: topic?.cwd, text, ...linkFields },
      });
      const newId = String(res?.task?.id ?? res?.id ?? '');
      if (!newId) {
        toast('反馈已提交，但未拿到新任务编号');
        refreshLocal?.();
        return;
      }
      const landedKey = res?.key || topicKey;
      saveDoc(docIdOf(scopeOf(landedKey), newId), { title: titleFromMd(text), body: text });
      if (attachments?.length) persistAtt(newId, attachments);
      toast(`已反馈「${title}」→ 新任务 #${newId}`);
      refreshLocal?.();
      // 反馈新任务继承原任务的组语义（正文连 FM 一起带下去）——组锚定页就留在组里开
      if (app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: newId, name: `${title.slice(0, 24)}（反馈）` });
        else app.openPage({ dirKey: landedKey, task: newId, name: `${title.slice(0, 24)}（反馈）` });
      }
    });
  }, [doc, task, taskRow, isDraft, isGlobal, topic, topicKey, groupAnchored, groupId, app, refreshLocal, closeSelMenu, guard, toast, fetchServerTask]);

  /** 划选评论 → 就地回写原任务（#74），可带附件。 */
  const submitCommentInPlace = useCallback(({ text: fbRaw, attachments = [], inserts = '', quote }: FeedbackPayload = {}) => {
    const fb = String(fbRaw || '').trim();
    const quoteText = String(quote || lastSel.current || '').trim();
    closeSelMenu();
    if (!fb && !(attachments && attachments.length)) {
      toast('写一下要提的问题');
      return;
    }
    if (!quoteText && !fb) {
      toast('先划选一段再评论');
      return;
    }
    if (isDraft || task == null || /^draft/i.test(String(task))) {
      toast('草稿先提交成任务再评论');
      return;
    }
    const title = doc?.title || `#${task}`;
    guard(async () => {
      // 纯文字 + 无未保存编辑 → 服务端拼装（不传 text，base = 服务端正文）
      const serverCompose = !dirty && !inserts && !(attachments && attachments.length);
      let text;
      if (!serverCompose) {
        const fresh = await fetchServerTask();
        const baseText = String(fresh?.text ?? '').trim() || String(doc?.body ?? '').trim();
        if (!baseText) {
          toast('拿不到任务当前正文，已取消评论（防止丢内容）');
          return;
        }
        const feedbackBody = [
          quoteBlock(quoteText),
          fb || '（见附件）',
          inserts,
        ].filter(Boolean).join('\n\n');
        // 同 spawnFeedbackTask：参数形状由 reopen-text 的迁移节奏决定
        const reopenArgs = {
          base: baseText,
          feedback: feedbackBody,
          ackSummary: '',
          feedbackHeading: PLAIN_FEEDBACK_HEADING,
          bold: false,
        };
        text = buildReopenText(reopenArgs);
      }
      const res = await api('/api/localtasks/reopen', {
        method: 'POST',
        body: {
          ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic?.cwd }),
          id: Number(task),
          ...(text ? { text } : {}),
          kind: 'comment',
          quote: quoteText,
          feedback: fb,
          attachments: (attachments || []).map((a: Attachment) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            size: a.size,
            url: a.url || '',
          })),
        },
      });
      // 回写后的正文以服务端为准刷回编辑器（服务端拼装时新段只有服务端知道）
      const landedKey = res?.key || topicKey;
      const sameId = String(res?.task?.id ?? task);
      const finalText = String(res?.task?.text ?? text ?? '');
      if (finalText) {
        saveDoc(docIdOf(scopeOf(landedKey), sameId), { title: titleFromMd(finalText), body: finalText });
      }
      if (attachments?.length) persistAtt(sameId, [...(doc?.attachments || []), ...attachments]);
      if (model && tabId && landedKey !== topicKey) {
        model.doAction(Actions.updateNodeAttributes(tabId, { config: { dirKey: landedKey, task: sameId } }));
      }
      setDirty(false);
      toast(`已回写评论「${title}」#${sameId}`);
      refreshLocal?.();
    });
  }, [doc, task, isDraft, isGlobal, topic, topicKey, model, tabId, refreshLocal, closeSelMenu, lastSel, dirty, setDirty, guard, toast, fetchServerTask]);

  /** 工具栏「评论」：只用当前可见选区；**新开 md 编辑面板**（#104） */
  const openCommentFromToolbar = useCallback(() => {
    const live = String(window.getSelection() || '').trim();
    const quote = live || (selMenu?.text ? String(selMenu.text) : '');
    if (!quote) {
      toast('先划选一段再评论');
      return;
    }
    lastSel.current = quote;
    const m = model || app.model;
    if (!m) return;
    openComposer(m, {
      mode: 'comment',
      quote,
      taskLabel: task != null ? '#' + task : '',
      taskTitle: String(doc?.title || '').replace(/^#+\s*/, ''),
      src: { dirKey: topicKey || dirKey || GLOBAL_KEY, task: String(task), name: `原文 #${task}` },
      onSubmit: (payload: FeedbackPayload) => submitCommentInPlace({ ...payload, quote }),
    });
    closeSelMenu();
  }, [doc, task, topicKey, dirKey, model, app.model, lastSel, selMenu, submitCommentInPlace, closeSelMenu, toast]);

  return {
    fetchServerTask, openFeedback, spawnFeedbackTask, submitCommentInPlace, openCommentFromToolbar,
  };
}
