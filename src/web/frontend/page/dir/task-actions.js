// 任务操作（提交 / 删除 / 关闭 / 附件 / 导入 / 新建 / 克隆 / Fork）。
import { useCallback } from 'react';
import { Actions } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { openPanel } from '../../workspace.js';
import { filesToAttachments, persistAtt } from '../../components/md/attachments.js';
import { clearHistory } from '../../modules/md/md-history.js';
import {
  insertAttachmentSnippet,
  slugName,
  titleFromMd,
  parseFrontmatter,
  stripFrontmatter,
  stripPhantomEmptyLines,
  withFrontmatter,
} from '../../modules/md/md-parse.js';
import {
  docIdOf,
  nextDraftId,
  peekDoc,
  promoteDoc,
  saveDoc,
  scopeOf,
} from '../../modules/md/doc-store.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';

export function useTaskActions({
  doc, id, isDraft, task, taskRow, topicKey, topic, isGlobal, boardCtx, docFm,
  groupAnchored, groupId, rows, app, model, tabId, tpl, refreshLocal,
  markDirty, histRef, editorApiRef, attachAreaRef,
  setDirty,
  goal, goalEditable, goalPromptEditable, declaredGoal, guard, dialog, showDockTab,
}) {
  const toast = useToast();

  /** 标题 + frontmatter 拼装（提交/贴图同步共用）——标题行永远在 FM 之后。 */
  const composeText = useCallback((title, bodyText) => {
    const t = (title || '').trim() || '未命名任务';
    const fm = parseFrontmatter(bodyText);
    const hasFm = Object.keys(fm).length > 0;
    let bare = stripFrontmatter(bodyText);
    // 幻影空块清洗（#92）：块编辑器的 ZWSP 空块不落库——落库即「一段莫名空白」，下次打开还在、再编辑又攒一条。
    bare = stripPhantomEmptyLines(bare);
    if (!/^#\s+/m.test(bare)) bare = `# ${t}\n\n${bare}`;
    else bare = bare.replace(/^#\s+.+$/m, `# ${t}`);
    return hasFm ? withFrontmatter(bare, fm) : bare;
  }, []);

  // 时间目标的落库口径：草稿 → POST 带 duration/goalPrompt；已有任务 → 与服务端声明比对，有变化才发。
  const goalPatchOf = useCallback(() => {
    const duration = (goal.duration || '').trim();
    const prompt = (goal.prompt || '').trim();
    if (prompt && !duration) return { error: '时间目标要填时长（如 2h / 90m）；只写附加要求无效' };
    if (!isDraft) {
      const prevDur = declaredGoal?.duration || '';
      const prevPrompt = declaredGoal?.prompt || '';
      const durChanged = duration !== prevDur;
      const promptChanged = prompt !== prevPrompt;
      if (!durChanged && !promptChanged) return {};
      if (durChanged) {
        // 时长：领取即计时，只有待领取能改
        if (!goalEditable) return { error: '已领取计时，时长不可改（附加要求仍可直接改）' };
        return duration ? { duration, goalPrompt: prompt } : { clearGoal: true };
      }
      // 任务 #87：只改附加要求 → 领取后也放行（下一轮 check 用新值渲染）
      if (!goalPromptEditable) return {};
      return { goalPrompt: prompt };
    }
    return duration ? { duration, goalPrompt: prompt } : {};
  }, [goal, goalEditable, goalPromptEditable, isDraft, declaredGoal]);

  const submit = useCallback(() => guard(async () => {
    if (!doc) return;
    const t = (doc.title || '').trim() || '未命名任务';
    const fm = parseFrontmatter(doc.body);
    const b = composeText(t, doc.body);
    const projTopic = fm.project
      ? rows.find((r) => !r.isGlobal && r.repo && r.repo.key === fm.project)
      : null;
    const groupSubmit = !!(boardCtx && fm.project &&
      boardCtx.members.some((m) => m.key === fm.project));
    const gp = goalPatchOf();
    if (gp.error) {
      toast(gp.error);
      return;
    }
    if (!isDraft) {
      const res = await api('/api/localtasks/item', {
        method: 'PATCH',
        body: {
          cwd: isGlobal ? (projTopic ? projTopic.cwd : undefined) : topic?.cwd,
          key: isGlobal && !projTopic ? GLOBAL_KEY : undefined,
          id: Number(task),
          text: b,
          ...gp,
        },
      });
      if (res?.moved) {
        const landedKey = res.key || topicKey;
        const newId = String(res.task?.id ?? task);
        const newDocId = docIdOf(scopeOf(landedKey), newId);
        persistAtt(newId, doc.attachments);
        promoteDoc(id, newDocId, { title: t, body: res.task?.text || b });
        if (model && tabId) {
          model.doAction(Actions.updateNodeAttributes(tabId, {
            config: groupAnchored ? { groupId, task: newId } : { dirKey: landedKey, task: newId },
          }));
        }
        app.onNavigate && app.onNavigate(
          groupAnchored
            ? `#/group/${encodeURIComponent(groupId || '')}?task=${encodeURIComponent(newId)}`
            : `#/dir/${encodeURIComponent(landedKey || '')}?task=${encodeURIComponent(newId)}`
        );
        setDirty(false);
        clearHistory(histRef.current, newDocId);
        toast(`已改归属项目：任务迁到「${res.name}」#${newId}`);
        refreshLocal();
        return;
      }
      persistAtt(task, doc.attachments);
      saveDoc(id, { title: t, body: b });
      setDirty(false);
      clearHistory(histRef.current, id);
      toast(gp.clearGoal ? '已同步 MD · 时间目标已清除' : gp.duration ? '已同步 MD · 时间目标已更新' : '已同步 MD');
      refreshLocal();
      return;
    }
    const res = await api('/api/localtasks', {
      method: 'POST',
      body: {
        ...(groupSubmit
          ? { text: b, board: boardCtx.board.id, project: fm.project }
          : fm.project
            ? { text: b, project: fm.project }
            : isGlobal
              ? { global: true, text: b }
              : { cwd: topic?.cwd, text: b }),
        ...gp,
      },
    });
    const newId = res?.task?.id ?? res?.id;
    if (newId != null) {
      const landedKey = res?.key || topicKey;
      const landedScope = scopeOf(landedKey);
      persistAtt(newId, doc.attachments);
      const newDocId = docIdOf(landedScope, String(newId));
      promoteDoc(id, newDocId, { title: t, body: b });
      if (model && tabId) {
        model.doAction(Actions.updateNodeAttributes(tabId, {
          config: groupAnchored ? { groupId, task: String(newId) } : { dirKey: landedKey, task: String(newId) },
        }));
      }
      app.onNavigate && app.onNavigate(
        groupAnchored
          ? `#/group/${encodeURIComponent(groupId || '')}?task=${encodeURIComponent(String(newId))}`
          : `#/dir/${encodeURIComponent(landedKey || '')}?task=${encodeURIComponent(String(newId))}`
      );
      setDirty(false);
      clearHistory(histRef.current, newDocId);
    }
    toast(`已提交：${slugName(t)}`);
    refreshLocal();
  }), [doc, id, isDraft, task, topicKey, topic, isGlobal, boardCtx, groupAnchored, groupId, rows, app, model, tabId, refreshLocal, histRef, setDirty, composeText, goalPatchOf, guard, toast]);

  const importMd = useCallback(async (file) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal
          ? { global: true, text: bodyText }
          : groupAnchored && docFm.project
            ? { project: docFm.project, text: bodyText }
            : { cwd: topic?.cwd, text: bodyText },
      });
      toast(`已导入：${file.name}`);
      refreshLocal();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `#${newId}` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `#${newId}` });
      }
    });
  }, [isGlobal, groupAnchored, docFm.project, topic?.cwd, topicKey, groupId, app, refreshLocal, guard, toast]);

  const delTask = useCallback(async () => {
    if (!doc || isDraft) return;
    const title = doc.title || `#${task}`;
    const ok = await dialog({
      title: `删除任务「${title}」`,
      message: '软删除：CLI localtask task restore 可恢复。',
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    guard(async () => {
      await api('/api/localtasks/item', {
        method: 'DELETE',
        body: isGlobal ? { key: GLOBAL_KEY, id: Number(task) } : { cwd: topic.cwd, id: Number(task) },
      });
      toast(`已删除「${title}」`);
      if (model && tabId) model.doAction(Actions.deleteTab(tabId));
      refreshLocal();
    });
  }, [doc, isDraft, task, isGlobal, topic, model, tabId, refreshLocal, guard, toast, dialog]);

  const canClosePending = !isDraft && !!taskRow && taskRow.status === 'pending';
  const closeTask = useCallback((kind) => {
    if (!canClosePending) return;
    guard(async () => {
      const title = doc?.title || `#${task}`;
      const scope = isGlobal ? { key: GLOBAL_KEY } : { cwd: topic?.cwd };
      if (kind === 'done') {
        const summary = await dialog({
          title: `标为完成「${title}」`,
          message: '任务还没被领取。确认把当前正文视为已完成？可写一句完成总结。',
          input: true,
          placeholder: '完成总结（可选；留空使用默认说明）',
          okText: '标为完成',
        });
        if (summary === null || summary === undefined) return;
        await api('/api/localtasks/items/close', {
          method: 'POST',
          body: { ...scope, ids: [Number(task)], status: 'done', summary: String(summary).trim() },
        });
        toast(`已标为完成 #${task}`);
      } else {
        const ok = await dialog({
          title: `取消任务「${title}」`,
          message: '只处理待领取任务。取消为终态，原文留档。',
          danger: true,
          okText: '取消任务',
        });
        if (!ok) return;
        await api('/api/localtasks/items/close', {
          method: 'POST',
          body: { ...scope, ids: [Number(task)], status: 'cancelled' },
        });
        toast(`已取消 #${task}`);
      }
      refreshLocal();
    });
  }, [canClosePending, doc, task, isGlobal, topic, refreshLocal, guard, toast, dialog]);

  const addFiles = useCallback(async (fileList, opts = {}) => {
    if (!doc) return;
    const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
    const cur = peekDoc(id) || doc;
    const b = cur.body || '';
    const imgIns = imageInserts.join('');
    let body = b;
    let caretAt = null;
    if (imgIns) {
      const placed = insertAttachmentSnippet(b, imgIns, opts);
      body = placed.body;
      caretAt = placed.insertAt + imgIns.length;
    }
    if (fileInserts.length) {
      body = insertAttachmentSnippet(body, fileInserts.join(''), {}).body;
    }
    const patch = {};
    if (body !== b) patch.body = body;
    if (items.length) patch.attachments = [...(cur.attachments || []), ...items];
    if (!Object.keys(patch).length) return;
    saveDoc(id, patch);
    if (opts.mode === 'edit' && caretAt != null) {
      requestAnimationFrame(() => {
        editorApiRef.current?.focus?.();
        const ta = document.querySelector('.mdw-editor');
        if (ta) {
          try { ta.setSelectionRange(caretAt, caretAt); } catch { /* ignore */ }
        }
      });
    }
    if (!isDraft) {
      if (patch.attachments) persistAtt(task, patch.attachments);
      const synced = composeText(cur.title, patch.body || body);
      saveDoc(id, { body: synced, title: titleFromMd(synced) });
      try {
        await api('/api/localtasks/item', {
          method: 'PATCH',
          body: {
            cwd: isGlobal ? undefined : topic?.cwd,
            key: isGlobal ? GLOBAL_KEY : undefined,
            id: Number(task),
            text: synced,
          },
        });
        setDirty(false);
        refreshLocal();
        toast(items.length ? `已添加附件并同步（${items.length}）` : '已同步附件');
      } catch (e) {
        markDirty();
        toast(`附件已插入，同步失败：${e.message || e}`);
      }
      return;
    }
    markDirty();
  }, [doc, id, isDraft, task, topic, isGlobal, setDirty, refreshLocal, markDirty, composeText, editorApiRef, toast]);

  /** 「更多 → 新任务」：新草稿**带着当前上下文**（工作组 + 归属项目）。 */
  const newTask = useCallback(() => {
    const draftId = nextDraftId();
    const docId = docIdOf(groupAnchored ? scopeOf(groupId) : scopeOf(topicKey), draftId);
    const fm = {};
    if (boardCtx && boardCtx.board && boardCtx.board.id) fm.board = boardCtx.board.id;
    if (docFm.project) fm.project = docFm.project;
    saveDoc(docId, {
      title: '',
      body: withFrontmatter(tpl ? tpl.defaultBody() : '', fm),
    });
    app.openPage && app.openPage(
      groupAnchored
        ? { groupId, task: draftId, name: '新任务' }
        : { dirKey: topicKey, task: draftId, name: '新任务' }
    );
  }, [boardCtx, docFm.project, groupAnchored, groupId, topicKey, app, tpl]);

  /** 「更多 → 克隆任务」：以当前任务为模板快速复制一条新任务（#70）。 */
  const cloneCur = useCallback(() => {
    if (isDraft || task == null || /^draft/i.test(String(task))) {
      toast('草稿没有可克隆的队列任务');
      return;
    }
    guard(async () => {
      const res = await api('/api/localtasks/clone', {
        method: 'POST',
        body: isGlobal ? { id: Number(task) } : { id: Number(task), cwd: topic?.cwd },
      });
      toast(`已克隆为新任务 #${res.task?.id ?? res.id}`);
      refreshLocal();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
      }
    });
  }, [isDraft, task, isGlobal, topic, groupAnchored, groupId, topicKey, app, doc, refreshLocal, guard, toast]);

  /** 「更多 → Fork 任务」：clone 的原文复制 + 保留源任务链（#67）。 */
  const forkCur = useCallback(() => {
    if (isDraft || task == null || /^draft/i.test(String(task))) {
      toast('草稿没有可 Fork 的队列任务');
      return;
    }
    guard(async () => {
      const res = await api('/api/localtasks/fork', {
        method: 'POST',
        body: isGlobal ? { id: Number(task) } : { id: Number(task), cwd: topic?.cwd },
      });
      toast(`已 Fork 为新任务 #${res.task?.id ?? res.id}（保留任务链）`);
      refreshLocal();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（Fork）` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（Fork）` });
      }
    });
  }, [isDraft, task, isGlobal, topic, groupAnchored, groupId, topicKey, app, doc, refreshLocal, guard, toast]);

  const openProgress = useCallback(() => {
    const m = model || app.model;
    if (!m) return;
    const boardId = docFm && docFm.board ? String(docFm.board) : '';
    openPanel(m, {
      component: 'progress',
      name: '进程',
      config: boardId
        ? { groupKey: boardId, task: task != null ? String(task) : undefined }
        : { dirKey: topicKey || GLOBAL_KEY, task: task != null ? String(task) : undefined },
      location: 'right',
    });
  }, [model, app.model, docFm, task, topicKey]);

  const openAttachPanel = useCallback(() => {
    showDockTab('attach');
    setTimeout(() => attachAreaRef.current?.open(), 0);
  }, [showDockTab, attachAreaRef]);

  return {
    composeText, goalPatchOf, submit, importMd, delTask, canClosePending, closeTask,
    addFiles, newTask, cloneCur, forkCur, openProgress, openAttachPanel,
  };
}
