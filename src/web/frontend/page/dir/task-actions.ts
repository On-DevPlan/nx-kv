// 任务操作（提交 / 删除 / 关闭 / 附件 / 导入 / 新建 / 克隆 / Fork）。
import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import {
  addTask,
  cloneTask,
  closeManyTasks,
  forkTask,
  patchTaskItem,
  removeTaskItem,
  setPlanStatus,
} from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { createTaskAndOpen } from '../../modules/task/create.js';
import { openPanel } from '../../workspace.js';
import { filesToAttachments, persistAtt } from '../../components/md/attachments/attachments.js';
import { clearHistory } from '../../modules/md/md-history.js';
import {
  insertAttachmentSnippet,
  titleFromMd,
  stripPhantomEmptyLines,
} from '../../modules/md/md-parse.js';
import {
  docIdOf,
  peekDoc,
  promoteDoc,
  saveDoc,
  scopeOf,
} from '../../modules/md/doc-store.js';
import type { AttachAreaHandle } from '../../components/md/attachments/attach-area.jsx';
import type { LocalTask, LocalTopic } from '../../types.js';
import type { PretaskContext } from '@nx-kv/plugin-sdk';
import { openDraftEntry, openPanelEntry } from '../../modules/pretask/open-entry.js';
import { pretaskDraft } from '../../modules/pretask/use-pretask.js';
import type { PretaskEntry } from '../../modules/pretask/types.js';
import type {
  AppSlice,
  BoardCtx,
  DeclaredGoal,
  DialogFn,
  DocFm,
  DocState,
  EditorApi,
  Guard,
  HistorySnapshot,
  TimeGoal,
} from './task-utils.js';

/** goalPatchOf 的结果：错误 / 时长 / 附加要求 / 清除目标。 */
interface GoalPatch {
  error?: string;
  duration?: string;
  goalPrompt?: string;
  clearGoal?: boolean;
}

interface UseTaskActionsArgs {
  doc: DocState | null;
  id: string;
  task: string;
  taskRow: LocalTask | null;
  topicKey: string;
  topic: LocalTopic | null;
  boardCtx: BoardCtx | null;
  docFm: DocFm;
  groupAnchored: boolean;
  groupId?: string;
  app: AppSlice;
  model: Model | null;
  tabId?: string;
  /** 本主题的默认 pretask 入口：任务页「新任务」也要按它触发（面板入口直接进插件页）。 */
  defaultEntry?: PretaskEntry | null;
  /** 当前页面上下文（topic/组/仓库），传给插件的面板/表单/草稿。 */
  entryCtx?: PretaskContext;
  refreshLocal?: () => Promise<void>;
  markDirty: () => void;
  histRef: RefObject<Map<string, HistorySnapshot>>;
  editorApiRef: RefObject<EditorApi | null>;
  attachAreaRef: RefObject<AttachAreaHandle | null>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  fixedDraft: boolean;
  setFixedDraft: (next: boolean) => void;
  goal: TimeGoal;
  goalEditable: boolean;
  goalPromptEditable: boolean;
  declaredGoal: DeclaredGoal | null;
  guard: Guard;
  dialog: DialogFn;
  showDockTab: (tab: string) => void;
}

