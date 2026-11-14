// MD 页签面板 —— 一个 MD 页 = 工作区里的一等页签。
//
// 面板化之后，原来的「工作台内部页签栏」没了：开哪几页、在哪开、能不能并排，
// 都由工作区布局管（可拖拽 / 可拆分 / 可浮出）。这个面板只管**一页的内容**：
// 编辑、保存/提交、附件、撤销重做、划选浮条。
//
// 文档内容存在会话内存（doc-store.js），页签身份在 FlexLayout 模型里——
// 两者分工明确：布局归布局，内容归内容。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import { getTaskAttachments, previewTask } from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import { extractAckNodes } from '../../modules/board/ack-nodes.js';
import ToolBar from '../../components/md/tool-bar.jsx';
import { MdPanes } from '../../components/md/md-panes.jsx';
import AckRail from '../../components/md/ack-rail.jsx';
import SelMenu from '../../components/md/sel-menu.jsx';
import { openComposer } from '../../components/md/composer-launch.js';
import ShortcutSheet from '../../components/md/shortcut-sheet.jsx';
import { TaskChainModal as TaskChainModalRaw } from '../../components/md/task-chain.jsx';
import { useApp } from '../../app-context.jsx';
import { openBesideMain } from '../../workspace.js';
import { persistAtt } from '../../components/md/attachments.js';
import type { Attachment } from '../../components/md/attach-common.js';
import type { AttachAreaHandle } from '../../components/md/attach-area.jsx';
import { pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import {
  liveBodyBlocks,
  titleFromMd,
  stripTitleHeading,
  withFrontmatter,
} from '../../modules/md/md-parse.js';
import {
  docIdOf,
  getDoc,
  isDraftTask,
  saveDoc,
  scopeOf,
  useDocs,
} from '../../modules/md/doc-store.js';
import type { LocalTask, LocalTopic } from '../../types.js';
import { useDock } from './task-dock.js';
import { useGoal } from './task-goal.js';
import { useChain } from './task-chain.js';
import { useSelMenu } from './task-sel-menu.js';
import { useAck } from './task-ack.js';
import { useTaskActions } from './task-actions.js';
import { useFeedback } from './task-feedback.js';
import { useDerivedCtx } from './task-derived-ctx.js';
import { PreviewModal } from './task-preview-modal.jsx';
import { DockPanel } from './task-dock-panel.jsx';
import { StatusBar } from './task-status-bar.jsx';
import { goalSection } from './task-goal-section.jsx';
import { HistoryView } from './task-history-view.jsx';
import { BoardSection } from './task-board-section.jsx';
import { NotFoundView } from './task-not-found.jsx';
import { BesideHeader } from './task-beside-header.jsx';
import { findGroupTask, renderMarkdownHtml } from './task-utils.js';
import type { ChainNode, DocState, EditorApi, GroupResolved, HistorySnapshot, PreviewState } from './task-utils.js';

interface PagePanelProps {
  dirKey?: string;
  groupId?: string;
  /** 任务号（路由 ?task=N）。**声明为必填是历史契约**：面板 config 是外部边界，
     缺省时由 panels.tsx 的 `any` 流进来（与旧 JS 完全一致），内部按「查不到这条任务」处理。 */
  task: string;
  beside?: boolean;
  tabId?: string;
  model?: Model | null;
  historyId?: number | null;
}

/**
 * 链弹窗的节点类型（components/md/task-chain.tsx）与本页展示态同形但字段全可选：
 * 入参方向不兼容，按实际契约桥接一次，运行期仍是同一批节点对象。
 */
const TaskChainModal = TaskChainModalRaw as unknown as (props: {
  open: boolean;
  nodes: ChainNode[];
  onOpenNode?: (n: ChainNode) => void;
  onClose?: () => void;
}) => ReactNode;

export default function PagePanel({ dirKey, groupId, task, beside = false, tabId, model, historyId = null }: PagePanelProps) {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;

  // 组锚定页（#86）：dirKey 缺席、groupId 在场——路由是 #/group/<boardId>?task=N，
  // 这条任务物理上落在哪个成员队列，在这里搜出来（优先 boardMark 指向本组的候选，
  // 与组页「本组任务」同口径）。队列数据（rows 轮询）到位前解析为空，随后自然补上。
  const groupAnchored = !!(groupId && !dirKey);
  const groupResolved = useMemo<GroupResolved | null>(
    () => (groupAnchored ? findGroupTask(rows, (app.repoData && app.repoData.boards) || [], groupId, task) : null),
    [groupAnchored, rows, app.repoData, groupId, task]
  );
  // 本页所属队列的 key：组锚定 = 解析出的成员队列；目录锚定 = dirKey
  const topicKey = (groupResolved && groupResolved.topic && groupResolved.topic.key) || dirKey || '';

  const isGlobal = !groupAnchored && (!topicKey || topicKey === GLOBAL_KEY);
  const isDraft = isDraftTask(task);
  // 文档作用域（#86）：组锚定的**草稿**种在组 scope——组页「新增任务」从组路由
  // 打开能寻回同一份；其余（实任务 / 目录页）都在队列 scope，同一任务两种锚共享一份文档。
  const scope: string = groupAnchored && isDraft ? scopeOf(groupId) : scopeOf(topicKey);
  const id = docIdOf(scope, task);

  // 本目录的主题（提交/删除要它的 cwd）
  const topic = useMemo<LocalTopic | null>(() => {
    if (groupAnchored) return (groupResolved && groupResolved.topic) || null;
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === topicKey) || null;
  }, [rows, topicKey, isGlobal, groupAnchored, groupResolved]);

  const taskRow = useMemo<LocalTask | null>(
    () => (topic?.tasks || []).find((x) => String(x.id) === String(task)) || null,
    [topic, task]
  );

  // doc-store 的快照形状尚未类型化（useDocs 被推断成 {}）：按契约收口为 docId → 文档
  const docs = useDocs() as Record<string, DocState | undefined>;
  const doc = docs[id] || null;
  // #47：撤掉「阅读」模式——老草稿里存过的 preview 一律按实时预览处理，只有 edit 是源码态
  const editorMode = doc && doc.mode === 'edit' ? 'edit' : 'split';

  // ─── 钩子状态 ───
  const dock = useDock();
  const { dockOpen, setDockOpen, dockTab, dockH, dockRef, dockMax, showDockTab, onDockDragStart, toggleDockMax } = dock;

  const goalState = useGoal({ id, isDraft, topicKey, task, taskRow });
  const { goalDraft, setGoalDraft, goal, goalEditable, goalPromptEditable, declaredGoal, goalLog, loadGoalLog, canShowGoalLog } = goalState;

  const chainState = useChain({
    isDraft, task, taskRow, topicKey, topic, isGlobal, groupAnchored, groupId,
    app, model: model || null, historyId, toast,
  });
  const { chainNodes, historyNode, isChainTip, latestChild, openLatestRound, openHistoryBeside } = chainState;

  const selMenuState = useSelMenu({ id });
  const { selMenu, setSelMenu, lastSel, placeSelMenu, onEditorTextSel, closeSelMenu } = selMenuState;

  const ackState = useAck({ id, taskRow, dockTab, dockOpen });
  const { ackOpen, setAckOpen, ackOverflow, reviewSumRef, ackLong } = ackState;

  // ─── 本地状态 ───
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileMdRef = useRef<HTMLInputElement | null>(null);
  const fileAttRef = useRef<HTMLInputElement | null>(null);
  const attachAreaRef = useRef<AttachAreaHandle | null>(null);
  const articleRef = useRef<HTMLDivElement | null>(null);
  const reviewBarRef = useRef<HTMLDivElement | null>(null);
  const editorApiRef = useRef<EditorApi | null>(null);
  const histRef = useRef<Map<string, HistorySnapshot>>(new Map());

  // #168：ref 引用在正文里显示**文档标题**（用户在文档里填的标题）——
  // 需要服务端附件清单里的 ref 条目（标题是服务端读盘补的）。
  const [refAtts, setRefAtts] = useState<Attachment[]>([]);
  useEffect(() => {
    let alive = true;
    const t = taskRow;
    if (!t || !t.id) return undefined;
    const q = new URLSearchParams({ id: String(t.id) });
    if (topicKey) q.set('key', topicKey);
    else if (t.cwd) q.set('cwd', t.cwd);
    getTaskAttachments(q.toString())
      .then((d) => { if (alive) setRefAtts((d && (d.attachments || d.data?.attachments)) || []); })
      .catch(() => { if (alive) setRefAtts([]); });
    return () => { alive = false; };
  }, [taskRow, topicKey]);

  // 阅读视图：剥掉首个一级标题行——它就是文档标题（页头已渲染），正文再渲染一遍是重复
  const previewHtml: string = useMemo(
    () => (doc ? renderMarkdownHtml(stripTitleHeading(doc.body), refAtts.length ? refAtts : doc.attachments) : ''),
    [doc, refAtts]
  );
  // 验收条 ack：agent 完成总结常带 md（加粗/列表/标题）——按正文同一套渲染，不要当纯文本。
  const ackHtml = useMemo(
    () => (taskRow?.roundSummary ? renderMarkdownHtml(taskRow.roundSummary) : ''),
    [taskRow?.roundSummary]
  );

  // ack 定位轨（任务 #48）：反复 ack 反馈的长任务页，按轮次快速跳转。
  const ackNodes = useMemo(() => (doc ? extractAckNodes(doc.body) : []), [doc && doc.body]);
  const [ackScrollRoot, setAckScrollRoot] = useState<Element | null>(null);
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return undefined;
    const pick = () => root.closest('.mdw-lp') || root.closest('.mdw-preview') || null;
    setAckScrollRoot(pick());
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => setAckScrollRoot(pick())) : null;
    mo?.observe(root, { childList: true, subtree: true });
    return () => mo?.disconnect();
  }, [doc && doc.mode]);

  const guard = useCallback((fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e))), [toast]);
  const markDirty = useCallback(() => setDirty(true), []);

  const { docFm, parentRef, boardCtx } = useDerivedCtx({ doc, beside, topicKey, topic, task, app });

  // 首开这一页时把内容「种」进去：真实任务用服务端正文，草稿用默认模板
  useEffect(() => {
    if (docs[id]) return;
    if (isDraft) {
      getDoc(id, {
        title: '',
        body: tpl
          ? (groupAnchored ? withFrontmatter(tpl.defaultBody(), { board: groupId }) : tpl.defaultBody())
          : '',
      });
    } else if (taskRow) getDoc(id, { title: titleFromMd(taskRow.text), body: taskRow.text });
  }, [id, isDraft, taskRow, groupAnchored, groupId]);

  // ─── 动作钩子 ───
  const actions = useTaskActions({
    doc, id, isDraft, task, taskRow, topicKey, topic, isGlobal, boardCtx, docFm,
    groupAnchored, groupId, rows, app, model: model || null, tabId, tpl, refreshLocal,
    markDirty, histRef, editorApiRef, attachAreaRef,
    setDirty,
    goal, goalEditable, goalPromptEditable, declaredGoal, guard, dialog, showDockTab,
  });
  const { composeText, submit, importMd, delTask, canComplete, canCancel, closeTask, canPlan, togglePlan, addFiles, newTask, cloneCur, forkCur, openProgress, openAttachPanel } = actions;

  const feedback = useFeedback({
    doc, isDraft, task, taskRow, topicKey, topic, isGlobal, dirKey,
    groupAnchored, groupId, app, model: model || null, tabId, refreshLocal,
    closeSelMenu, lastSel, selMenu, dirty, setDirty, guard,
  });
  const { openFeedback, submitCommentInPlace, openCommentFromToolbar } = feedback;

  // ─── 时间目标 UI（#78）───
  const openGoalLog = useCallback(() => {
    showDockTab('check');
    loadGoalLog();
  }, [showDockTab, loadGoalLog]);

  const { goalBadge, goalMenu } = goalSection({
    goal, goalDraft, setGoalDraft, goalEditable, goalPromptEditable, declaredGoal, openGoalLog, markDirty, task,
  });

  // ─── 预览提示词（任务 #65）───
  const openPreview = useCallback(() => {
    setPreview({ busy: true });
    const body = {
      cwd: isGlobal ? (topic?.cwd || undefined) : topic?.cwd,
      key: isGlobal ? GLOBAL_KEY : topicKey,
      ...(isDraft
        ? { text: composeText((doc?.title || '').trim() || '未命名任务', doc?.body || '') }
        : { id: Number(task) }),
    };
    previewTask(body)
      .then((d) => setPreview({ data: d }))
      .catch((e) => setPreview({ error: String((e as Error).message || e) }));
  }, [isGlobal, topic?.cwd, topicKey, isDraft, doc?.title, doc?.body, task, composeText]);

  // ─── 标题与正文双向同步 ───
  const onTitle = (next: string, kind = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch: Partial<DocState> = { title: next };
    if (editorMode !== 'split' && /^# (?!#)/m.test(doc.body)) {
      patch.body = doc.body.replace(/^# (?!#).+$/m, `# ${next || '未命名任务'}`);
    }
    saveDoc(id, patch);
  };

  const onBody = (next: string, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch: Partial<DocState> = { body: next };
    if (editorMode !== 'split') patch.title = titleFromMd(next);
    saveDoc(id, patch);
  };

  const undo = () => {
    if (!doc) return;
    const snap = undoHistory(histRef.current, id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(id, { title: snap.title, body: snap.body });
    markDirty();
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  const redo = () => {
    if (!doc) return;
    const snap = redoHistory(histRef.current, id, { title: doc.title, body: doc.body });
    if (!snap) return;
    saveDoc(id, { title: snap.title, body: snap.body });
    markDirty();
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  // ─── 划选浮条（#124 跨块选区）───
  // ⚠️ 测试断言依赖 task.jsx 内出现 blockRange / liveBodyBlocks(doc.body) / deleteBlockRange 字样，
  // 故 onPreviewMouseUp 与 SelMenu 的 onCopy/onDelete 保持在本文件内联。
  const onPreviewMouseUp = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!doc || editorMode === 'edit') return;
    // DOM 事件目标是外部边界：按 Element 取 closest
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('#mdw-sel-menu')) return;
    if (target?.closest('textarea')) return;
    const sel = window.getSelection();
    const text = String(sel || '').trim();
    if (!text || text.length < 1) {
      setSelMenu(null);
      return;
    }
    // 有选中文本时 sel 必不为 null（上面的 text 判空已经兜住）
    if (!sel) return;
    if (!articleRef.current?.contains(sel.anchorNode)) {
      setSelMenu(null);
      return;
    }
    // 跨块选区（#124）：两端落在不同视图块 → 记下触到的块区间，浮层多给
    // 「删除选区」（块粒度整段移除）与「复制」（整段 Markdown 源码）。
    const elOf = (n: Node | null): Element | null => (n?.nodeType === 3 ? n.parentElement : (n as Element | null));
    const bA = elOf(sel.anchorNode)?.closest?.('.mdw-lp-block');
    const bF = elOf(sel.focusNode)?.closest?.('.mdw-lp-block');
    let blockRange: [number, number] | null = null;
    if (bA && bF && bA !== bF && articleRef.current?.contains(bF)) {
      const na = Number(bA.getAttribute('data-i'));
      const nf = Number(bF.getAttribute('data-i'));
      if (Number.isInteger(na) && Number.isInteger(nf) && na !== nf) {
        blockRange = [Math.min(na, nf), Math.max(na, nf)];
      }
    }
    // 锚定**选区末行**（松手处）：跨块/跨行划选以前按整段选区的包围盒居中偏下，
    // 浮层落在离手很远的地方（#92「划线跨行不丝滑」）
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    placeSelMenu('task', text, last.right - 60, last.bottom + 8, blockRange ? { blockRange } : {});
  };

  const openParentBeside = useCallback(() => {
    if (!parentRef) {
      toast('这条任务没有可定位的原文');
      return;
    }
    const m = model || app.model;
    if (!m) return;
    openBesideMain(m, {
      component: 'page',
      name: parentRef.name || `原文 ${parentRef.task}`,
      config: { dirKey: parentRef.dirKey, task: String(parentRef.task) },
    });
  }, [parentRef, model, app.model, toast]);

  const closeBesideSelf = useCallback(() => {
    const m = model || app.model;
    if (!m || !tabId) return;
    m.doAction(Actions.deleteTab(tabId));
  }, [model, app.model, tabId]);

  const pickAtt = (accept: string) => {
    if (fileAttRef.current) fileAttRef.current.accept = accept;
    fileAttRef.current?.click();
  };

  // Ctrl/⌘ ⇧ O：评论任务并排打开原文（#37）——编辑态也放行，不与常见编辑快捷键冲突
  useEffect(() => {
    if (!parentRef || beside) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (String(e.key || '').toLowerCase() !== 'o') return;
      e.preventDefault();
      openParentBeside();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [parentRef, beside, openParentBeside]);

  // 链节点旁路：只读展示 history 快照（不占编辑文档）
  if (historyId != null) {
    return <HistoryView historyId={historyId} historyNode={historyNode} closeBesideSelf={closeBesideSelf} />;
  }

  // 读不到文档分两种：**还在读**（队列首轮没回来）与**确实没有这一条**（被删 / 深链写错）。
  if (!doc) {
    if (app.localReady === false || isDraft) {
      return <div className="mdw"><div className="pad muted">载入中…</div></div>;
    }
    return <NotFoundView task={task} app={app} groupAnchored={groupAnchored} groupId={groupId} isGlobal={isGlobal} dirKey={dirKey} />;
  }

  return (
    <div className={`mdw${beside ? ' is-beside' : ''}`} data-mode={editorMode} onMouseUp={onPreviewMouseUp}>
      {dialogNode}
      {preview && <PreviewModal state={preview} onClose={() => setPreview(null)} />}
      <TaskChainModal
        open={chainOpen}
        nodes={chainNodes}
        onOpenNode={openHistoryBeside}
        onClose={() => setChainOpen(false)}
      />
      {beside && <BesideHeader onClose={closeBesideSelf} />}
      <div className="mdw-main">
        <div className="mdw-top">
          <RouteBreadcrumb />
          <div className="mdw-head">
            <div className="mdw-title">{isDraft ? (doc.title || '新 MD 任务') : (doc.title || '任务')}</div>
            <div className="mdw-path">
              {isGlobal ? '全局任务池' : (topic?.cwd || topic?.name || '—')}
              {isDraft ? ` / (${task})` : ` / #${task}`}
              {dirty ? ' · 未保存' : ''}
            </div>
          </div>
        </div>

        <BoardSection boardCtx={boardCtx} docFm={docFm} goalEditable={goalEditable} doc={doc} id={id} markDirty={markDirty} />

        <ToolBar
          mode={editorMode}
          onMode={(m: string) => saveDoc(id, { mode: m })}
          showMark={editorMode !== 'edit'}
          submitLabel={isDraft ? '提交为任务' : '保存并同步'}
          onNew={newTask}
          onSubmit={submit}
          onChain={isDraft ? null : () => setChainOpen(true)}
          onPreview={openPreview}
          onImg={() => pickAtt('image/*')}
          onAtt={() => (isDraft ? pickAtt('image/*,.pdf,.zip,.txt,.json,.csv') : openAttachPanel())}
          onImport={() => fileMdRef.current?.click()}
          onClone={isDraft ? null : cloneCur}
          onFork={isDraft ? null : forkCur}
          onComplete={canComplete ? () => closeTask('done') : null}
          onPlan={canPlan ? togglePlan : null}
          planLabel={String(taskRow?.status || '') === 'plan' ? '转回待领取' : '转为草稿（plan）'}
          onCancelTask={canCancel ? () => closeTask('cancel') : null}
          onMark={openCommentFromToolbar}
          onDraft={() => toast('草稿随页签保留（刷新后需从侧栏或页签重新打开）')}
          onDelete={isDraft ? null : delTask}
          onOverview={() => app.onNavigate && app.onNavigate('#/overview')}
          onProg={openProgress}
          onSource={parentRef ? openParentBeside : null}
          onShortcuts={() => setShowShortcuts(true)}
          goalBadge={goalBadge}
          goalMenu={goalMenu}
        />

        <MdPanes
          ref={articleRef}
          mode={editorMode}
          title={doc.title}
          body={doc.body}
          previewHtml={previewHtml}
          onTitle={onTitle}
          onBody={onBody}
          attachments={refAtts.length ? [...doc.attachments, ...refAtts] : doc.attachments}
          docKey={id}
          editorApiRef={editorApiRef}
          onFiles={addFiles}
          onTextSel={onEditorTextSel}
          onSave={submit}
          onUndo={undo}
          onRedo={redo}
          onCloseSelMenu={closeSelMenu}
          attachHost={isDraft ? null : {
            host: 'task',
            hostId: Number(task),
            hostKey: isGlobal ? GLOBAL_KEY : undefined,
            hostCwd: isGlobal ? undefined : topic?.cwd,
            allow: { file: true, url: true, task: true, ref: true },
            taskOptions: (topic?.tasks || []).map((t: LocalTask) => ({ id: t.id, text: t.text, status: t.status })),
          }}
        />

        <DockPanel
          dockOpen={dockOpen} dockTab={dockTab} dockH={dockH} dockRef={dockRef} dockMax={dockMax}
          showDockTab={showDockTab} onDockDragStart={onDockDragStart} toggleDockMax={toggleDockMax} setDockOpen={setDockOpen}
          canShowGoalLog={canShowGoalLog} goalLog={goalLog} openGoalLog={openGoalLog}
          isDraft={isDraft} task={task} topic={topic} topicKey={topicKey} isGlobal={isGlobal} doc={doc} id={id} model={model || null} app={app}
          refreshLocal={refreshLocal} markDirty={markDirty} saveDoc={saveDoc} persistAtt={persistAtt}
          attachAreaRef={attachAreaRef} reviewBarRef={reviewBarRef} reviewSumRef={reviewSumRef}
          taskRow={taskRow} ackOpen={ackOpen} setAckOpen={setAckOpen} ackOverflow={ackOverflow} ackLong={ackLong} ackHtml={ackHtml}
          isChainTip={isChainTip} latestChild={latestChild} openFeedback={openFeedback} openLatestRound={openLatestRound}
          attachments={refAtts.length ? refAtts : doc.attachments}
        />

        <StatusBar
          dockOpen={dockOpen} dockTab={dockTab} showDockTab={showDockTab} setDockOpen={setDockOpen}
          canShowGoalLog={canShowGoalLog} goalLog={goalLog} openGoalLog={openGoalLog}
          isDraft={isDraft} taskRow={taskRow}
          mdCount={(refAtts.length ? refAtts : doc.attachments).filter((a) => a.kind === 'mdfile').length}
        />
      </div>

      <AckRail nodes={ackNodes} scrollRoot={ackScrollRoot} />

      <SelMenu
        at={selMenu}
        onFormat={(op: string) => {
          editorApiRef.current?.format?.(op);
          closeSelMenu();
        }}
        onCompose={() => {
          const m = model || app.model;
          if (!m) return;
          const quote = String(selMenu?.text || lastSel.current || '');
          openComposer(m, {
            mode: 'comment',
            quote,
            taskLabel: task != null ? '#' + task : '',
            taskTitle: String(doc?.title || '').replace(/^#+\s*/, ''),
            src: { dirKey: topicKey || dirKey || GLOBAL_KEY, task: String(task), name: `原文 #${task}` },
            onSubmit: (payload: { text?: string; attachments?: Attachment[]; inserts?: string }) => submitCommentInPlace({ ...payload, quote }),
          });
          closeSelMenu();
        }}
        onCopy={() => {
          // 跨块选区（#124）：复制整段块的 Markdown 源码（粘回任务不丢格式）；
          // 单块选区维持原行为（复制渲染后的文字）。
          const br = selMenu?.blockRange;
          let payload = '';
          if (br && doc) {
            const blocks: string[] = liveBodyBlocks(doc.body);
            if (br[1] < blocks.length) {
              payload = blocks
                .slice(br[0], br[1] + 1)
                .filter((b: string) => String(b ?? '').trim())
                .join('\n\n');
            }
          }
          navigator.clipboard?.writeText(payload || lastSel.current || selMenu?.text || '');
          toast('已复制');
          closeSelMenu();
        }}
        onDelete={
          selMenu?.blockRange
            ? () => {
                const br = selMenu.blockRange;
                if (!br) return;
                const ok = editorApiRef.current?.deleteBlockRange?.(br[0], br[1]);
                if (ok) toast(`已删除 ${br[1] - br[0] + 1} 个块（Ctrl+Z 可撤销）`);
                else toast('选区已失效');
                closeSelMenu();
              }
            : undefined
        }
      />

      <input
        ref={fileAttRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          // ⚠️ 先拷贝再清 value：FileList 是活引用，`value = ''` 会把它清空
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) addFiles(files);
        }}
      />
      <input
        ref={fileMdRef}
        type="file"
        accept=".md,text/markdown,text/plain"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) importMd(f);
        }}
      />
      {showShortcuts && <ShortcutSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