export function useTaskActions({
  doc, id, task, taskRow, topicKey, topic, boardCtx, docFm,
  groupAnchored, groupId, app, model, tabId, defaultEntry, entryCtx, refreshLocal,
  markDirty, histRef, editorApiRef, attachAreaRef,
  setDirty, fixedDraft, setFixedDraft,
  goal, goalEditable, goalPromptEditable, declaredGoal, guard, dialog, showDockTab,
}: UseTaskActionsArgs) {
  const toast = useToast();

  /**
   * 标题 + 正文拼装（提交/贴图同步共用）。
   * #197：正文只存 markdown——归属在草稿的结构化字段里，这里不碰任何头部块；
   * 历史正文若还残留 --- 头，顺手剥掉（迁移已清，纯保险）。
   */
  const composeText = useCallback((title: string, bodyText: string) => {
    const t = (title || '').trim() || '未命名任务';
    // #197：正文无 frontmatter 头
    let bare = bodyText;
    // 幻影空块清洗（#92）：块编辑器的 ZWSP 空块不落库——落库即「一段莫名空白」，下次打开还在、再编辑又攒一条。
    bare = stripPhantomEmptyLines(bare);
    if (!/^#\s+/m.test(bare)) bare = `# ${t}\n\n${bare}`;
    else bare = bare.replace(/^#\s+.+$/m, `# ${t}`);
    return bare;
  }, []);

  // 时间目标的落库口径：与服务端声明比对，有变化才发（领取后仍可改附加要求）。
  const goalPatchOf = useCallback((): GoalPatch => {
    const duration = (goal.duration || '').trim();
    const prompt = (goal.prompt || '').trim();
    if (prompt && !duration) return { error: '时间目标要填时长（如 2h / 90m）；只写附加要求无效' };
    const prevDur = declaredGoal?.duration || '';
    const prevPrompt = declaredGoal?.prompt || '';
    const durChanged = duration !== prevDur;
    const promptChanged = prompt !== prevPrompt;
    if (!durChanged && !promptChanged) return {};
    if (durChanged) {
      // 时长：领取即计时，只有待领取 / 草稿能改
      if (!goalEditable) return { error: '已领取计时，时长不可改（附加要求仍可直接改）' };
      return duration ? { duration, goalPrompt: prompt } : { clearGoal: true };
    }
    // 任务 #87：只改附加要求 → 领取后也放行（下一轮 check 用新值渲染）
    if (!goalPromptEditable) return {};
    return { goalPrompt: prompt };
  }, [goal, goalEditable, goalPromptEditable, declaredGoal]);

  const submit = useCallback(() => guard(async () => {
    if (!doc) return;
    const t = (doc.title || '').trim() || '未命名任务';
    const fm = docFm; // #197：归属来自草稿的结构化字段（不再解析正文）
    const b = composeText(t, doc.body);
    const gp = goalPatchOf();
    if (gp.error) {
      toast(gp.error);
      return;
    }
    const promotePlan = taskRow?.status === 'plan' && !fixedDraft;
    // 改归属时的寻址**必须落在当前队列**：任务还在旧队列里，后端要先按 cwd 找到它，
    // 再按正文 project 解析新落点搬家（#190 删除全局池时曾误传目标项目 cwd →
    // getTask 在目标队列里找不到原任务，表现为 pending 任务改 repo 不生效/报错）。
    const res = await patchTaskItem({
      cwd: topic?.cwd,
      id: Number(task),
      text: b,
      // #197：改动归属用显式参数（后端按它搬家），不再改正文
      ...(fm.project ? { project: fm.project } : {}),
      ...(fm.board ? { board: fm.board } : {}),
      ...gp,
      ...(promotePlan ? { promotePlan: true } : {}),
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
      if (app.onNavigate) {
        app.onNavigate(
          groupAnchored
            ? `#/group/${encodeURIComponent(groupId || '')}?task=${encodeURIComponent(newId)}`
            : `#/dir/${encodeURIComponent(landedKey || '')}?task=${encodeURIComponent(newId)}`
        );
      }
      setDirty(false);
      clearHistory(histRef.current, newDocId);
      toast(`已改归属项目：任务迁到「${res.name}」#${newId}${res.promoted ? ' · 已转待领取' : ''}`);
      refreshLocal?.();
      return;
    }
    persistAtt(task, doc.attachments);
    saveDoc(id, { title: t, body: b });
    setDirty(false);
    clearHistory(histRef.current, id);
    toast(
      res.promoted
        ? '已保存并转为待领取'
        : gp.clearGoal
          ? '已同步 MD · 时间目标已清除'
          : gp.duration
            ? '已同步 MD · 时间目标已更新'
            : '已同步 MD',
    );
    refreshLocal?.();
  }), [doc, id, task, topicKey, topic, groupAnchored, groupId, app, model, tabId, refreshLocal, histRef, setDirty, composeText, goalPatchOf, guard, toast, taskRow, fixedDraft]);

  const importMd = useCallback(async (file: File) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await addTask({ cwd: topic?.cwd, text: bodyText });
      toast(`已导入：${file.name}`);
      refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `#${newId}` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `#${newId}` });
      }
    });
  }, [groupAnchored, docFm.project, topic?.cwd, topicKey, groupId, app, refreshLocal, guard, toast]);

  const delTask = useCallback(async () => {
    if (!doc) return;
    const title = doc.title || `#${task}`;
    const ok = await dialog({
      title: `删除任务「${title}」`,
      message: '软删除：可在回收站找回（更多 → 回收站）。',
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    guard(async () => {
      await removeTaskItem({ cwd: topic?.cwd, id: Number(task) });
      toast(`已删除「${title}」`);
      // #191：删除后**不拆面板**——maincontent 永远不会被删除。主布局里的任务页
      // 就地导航回父级（组页 / 目录页 / 全局），路由 effect 会用 openPanel 换内容，
      // 面板壳一直活着（原来 deleteTab 会把整块面板删掉，主区直接空掉）；
      // 浮窗与旁路原文是辅助视图，维持原行为：直接关掉。
      const node = (tabId && (model || app.model || null)?.getNodeById?.(tabId)) as
        | { getConfig?: () => Record<string, unknown>; getWindowId?: () => string }
        | undefined;
      const cfg = (node && node.getConfig && node.getConfig()) || {};
      const auxiliary =
        (typeof node?.getWindowId === 'function' && node.getWindowId() === 'float') || !!cfg.beside;
      if (auxiliary || !app.onNavigate) {
        if (model && tabId) model.doAction(Actions.deleteTab(tabId));
      } else if (groupAnchored) {
        app.onNavigate('#/group/' + encodeURIComponent(groupId || ''));
      } else {
        app.onNavigate('#/dir/' + encodeURIComponent(topicKey || ''));
      }
      refreshLocal?.();
    });
  }, [doc, task, topic, model, tabId, app, groupAnchored, groupId, topicKey, refreshLocal, guard, toast, dialog]);

  // #184：正在跑（claimed）的任务以前在面板上是死路——工具栏连「标为完成」都不渲染，
  // 只能干等 agent 自己回执。现在 claimed 也能收：用户是最终验收方，agent 稍后的 done
  // 会命中服务端的幂等分支，不会报错。
  // 「取消」仍只给待领取：取消是丢弃，误伤正在跑的会话代价更高，留给 agent 侧回执。
  const taskStatus = String(taskRow?.status ?? '');
  const canComplete = !!taskRow && (taskStatus === 'pending' || taskStatus === 'claimed');
  const canCancel = !!taskRow && taskStatus === 'pending';
  const canCloseTask = canComplete || canCancel;
  const closeTask = useCallback((kind: string) => {
    if (kind === 'done' ? !canComplete : !canCancel) return;
    guard(async () => {
      const title = doc?.title || `#${task}`;
      const scope = { cwd: topic?.cwd };
      if (kind === 'done') {
        const claimed = taskStatus === 'claimed';
        const who = String(taskRow?.claimedByName || taskRow?.claimedBy || '').trim();
        const summary = await dialog({
          title: `标为完成「${title}」`,
          message: claimed
            ? `该任务正被${who ? ` ${who} ` : ' agent '}领取中。你是最终验收方——确认它已经做完、直接标为完成？可写一句完成总结（agent 稍后的回执会被忽略，不算冲突）。`
            : '任务还没被领取。确认把当前正文视为已完成？可写一句完成总结。',
          input: true,
          placeholder: '完成总结（可选；留空使用默认说明）',
          okText: '标为完成',
        });
        if (summary === null || summary === undefined) return;
        await closeManyTasks({ ...scope, ids: [Number(task)], status: 'done', summary: String(summary).trim() });
        toast(`已标为完成 #${task}`);
      } else {
        const ok = await dialog({
          title: `取消任务「${title}」`,
          message: '只处理待领取任务。取消为终态，原文留档。',
          danger: true,
          okText: '取消任务',
        });
        if (!ok) return;
        await closeManyTasks({ ...scope, ids: [Number(task)], status: 'cancelled' });
        toast(`已取消 #${task}`);
      }
      refreshLocal?.();
    });
  }, [canComplete, canCancel, doc, task, topic, taskStatus, taskRow, refreshLocal, guard, toast, dialog]);

  // 固定草稿态：plan 和 pending 都显示；打开 = 转 plan + 固定，关闭 = 只取消固定。
  const canFixedDraft = !!taskRow && (taskStatus === 'pending' || taskStatus === 'plan');
  const toggleFixedDraft = useCallback(() => {
    if (!canFixedDraft) return;
    const next = !fixedDraft;
    guard(async () => {
      await setPlanStatus({
        cwd: topic?.cwd,
        id: Number(task),
        ...(next ? { to: 'plan' as const, fixed: true } : { fixed: false }),
      });
      setFixedDraft(next);
      refreshLocal?.();
      toast(next ? '已固定为草稿：保存后仍留在草稿态' : '已取消固定：下次保存转为待领取');
    });
  }, [canFixedDraft, fixedDraft, setFixedDraft, task, topic, guard, refreshLocal, toast]);

  const addFiles = useCallback(async (fileList: FileList | File[], opts: { mode?: string } = {}) => {
    if (!doc) return;
    const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
    const cur: DocState = peekDoc(id) || doc;
    const b = cur.body || '';
    const imgIns = imageInserts.join('');
    let body = b;
    let caretAt: number | null = null;
    if (imgIns) {
      const placed = insertAttachmentSnippet(b, imgIns, opts);
      body = placed.body;
      caretAt = placed.insertAt + imgIns.length;
    }
    if (fileInserts.length) {
      body = insertAttachmentSnippet(body, fileInserts.join(''), {}).body;
    }
    const patch: Partial<DocState> = {};
    if (body !== b) patch.body = body;
    if (items.length) patch.attachments = [...(cur.attachments || []), ...items];
    if (!Object.keys(patch).length) return;
    saveDoc(id, patch);
    if (opts.mode === 'edit' && caretAt != null) {
      requestAnimationFrame(() => {
        editorApiRef.current?.focus?.();
        const ta = document.querySelector<HTMLTextAreaElement>('.mdw-editor');
        if (ta) {
          try { ta.setSelectionRange(caretAt, caretAt); } catch { /* ignore */ }
        }
      });
    }
    if (patch.attachments) persistAtt(task, patch.attachments);
    const synced = composeText(cur.title, patch.body || body);
    saveDoc(id, { body: synced, title: titleFromMd(synced) });
    try {
      await patchTaskItem({
        cwd: topic?.cwd,
        id: Number(task),
        text: synced,
    });
      setDirty(false);
      refreshLocal?.();
      toast(items.length ? `已添加附件并同步（${items.length}）` : '已同步附件');
    } catch (e) {
      markDirty();
      toast(`附件已插入，同步失败：${(e as Error).message || e}`);
    }
  }, [doc, id, task, topic, setDirty, refreshLocal, markDirty, composeText, editorApiRef, toast]);

  /**
   * 「新任务」：与目录页「＋ 新建页」同一口径——先执行本主题的默认 pretask 入口。
   * 面板入口直接进插件页；带 form 的草稿入口进参数页；普通草稿按插件正文落库。
   */
  const newTask = useCallback(() => {
    const navigate = (hash: string) => app.onNavigate?.(hash);
    const ctx: PretaskContext = entryCtx || { topicKey };
    if (defaultEntry?.kind === 'panel') {
      openPanelEntry(defaultEntry, ctx, navigate);
      return;
    }
    if (defaultEntry && openDraftEntry(defaultEntry, ctx, navigate)) return;
    guard(async () => {
      const draft = defaultEntry
        ? await pretaskDraft(defaultEntry.id, defaultEntry.values || {}, {
            topic: topicKey,
            group: String(ctx.groupKey || ''),
            repo: String(ctx.repoKey || ''),
          })
        : null;
      await createTaskAndOpen(
        { openPage: app.openPage, refreshLocal },
        {
          text: String(draft?.body || ''),
          title: String(draft?.title || ''),
          status: 'plan',
          ...(groupAnchored
            ? {
                groupId,
                board: String(ctx.board || (boardCtx && boardCtx.board ? boardCtx.board.id : '') || ''),
                project: String(ctx.project || docFm.project || ''),
              }
            : { dirKey: topicKey, cwd: topic?.cwd || '' }),
        },
      );
    });
  }, [boardCtx, defaultEntry, docFm.project, entryCtx, groupAnchored, groupId, topicKey, topic?.cwd, app, refreshLocal, guard]);

  /** 「更多 → 克隆任务」：以当前任务为模板快速复制一条新任务（#70）。 */
  const cloneCur = useCallback(() => {
    if (task == null) {
      toast('没有可克隆的任务');
      return;
    }
    guard(async () => {
      const res = await cloneTask({ id: Number(task), cwd: topic?.cwd });
      toast(`已克隆为新任务 #${res.task?.id ?? res.id}`);
      refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
      }
    });
  }, [task, topic, groupAnchored, groupId, topicKey, app, doc, refreshLocal, guard, toast]);

  /** 「更多 → Fork 任务」：clone 的原文复制 + 保留源任务链（#67）。 */
  const forkCur = useCallback(() => {
    if (task == null) {
      toast('没有可 Fork 的任务');
      return;
    }
    guard(async () => {
      const res = await forkTask({ id: Number(task), cwd: topic?.cwd });
      toast(`已 Fork 为新任务 #${res.task?.id ?? res.id}（保留任务链）`);
      refreshLocal?.();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（Fork）` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（Fork）` });
      }
    });
  }, [task, topic, groupAnchored, groupId, topicKey, app, doc, refreshLocal, guard, toast]);

  const openProgress = useCallback(() => {
    const m = model || app.model;
    if (!m) return;
    const boardId = docFm && docFm.board ? String(docFm.board) : '';
    openPanel(m, {
      component: 'progress',
      name: '进程',
      config: boardId
        ? { groupKey: boardId, task: task != null ? String(task) : undefined }
        : { dirKey: topicKey, task: task != null ? String(task) : undefined },
      location: 'right',
    });
  }, [model, app.model, docFm, task, topicKey]);

  const openAttachPanel = useCallback(() => {
    showDockTab('attach');
    setTimeout(() => attachAreaRef.current?.open(), 0);
  }, [showDockTab, attachAreaRef]);

  return {
    composeText, goalPatchOf, submit, importMd, delTask,
    canComplete, canCancel, canCloseTask, closeTask,
    canFixedDraft, fixedDraft, toggleFixedDraft,
    addFiles, newTask, cloneCur, forkCur, openProgress, openAttachPanel,
  };
}
