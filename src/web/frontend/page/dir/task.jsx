// MD 页签面板 —— 一个 MD 页 = 工作区里的一等页签。
//
// 面板化之后，原来的「工作台内部页签栏」没了：开哪几页、在哪开、能不能并排，
// 都由工作区布局管（可拖拽 / 可拆分 / 可浮出）。这个面板只管**一页的内容**：
// 编辑、保存/提交、附件、撤销重做、划选浮条。
//
// 文档内容存在会话内存（doc-store.js），页签身份在 FlexLayout 模型里——
// 两者分工明确：布局归布局，内容归内容。
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { Modal, useDialog } from '../../components/popup/index.jsx';
import { GLOBAL_KEY, findGroupTask } from '../../modules/board/board-view.js';
import {
  buildReopenText,
  FEEDBACK_HEADING,
  PLAIN_FEEDBACK_HEADING,
  quoteBlock,
} from '../../modules/board/reopen-text.js';
import { extractAckNodes } from '../../modules/board/ack-nodes.js';
import ToolBar from '../../components/md/tool-bar.jsx';
import { MdPanes } from '../../components/md/md-panes.jsx';
import AckRail from '../../components/md/ack-rail.jsx';
import AttachBar from '../../components/md/attach-bar.jsx';
import SelMenu from '../../components/md/sel-menu.jsx';
import ShortcutSheet from '../../components/md/shortcut-sheet.jsx';
import { TaskChainModal } from '../../components/md/task-chain.jsx';
import { useApp } from '../../app-context.jsx';
import { openBesideMain, openPanel } from '../../workspace.js';
import { filesToAttachments, persistAtt } from '../../components/md/attachments.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import {
  insertAttachmentSnippet,
  renderMarkdownHtml,
  slugName,
  titleFromMd,
  parseFrontmatter,
  stripFrontmatter,
  stripTitleHeading,
  withFrontmatter,
} from '../../modules/md/md-parse.js';
import {
  docIdOf,
  getDoc,
  isDraftTask,
  nextDraftId,
  peekDoc,
  promoteDoc,
  saveDoc,
  scopeOf,
  useDocs,
} from '../../modules/md/doc-store.js';

export default function PagePanel({ dirKey, groupId, task, beside = false, tabId, model, historyId = null }) {
  const app = useApp() || {};
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;

  // 组锚定页（#86）：dirKey 缺席、groupId 在场——路由是 #/group/<boardId>?task=N，
  // 这条任务物理上落在哪个成员队列，在这里搜出来（优先 boardMark 指向本组的候选，
  // 与组页「本组任务」同口径）。队列数据（rows 轮询）到位前解析为空，随后自然补上。
  const groupAnchored = !!(groupId && !dirKey);
  const groupResolved = useMemo(
    () => (groupAnchored ? findGroupTask(rows, (app.repoData && app.repoData.boards) || [], groupId, task) : null),
    [groupAnchored, rows, app.repoData, groupId, task]
  );
  // 本页所属队列的 key：组锚定 = 解析出的成员队列；目录锚定 = dirKey
  const topicKey = (groupResolved && groupResolved.topic && groupResolved.topic.key) || dirKey || '';

  const isGlobal = !groupAnchored && (!topicKey || topicKey === GLOBAL_KEY);
  const isDraft = isDraftTask(task);
  // 文档作用域（#86）：组锚定的**草稿**种在组 scope——组页「新增任务」从组路由
  // 打开能寻回同一份；其余（实任务 / 目录页）都在队列 scope，同一任务两种锚共享一份文档。
  const scope = groupAnchored && isDraft ? scopeOf(groupId) : scopeOf(topicKey);
  const id = docIdOf(scope, task);

  // 本目录的主题（提交/删除要它的 cwd）
  const topic = useMemo(() => {
    if (groupAnchored) return (groupResolved && groupResolved.topic) || null;
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === topicKey) || null;
  }, [rows, topicKey, isGlobal, groupAnchored, groupResolved]);

  const taskRow = useMemo(
    () => (topic?.tasks || []).find((x) => String(x.id) === String(task)) || null,
    [topic, task]
  );

  const docs = useDocs();
  const doc = docs[id] || null;
  // #47：撤掉「阅读」模式——老草稿里存过的 preview 一律按实时预览处理，只有 edit 是源码态
  const editorMode = doc && doc.mode === 'edit' ? 'edit' : 'split';

  // 时间目标（任务级 timegoal 声明）：草稿与未领取任务可设/改/清；已领取计时中的
  // 只读展示（领取即计时，声明是既成事实——要调先在目录页重开任务）。
  // goalDraft 为 null 表示「还没动过」——此时跟随服务端值（taskRow 可能晚于首轮渲染到）。
  const [goalDraft, setGoalDraft] = useState(null);
  useEffect(() => {
    setGoalDraft(null);
  }, [id]);
  const declaredGoal = taskRow?.timegoal || null;
  const goal = goalDraft || { duration: declaredGoal?.duration || '', prompt: declaredGoal?.prompt || '' };
  // 只有「待领取」能改时间目标声明（已领取在计时、已交付是终态；要改先 reopen）
  const goalEditable = isDraft || (!!taskRow && taskRow.status === 'pending');

  // ─── 验收条（完成任务）：agent 的完成总结（ack）+ 用户回复（通行 / 反馈 / 划线评论）───
  // 「通行」只在本机记一笔（localStorage，per-viewer 的轻量状态）：done 本身已是终态，
  // 验收与否不进队列 schema——「无更新则直接结束」的口径里，通行 = 不需要再做什么。
  // 「反馈」(#75)：**新开一条任务**（不是重做/就地重开），原完成任务留档不动。
  const reviewAckKey = `nx-kv/review/${scope}/${task}`;
  const [reviewAcked, setReviewAcked] = useState(() => {
    try {
      return localStorage.getItem(reviewAckKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    setReviewAcked(() => {
      try {
        return localStorage.getItem(reviewAckKey) === '1';
      } catch {
        return false;
      }
    });
  }, [reviewAckKey]);
  const ackReview = () => {
    try {
      localStorage.setItem(reviewAckKey, '1');
    } catch {
      /* 私隐模式等存不了就只在本次会话里认 */
    }
    setReviewAcked(true);
    toast('已验收');
  };
  /** 反馈：开评论框写意见；提交后**新建一条任务**（forkOf 指回本条），原任务不动。 */
  const openFeedback = () => {
    const bar = reviewBarRef.current;
    const host = bar?.closest?.('.mdw');
    const b = bar?.getBoundingClientRect();
    const h = host?.getBoundingClientRect();
    const x = b && h ? b.left - h.left + 80 : 80;
    const y = b && h ? b.top - h.top - 190 : 120;
    setSelMenu({
      kind: 'task',
      text: '',
      comment: true,
      mode: 'feedback',
      x: Math.min(window.innerWidth - 320, Math.max(8, x)),
      y: Math.min(window.innerHeight - 260, Math.max(8, y)),
    });
  };
  /** 统一提交入口：feedback → 新开任务；comment → 就地回写原任务（可带附件）。 */
  const onCommentSubmit = (payload) => {
    const p =
      payload && typeof payload === 'object'
        ? payload
        : {
            text: String(payload || ''),
            mode: selMenu?.mode === 'feedback' || selMenu?.mode === 'redo' ? 'feedback' : 'comment',
            quote: lastSel.current || '',
          };
    if (p.mode === 'feedback' || p.mode === 'redo' || selMenu?.mode === 'feedback' || selMenu?.mode === 'redo') {
      spawnFeedbackTask(p);
      return;
    }
    submitCommentInPlace(p);
  };
  /** 服务端当前任务（#79）：评论/反馈的 base 以**盘上正文**为准——会话 doc 可能
   *  过期（别的会话改过 / 上一轮重开追加过 / 首轮还没加载完），拿旧正文拼回去
   *  整篇重写就是「评论一次丢一次」。草稿没有服务端正文，返回 null。 */
  const fetchServerTask = async () => {
    if (isDraft || task == null || /^draft/i.test(String(task))) return null;
    const q = isGlobal
      ? `key=${encodeURIComponent(GLOBAL_KEY)}&id=${Number(task)}`
      : `cwd=${encodeURIComponent(topic?.cwd || '')}&id=${Number(task)}`;
    return api(`/api/localtasks/item?${q}`).catch(() => null);
  };
  /** 验收反馈 → 新开任务（#75）：正文 = 完整之前的任务 + 上轮总结 + 本轮反馈；
   *  forkOf 指回本条。#79：base 取服务端当前正文，取不到才退回会话 doc——
   *  两头都空就中止（真实任务），绝不发一条丢掉原任务的空壳反馈。 */
  const spawnFeedbackTask = ({ text: fbRaw, attachments = [], inserts = '' } = {}) => {
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
      const text = buildReopenText({
        base: baseText,
        feedback: feedbackBody,
        ackSummary: fresh?.roundSummary || taskRow?.roundSummary || '',
        feedbackHeading: FEEDBACK_HEADING,
        bold: true,
      });
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
        refreshLocal();
        return;
      }
      const landedKey = res?.key || topicKey;
      saveDoc(docIdOf(scopeOf(landedKey), newId), { title: titleFromMd(text), body: text });
      if (attachments?.length) persistAtt(newId, attachments);
      toast(`已反馈「${title}」→ 新任务 #${newId}`);
      refreshLocal();
      // 反馈新任务继承原任务的组语义（正文连 FM 一起带下去）——组锚定页就留在组里开
      if (app.openPage) {
        if (groupAnchored) app.openPage({ groupId, task: newId, name: `${title.slice(0, 24)}（反馈）` });
        else app.openPage({ dirKey: landedKey, task: newId, name: `${title.slice(0, 24)}（反馈）` });
      }
    });
  };
  /** 划选评论 → 就地回写原任务（#74），可带附件。
   *  #79 防丢数据：第一个区块永远是**完整的之前的任务**，接着才是引用字符和评论。
   *  干净态（无未保存编辑、无附件片段）干脆不传 text——服务端把评论段原子追加到
   *  盘上正文，谁先改过都不丢；带未保存编辑 / 附件片段时才由面板拉服务端最新正文
   *  整篇回写（编辑器里正在写的内容以编辑器为准）。 */
  const submitCommentInPlace = ({ text: fbRaw, attachments = [], inserts = '', quote } = {}) => {
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
        text = buildReopenText({
          base: baseText,
          feedback: feedbackBody,
          ackSummary: '',
          feedbackHeading: PLAIN_FEEDBACK_HEADING,
          bold: false,
        });
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
          attachments: (attachments || []).map((a) => ({
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
      refreshLocal();
    });
  };

  // 工作组语义（frontmatter）：组面板「新增任务」创建的草稿带 board/project——
  // 工具区给「归属项目」下拉（限本组成员），提交按 project 路由进对应项目的队列。
  // 非组任务没有 frontmatter，整段不渲染，零噪音。
  const docFm = useMemo(() => (doc ? parseFrontmatter(doc.body) : {}), [doc && doc.body]);
  // 评论任务的原文锚点：frontmatter.parent（新建评论写入）；旧数据从「锚定自「标题」」回推
  const parentRef = useMemo(() => {
    if (beside) return null; // 旁路原文自己不再开旁路
    const pid = String(docFm.parent || '').trim();
    const pdir = String(docFm.parentDir || topicKey || '').trim();
    if (pid && !/^draft/i.test(pid)) {
      return { dirKey: pdir || topicKey, task: pid, name: `#${pid}` };
    }
    const body = String(doc?.body || '');
    const m = body.match(/>\s*锚定自「([^」]+)」/);
    if (!m) return null;
    const title = m[1].trim();
    const hit = (topic?.tasks || []).find((t) => {
      if (String(t.id) === String(task)) return false;
      return titleFromMd(t.text || '') === title || String(t.text || '').includes(`# ${title}`);
    });
    if (!hit) return null;
    return { dirKey: topicKey, task: String(hit.id), name: `#${hit.id}` };
  }, [beside, docFm.parent, docFm.parentDir, doc?.body, topicKey, topic, task]);
  const boardCtx = useMemo(() => {
    const bid = docFm.board;
    if (!bid) return null;
    const allBoards = (app.repoData && app.repoData.boards) || [];
    const b = allBoards.find((x) => x.id === bid || x.key === bid || x.name === bid);
    if (!b) return null;
    const allRepos = (app.repoData && app.repoData.repos) || [];
    const byKey = new Map(allRepos.map((r) => [r.key, r]));
    const members = (b.repos || [])
      .map((m) => byKey.get(m.key))
      .filter(Boolean)
      .map((r) => ({ key: r.key, name: r.name }));
    return { board: b, members };
  }, [docFm.board, app.repoData]);

  // 首开这一页时把内容「种」进去：真实任务用服务端正文，草稿用默认模板
  // （组锚定草稿带上 board 语义——与组页「新增任务」种的同一份；已有文档不覆盖）
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

  const [selMenu, setSelMenu] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const fileMdRef = useRef(null);
  const fileAttRef = useRef(null);
  const articleRef = useRef(null);
  const reviewBarRef = useRef(null);
  const reviewSumRef = useRef(null);
  const editorApiRef = useRef(null);
  const lastSel = useRef('');
  const histRef = useRef(new Map());
  const [dirty, setDirty] = useState(false);
  // 验收条 ack：默认夹紧，过长可展开全文（任务 #20：长总结被 line-clamp 截断）
  const [ackOpen, setAckOpen] = useState(false);
  const [ackOverflow, setAckOverflow] = useState(false);
  const ackLong = String(taskRow?.roundSummary || '').length > 140;
  useEffect(() => {
    setAckOpen(false);
    setAckOverflow(false);
  }, [id, taskRow?.roundSummary]);
  useLayoutEffect(() => {
    const el = reviewSumRef.current;
    if (!el) {
      setAckOverflow(false);
      return undefined;
    }
    // -webkit-line-clamp 下首帧 scrollHeight 偶发等于 clientHeight——用 ResizeObserver
    // + rAF 再量一次；长文案另有字符数兜底，避免按钮永远不出现。
    const measure = () => {
      if (ackOpen) return;
      setAckOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [ackOpen, taskRow?.roundSummary, taskRow?.completedAt]);

  // 阅读视图：剥掉首个一级标题行——它就是文档标题（页头已渲染），正文再渲染一遍是重复
  const previewHtml = useMemo(
    () => (doc ? renderMarkdownHtml(stripTitleHeading(doc.body), doc.attachments) : ''),
    [doc]
  );
  // 验收条 ack：agent 完成总结常带 md（加粗/列表/标题）——按正文同一套渲染，不要当纯文本。
  const ackHtml = useMemo(
    () => (taskRow?.roundSummary ? renderMarkdownHtml(taskRow.roundSummary) : ''),
    [taskRow?.roundSummary]
  );

  // ack 定位轨（任务 #48）：反复 ack 反馈的长任务页，按轮次快速跳转。
  // 轮次从正文里抽（每轮一个「## 上一轮完成总结」段）——正文即历史，正文变了轨也跟着变。
  const ackNodes = useMemo(() => (doc ? extractAckNodes(doc.body) : []), [doc && doc.body]);
  // 滚动容器：实时预览是 .mdw-lp（可滚），阅读态是 .mdw-preview。
  // ⚠️ articleRef 指的是 **.mdw-lp-sheet**（live）/ **article**（阅读），两者都是
  // 滚动容器的**子节点**——要往上找（closest），不是往下查（querySelector）。
  // 两种态的 DOM 形状不同，轨内部按态分别定位（见 ack-rail.jsx 的 blockAt）。
  const [ackScrollRoot, setAckScrollRoot] = useState(null);
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return undefined;
    const pick = () => root.closest('.mdw-lp') || root.closest('.mdw-preview') || null;
    setAckScrollRoot(pick());
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => setAckScrollRoot(pick())) : null;
    mo?.observe(root, { childList: true, subtree: true });
    return () => mo?.disconnect();
  }, [doc && doc.mode]);

  useEffect(() => {
    setSelMenu(null);
    lastSel.current = '';
  }, [id]);

  useEffect(() => {
    // 滚动收起；正在写评论时不打断
    const close = () => setSelMenu((cur) => (cur?.comment ? cur : null));
    document.addEventListener('scroll', close, true);
    return () => document.removeEventListener('scroll', close, true);
  }, []);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  // 工具栏「进程」：面板化之后进程不再是内嵌右侧栏，而是工作区里独立的一块
  // （可拖动 / 可浮出 / 可单独关掉）。已开着同一目录的进程面板就聚焦它，不重复开。
  // 注意 config 要带上 dirKey：进程面板是按**目录**取任务的，缺了会落到全局池。
  // 任务带工作组语义（frontmatter.board，任务 #56）→ 进程按**组**聚合打开：
  // 组发布的任务散在成员项目各自的队列里，单目录视图看不见全景。
  const openProgress = () => {
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
  };

  /** 评论任务：在主区右侧并排打开原文（可单独关掉；不改路由） */
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

  /** 任务链节点 → 旁路查看：history 快照 / 祖先或子任务正文 */
  const openHistoryBeside = useCallback(
    (node) => {
      const m = model || app.model;
      if (!m || isDraft) return;
      if (node?.current) {
        toast('当前节点就是本页');
        return;
      }
      // 同任务 history 快照
      if (node?.historyId != null) {
        openBesideMain(m, {
          component: 'page',
          name: `链 #${task} · ${node.kind || node.historyId}`,
          config: {
            dirKey: topicKey || GLOBAL_KEY,
            task: String(task),
            historyId: Number(node.historyId),
          },
        });
        return;
      }
      // fork 祖先 / 子任务：打开对应任务页（旁路）
      if (node?.taskId != null && node?.dirKey) {
        openBesideMain(m, {
          component: 'page',
          name: node.excerpt ? String(node.excerpt).slice(0, 24) : `#${node.taskId}`,
          config: { dirKey: String(node.dirKey), task: String(node.taskId) },
        });
        return;
      }
      toast('这个节点没有可打开的内容');
    },
    [model, app.model, isDraft, topicKey, task, toast],
  );

  const closeBesideSelf = useCallback(() => {
    const m = model || app.model;
    if (!m || !tabId) return;
    m.doAction(Actions.deleteTab(tabId));
  }, [model, app.model, tabId]);

  // 任务链：优先 history；无 history 时用 forkOf 祖先/子任务（#76 反馈「看不到链」）
  const [chainApi, setChainApi] = useState(null);
  useEffect(() => {
    if (isDraft || task == null || /^draft/i.test(String(task))) {
      setChainApi(null);
      return undefined;
    }
    let cancelled = false;
    const q = isGlobal
      ? `key=${encodeURIComponent(GLOBAL_KEY)}&id=${Number(task)}`
      : `cwd=${encodeURIComponent(topic?.cwd || '')}&id=${Number(task)}`;
    api(`/api/localtasks/chain?${q}`)
      .then((d) => {
        if (!cancelled) setChainApi(d);
      })
      .catch(() => {
        if (!cancelled) setChainApi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDraft, task, isGlobal, topic?.cwd, taskRow?.history?.length, taskRow?.forkOf, taskRow?.reopenCount]);

  const chainNodes = useMemo(() => {
    if (isDraft || !taskRow) return [];
    const tip =
      String(taskRow.text || '')
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) || '';
    const tipEx = tip.replace(/^#+\s*/, '').slice(0, 100);

    // 1) 同任务 history 链
    const hist = Array.isArray(taskRow.history) ? taskRow.history : [];
    if (hist.length) {
      const nodes = hist.map((h) => ({
        historyId: h.id,
        kind: h.kind,
        at: h.at,
        excerpt: h.excerpt || h.feedback || '',
        feedback: h.feedback,
        quote: h.quote,
        attachmentCount: (h.attachments || []).length,
        current: false,
      }));
      nodes.push({
        historyId: null,
        kind: 'current',
        at: taskRow.lastReopenedAt || taskRow.createdAt || '',
        excerpt: tipEx,
        attachmentCount: 0,
        current: true,
      });
      return nodes;
    }

    // 2) fork 派生链（祖先 → 本条 → 子任务）
    const ancestors = Array.isArray(chainApi?.ancestors) ? [...chainApi.ancestors].reverse() : [];
    const children = Array.isArray(chainApi?.children) ? chainApi.children : [];
    if (!ancestors.length && !children.length && !taskRow.forkOf) return [];
    const nodes = [];
    for (const a of ancestors) {
      if (a.missing) continue;
      nodes.push({
        historyId: null,
        kind: a.forkKind || 'origin',
        at: a.createdAt || '',
        excerpt: a.excerpt || `#${a.id}`,
        attachmentCount: 0,
        current: false,
        taskId: a.id,
        dirKey: a.key,
      });
    }
    nodes.push({
      historyId: null,
      kind: 'current',
      at: taskRow.createdAt || '',
      excerpt: tipEx,
      attachmentCount: 0,
      current: true,
      taskId: Number(task),
      dirKey: topicKey || GLOBAL_KEY,
    });
    for (const c of children) {
      nodes.push({
        historyId: null,
        kind: c.forkKind || 'comment',
        at: c.createdAt || '',
        excerpt: c.excerpt || `#${c.id}`,
        attachmentCount: 0,
        current: false,
        taskId: c.id,
        dirKey: c.key,
      });
    }
    // 弹窗里即使只有当前节点也展示（说明这是链的尖）
    return nodes;
  }, [isDraft, taskRow, chainApi, task, topicKey]);

  const historyNode = useMemo(() => {
    if (historyId == null || !taskRow) return null;
    const want = Number(historyId);
    return (taskRow.history || []).find((h) => Number(h.id) === want) || null;
  }, [historyId, taskRow]);

  const markDirty = useCallback(() => setDirty(true), []);

  /** 标题 + frontmatter 拼装（提交/贴图同步共用）——标题行永远在 FM 之后。 */
  const composeText = (title, bodyText) => {
    const t = (title || '').trim() || '未命名任务';
    const fm = parseFrontmatter(bodyText);
    const hasFm = Object.keys(fm).length > 0;
    let bare = stripFrontmatter(bodyText);
    if (!/^#\s+/m.test(bare)) bare = `# ${t}\n\n${bare}`;
    else bare = bare.replace(/^#\s+.+$/m, `# ${t}`);
    return hasFm ? withFrontmatter(bare, fm) : bare;
  };

  // ─── 预览提示词（任务 #65）───
  // 工具栏「更多 → 预览提示词」：把 agent 执行 get 时会收到的**原文**摆出来。
  // 后端是只读接口（不领取 / 不写盘 / 不启动时间目标计时 / 不为附件发网），
  // 排版与 CLI 取任务共用 tasktool/delivery-text.js 同一份代码。
  const [preview, setPreview] = useState(null); // null | {busy} | {error} | {data}
  const openPreview = useCallback(() => {
    setPreview({ busy: true });
    // 草稿还没落库：把编辑器里的正文送去渲染（走与提交相同的 composeText，
    // 标题行 / frontmatter 的位置与真实落库一致，预览才不会假装干净）。
    const body = {
      cwd: isGlobal ? (topic?.cwd || undefined) : topic?.cwd,
      key: isGlobal ? GLOBAL_KEY : topicKey,
      ...(isDraft
        ? { text: composeText((doc?.title || '').trim() || '未命名任务', doc?.body || '') }
        : { id: Number(task) }),
    };
    api('/api/localtasks/preview', { method: 'POST', body })
      .then((d) => setPreview({ data: d }))
      .catch((e) => setPreview({ error: String(e.message || e) }));
  }, [isGlobal, topic?.cwd, topicKey, isDraft, doc?.title, doc?.body, task]);

  // ─── 保存 / 提交 ───
  // 时间目标的落库口径：草稿 → POST 带 duration/goalPrompt（后端 sanitize 校验写法）；
  // 已有任务 → 与服务端声明比对，有变化才发（duration 空 = 清除，clearGoal）；
  // 只写附加要求不写时长是非法声明，发布端就拦下。
  const goalPatchOf = () => {
    const duration = (goal.duration || '').trim();
    const prompt = (goal.prompt || '').trim();
    if (prompt && !duration) return { error: '时间目标要填时长（如 2h / 90m）；只写附加要求无效' };
    if (!goalEditable) return {};
    if (!isDraft) {
      const prevDur = declaredGoal?.duration || '';
      const prevPrompt = declaredGoal?.prompt || '';
      if (duration === prevDur && prompt === prevPrompt) return {};
      return duration ? { duration, goalPrompt: prompt } : { clearGoal: true };
    }
    return duration ? { duration, goalPrompt: prompt } : {};
  };

  const submit = () => guard(async () => {
    if (!doc) return;
    const t = (doc.title || '').trim() || '未命名任务';
    // frontmatter 在文件头（组任务的工作组/项目语义），标题行要插在它**后面**——
    // 剥出来处理再原样放回，保持 `---` 块始终在最前。
    const fm = parseFrontmatter(doc.body);
    const b = composeText(t, doc.body);
    // 归属项目路由：frontmatter.project 指向本组成员 → 提交/同步走那个项目的队列
    // （草稿可能挂在默认项目的 scope 下，提交落点以归属项目为准）。
    const projTopic = fm.project
      ? rows.find((r) => !r.isGlobal && r.repo && r.repo.key === fm.project)
      : null;
    // 组任务走与 CLI 同一条**严格口径**：显式交 board/project，服务端校验成员资格并
    // 按项目登记路径路由（proj-a 还没有队列主题时也能落对地方——这正是组面板建任务
    // 的常态）。认不出组（rows 未就绪 / 成员已变）但认得出 project 时，交 project 走
    // 项目口径；服务端统一推导落点，面板不再自己判队列。
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
      // 归属改了会搬家（服务端按 frontmatter.project 落到新项目队列，任务 #43）——
      // 页签与文档跟过去（同「草稿提交落点跟到真实主题」一套），不然这页还开着旧队列的旧号。
      // 组锚定页（#86）保持组锚：任务还是本组的，只是换了个成员队列。
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
        // 地址跟页签一起走（同「草稿转正」——刷新不能落在搬家前的旧号上）
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
    // 草稿 → 提交成任务：换身份（页签的 config 跟着改，内容搬到新任务号下）
    const res = await api('/api/localtasks', {
      method: 'POST',
      body: {
        // 落点判定交给服务端统一口径（tasktool/add.js 的 submitTask 一份实现）：
        // 组 → 严格 board+project；只认出 frontmatter.project → 项目口径（服务端
        // 校验登记并推导落点）；都没有 → 当前 scope（全局池 / 本目录队列）。
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
      // 落点 = 服务端返回的真实主题 key（组任务按 project 推导，可能是别的项目/目录）。
      // 页签与文档都跟到真实落点——不然页签开着旧 scope，却指向别的队列里的任务号。
      // 组锚定页保持组锚（#86）：提交后的实任务带 boardMark，组路由照样解析得回；
      // 文档搬去队列 scope（与目录页打开同一任务共享一份）。
      const landedKey = res?.key || topicKey;
      const landedScope = scopeOf(landedKey);
      persistAtt(newId, doc.attachments);
      const newDocId = docIdOf(landedScope, String(newId));
      promoteDoc(id, newDocId, { title: t, body: b });
      // 页签的 config 换成新任务（否则刷新后还认着 draft 号）；地址跟着走——
      // 不然刷新还落在旧 draft 号上（那份草稿已转正搬走，会开出一份空壳新草稿）
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
  });

  // ─── 导入 .md（建一个任务，并开它的页签）───
  const importMd = async (file) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await api('/api/localtasks', {
        method: 'POST',
        // 组锚定页（#86）：按归属项目落队（与提交同一口径——组草稿页 topic 还没解析，
        // cwd 寻不到）；目录/全局页维持 cwd / 全局池。
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
  };

  // ─── 删除本页（软删除）───
  const delTask = async () => {
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
  };

  const addFiles = async (fileList, opts = {}) => {
    if (!doc) return;
    // 本机仓优先：图片嵌在光标处、文件追加文尾（嵌入即附件，正文随任务走）；
    // 本机仓不可达时 items 带 dataURL 走 localStorage 老路（fileInserts 为空）。
    const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
    // 上传是异步的——await 后读最新会话文档，避免并发贴图/输入用陈旧正文覆盖。
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
    // 已落库任务：贴图即同步——agent 领取只认服务端正文里的 ![…](fileId)，
    // 不能等用户再点「保存并同步」（否则仓里有图、attachments count 仍是 0）。
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
  };

  const closeSelMenu = () => {
    setSelMenu(null);
    lastSel.current = '';
  };

  /** 「更多 → 新任务」：新草稿**带着当前上下文**（工作组 + 归属项目）。
   *
   * 原来这里只是开一个新页签（nextDraftId），草稿正文是空模板、**没有 frontmatter**——
   * 于是「在组内的任务里新建任务」会丢掉归属：新任务落进本目录队列，而不是组里那个
   * 项目（任务 #64：「创建新任务会丢失相关的一个上下文」）。
   *
   * 现在与组页「新增任务」同一套口径：正文 = 模板默认正文 + frontmatter（board/project）。
   */
  const newTask = () => {
    const draftId = nextDraftId();
    // 草稿 doc 的 scope：组锚定页种在**组 scope**（与组页「新增任务」同一套，
    // 组路由寻得回，#86）；目录页种在本目录 scope
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
  };

  /** 「更多 → 克隆任务」：以当前任务为模板快速复制一条新任务（#70）。
   *  只复制正文内容，**不带派生链**（forkOf 留空——那条语义属于评论/反馈派生），
   *  也不继承时间目标与依赖；源任务不动，克隆后两条并存。 */
  const cloneCur = () => {
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
        // 克隆连 FM 一起复制——组任务的克隆还是组任务，组锚定页就留在组里开
        if (groupAnchored) app.openPage({ groupId, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
        else app.openPage({ dirKey: topicKey, task: String(newId), name: `${(doc?.title || '任务').slice(0, 30)}（克隆）` });
      }
    });
  };

  /** 工具栏「评论」：只用当前可见选区；浮层已开时沿用其原文（正写评论） */
  const openCommentFromToolbar = () => {
    const live = String(window.getSelection() || '').trim();
    const quote = live || (selMenu?.text ? String(selMenu.text) : '');
    if (!quote) {
      toast('先划选一段再评论');
      return;
    }
    lastSel.current = quote;
    const r = (() => {
      try {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return sel.getRangeAt(0).getBoundingClientRect();
      } catch { /* ignore */ }
      return null;
    })();
    setSelMenu({
      kind: selMenu?.kind || 'task',
      text: quote,
      comment: true,
      x: Math.min(window.innerWidth - 300, Math.max(8, r ? r.left + r.width / 2 - 140 : (selMenu?.x ?? 80))),
      y: Math.min(window.innerHeight - 240, Math.max(8, r ? r.bottom + 8 : (selMenu?.y ?? 120))),
    });
  };

  /** 标题与正文首行 # 双向同步 */
  const onTitle = (next, kind = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch = { title: next };
    if (editorMode !== 'split' && /^# (?!#)/m.test(doc.body)) {
      patch.body = doc.body.replace(/^# (?!#).+$/m, `# ${next || '未命名任务'}`);
    }
    saveDoc(id, patch);
  };

  const onBody = (next, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch = { body: next };
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

  const placeSelMenu = (kind, text, x, y, extra = {}) => {
    lastSel.current = text;
    setSelMenu({
      kind,
      text,
      ...extra,
      x: Math.min(window.innerWidth - 300, Math.max(8, x)),
      y: Math.min(window.innerHeight - 240, Math.max(8, y)),
    });
  };

  const onEditorTextSel = (info) => {
    if (!info?.text || info.text.length < 1) {
      // 评论撰写中选区会塌缩——浮层必须粘住
      setSelMenu((cur) => (cur?.comment ? cur : null));
      return;
    }
    setSelMenu((cur) => {
      if (cur?.comment) return cur;
      lastSel.current = info.text;
      return {
        kind: 'format',
        text: info.text,
        x: Math.min(window.innerWidth - 300, Math.max(8, info.x)),
        y: Math.min(window.innerHeight - 240, Math.max(8, info.y)),
      };
    });
  };

  const onPreviewMouseUp = (e) => {
    if (!doc || editorMode === 'edit') return;
    if (e.target.closest?.('#mdw-sel-menu')) return;
    if (e.target.closest?.('textarea')) return;
    const sel = window.getSelection();
    const text = (sel && String(sel)).trim();
    if (!text || text.length < 1) {
      setSelMenu((cur) => (cur?.comment ? cur : null));
      return;
    }
    if (!articleRef.current?.contains(sel.anchorNode)) {
      setSelMenu((cur) => (cur?.comment ? cur : null));
      return;
    }
    if (selMenu?.comment) return; // 正写评论，别被新划选冲掉
    const r = sel.getRangeAt(0).getBoundingClientRect();
    placeSelMenu('task', text, r.left + r.width / 2 - 140, r.bottom + 8);
  };

  const pickAtt = (accept) => {
    fileAttRef.current.accept = accept;
    fileAttRef.current?.click();
  };

  // Ctrl/⌘ ⇧ O：评论任务并排打开原文（#37）——编辑态也放行，不与常见编辑快捷键冲突
  useEffect(() => {
    if (!parentRef || beside) return undefined;
    const onKey = (e) => {
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
    const kindLab = { origin: '起点', reopen: '反馈', comment: '评论' }[historyNode?.kind] || '节点';
    const html = historyNode
      ? renderMarkdownHtml(historyNode.text || '', historyNode.attachments || [])
      : '';
    return (
      <div className="mdw is-beside">
        <div className="mdw-beside-h">
          <span className="mdw-beside-lab">链节点 · {kindLab} #{historyId}</span>
          <span className="grow" />
          <button
            type="button"
            className="iconbtn"
            title="关闭"
            aria-label="关闭"
            onClick={closeBesideSelf}
          >
            ×
          </button>
        </div>
        <div className="mdw-hist-ro">
          {!historyNode ? (
            <div className="muted">找不到链节点 #{historyId}</div>
          ) : (
            <>
              <div className="mdw-hist-meta">
                <span>{historyNode.at || '—'}</span>
                {historyNode.quote ? <span>锚定：{historyNode.quote.slice(0, 80)}</span> : null}
                {historyNode.feedback ? <span>反馈：{historyNode.feedback.slice(0, 80)}</span> : null}
                {historyNode.summary ? <span>上轮总结：{historyNode.summary.slice(0, 80)}</span> : null}
              </div>
              <article
                className="md-body"
                dangerouslySetInnerHTML={{ __html: html || '<p class="muted">（空）</p>' }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // 读不到文档分两种：**还在读**（队列首轮没回来）与**确实没有这一条**（被删 / 深链写错）。
  // 后者不该永远转圈——给一句实话 + 一个出口（回目录）。
  if (!doc) {
    if (app.localReady === false || isDraft) {
      return <div className="mdw"><div className="pad muted">载入中…</div></div>;
    }
    return (
      <div className="mdw">
        <div className="pad stack">
          <div><strong>找不到任务 #{task}</strong></div>
          <div className="hint">它可能已被删除（软删除可用 nx-kv localtask task restore 恢复），或这个深链写错了。</div>
          <div>
            <button
              className="btn ghost sm"
              onClick={() => app.onNavigate && app.onNavigate(
                groupAnchored
                  ? '#/group/' + encodeURIComponent(groupId || '')
                  : isGlobal ? '#/global' : '#/dir/' + encodeURIComponent(dirKey || '')
              )}
            >
              回到目录
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── 时间目标 UI（#78）───
  // 设置收进「更多」菜单（goalMenu），外部只以勋章回显（goalBadge）——头部不再
  // 给整行；没设（无草稿值也无声明）勋章就不出现，零噪音。勋章跟随 goalDraft
  // （正在编辑的草稿值），落库仍走 submit 里的 goalPatchOf 同一套口径。
  const goalDur = (goal.duration || '').trim();
  const goalPrompt = (goal.prompt || '').trim();
  const goalBadge = (goalDur || goalPrompt)
    ? {
      label: `⏱ ${goalDur || '目标'}`,
      title: goalPrompt
        || (goalEditable ? '任务级时间目标（在「更多」里设置；领取即计时）' : '已领取计时，声明不可改'),
    }
    : null;
  const goalMenu = (goalEditable || declaredGoal) ? (
    <div className="mdw-goal-menu">
      <div className="mdw-goal-menu-lab">时间目标</div>
      {goalEditable ? (
        <>
          <input
            className="mdw-goal-dur mono"
            value={goal.duration}
            placeholder="2h / 90m / 30分钟，留空不带"
            onChange={(e) => {
              setGoalDraft({ ...goal, duration: e.target.value });
              markDirty();
            }}
          />
          <input
            className="mdw-goal-prompt"
            value={goal.prompt}
            placeholder="附加要求（可选，随 check 指令一起固化）"
            onChange={(e) => {
              setGoalDraft({ ...goal, prompt: e.target.value });
              markDirty();
            }}
          />
        </>
      ) : (
        <span className="mdw-goal-ro mono" title={declaredGoal?.prompt || '已领取计时，声明不可改'}>
          {declaredGoal?.duration || '—'} · 已领取计时
        </span>
      )}
    </div>
  ) : null;

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
      {beside && (
        <div className="mdw-beside-h">
          <span className="mdw-beside-lab">原文（旁路）</span>
          <span className="grow" />
          <button
            type="button"
            className="iconbtn"
            title="关闭原文面板"
            aria-label="关闭原文面板"
            onClick={closeBesideSelf}
          >
            ×
          </button>
        </div>
      )}
      <div className="mdw-main">
        <div className="mdw-top">
          {/* 路径条放进这条工具栏里（#44 反馈「mdw-top 在这个区域里面」） */}
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

        {/* 归属项目（组任务）：组面板「新增任务」带 frontmatter 的草稿/任务才显示。
            草稿与未领取可改（改写 frontmatter），已领取只读；提交按 project 路由队列。 */}
        {boardCtx && (
          <div className="mdw-goal">
            <span
              className="mdw-goal-lab"
              title="归属项目（限本组成员）：决定提交进哪个项目的队列；由组面板「新增任务」创建时自动携带本组语义"
            >
              归属项目
            </span>
            {goalEditable ? (
              <select
                className="mdw-proj-pick"
                value={docFm.project || ''}
                onChange={(e) => {
                  saveDoc(id, {
                    body: withFrontmatter(doc.body, { ...docFm, board: boardCtx.board.id, project: e.target.value }),
                  });
                  markDirty();
                }}
              >
                {boardCtx.members.map((m) => (
                  <option key={m.key} value={m.key}>{m.name}</option>
                ))}
              </select>
            ) : (
              <span className="mdw-proj-ro" title="归属项目（在本组创建时写入，随任务走）">
                {(boardCtx.members.find((m) => m.key === docFm.project) || {}).name || docFm.project || '—'}
              </span>
            )}
          </div>
        )}

        {/* #78：头部只留 新任务 / 提交；其余动作（含进程/原文/快捷键）全进「更多」，
            时间目标在「更多」顶部编辑、外部勋章回显。MD 格式条撤出头部——
            划选浮条 + 行首 / 命令 + Ctrl/⌘B 等快捷键已覆盖。 */}
        <ToolBar
          mode={editorMode}
          onMode={(m) => saveDoc(id, { mode: m })}
          showMark={editorMode !== 'edit'}
          submitLabel={isDraft ? '提交为任务' : '保存并同步'}
          onNew={newTask}
          onSubmit={submit}
          onChain={isDraft ? null : () => setChainOpen(true)}
          onPreview={openPreview}
          onImg={() => pickAtt('image/*')}
          onAtt={() => pickAtt('image/*,.pdf,.zip,.txt,.json,.csv')}
          onImport={() => fileMdRef.current?.click()}
          onClone={isDraft ? null : cloneCur}
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
          attachments={doc.attachments}
          docKey={id}
          editorApiRef={editorApiRef}
          onFiles={addFiles}
          onTextSel={onEditorTextSel}
          onSave={submit}
          onUndo={undo}
          onRedo={redo}
          onCloseSelMenu={closeSelMenu}
        />

        <AttachBar
          attachments={doc.attachments}
          onRemove={(aid) => {
            const next = (doc.attachments || []).filter((x) => x.id !== aid);
            markDirty();
            saveDoc(id, { attachments: next });
            if (!isDraft) persistAtt(task, next);
          }}
        />

        {/* 验收条：已完成任务的 ack 卡——放在**正文末尾**（用户口径）：读完正文
            正好看到 agent 的完成总结，等你回复——反馈 = 新开任务；划选评论 = 回写
            本任务；通行 = 验收通过。 */}
        {!isDraft && taskRow?.completedAt && (
          <div className="mdw-review" ref={reviewBarRef}>
            <div className="mdw-review-main">
              <span className="mdw-review-badge">已完成 · 等待验收</span>
              <span className="mdw-review-at mono">{taskRow.completedAt}</span>
              {taskRow.roundSummary ? (
                <>
                  <div
                    ref={reviewSumRef}
                    className={`mdw-review-sum${ackOpen ? ' is-open' : ''}`}
                    title={ackOpen || !(ackOverflow || ackLong) ? 'agent 的完成总结（ack）' : '点击下方展开全文'}
                    dangerouslySetInnerHTML={{ __html: ackHtml }}
                  />
                  {(ackOverflow || ackLong || ackOpen) && (
                    <button
                      type="button"
                      className="mdw-review-more"
                      onClick={() => setAckOpen((o) => !o)}
                    >
                      {ackOpen ? '收起' : '展开全文'}
                    </button>
                  )}
                </>
              ) : null}
            </div>
            <div className="mdw-review-acts">
              {reviewAcked ? (
                <span className="mdw-review-ok">已验收</span>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={openFeedback} title="新开一条任务携带反馈（原任务不动）">
                    反馈
                  </button>
                  <button type="button" className="primary" onClick={ackReview}>
                    通行
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ack 定位轨（任务 #48）：反复 ack 反馈的长任务页，一轮一个节点，点击跳过去。
          只有真的有多轮时才有内容（ackNodes 为空 → 组件自身返回 null）。 */}
      <AckRail nodes={ackNodes} scrollRoot={ackScrollRoot} />

      <SelMenu
        at={selMenu}
        onFormat={(op) => {
          editorApiRef.current?.format?.(op);
          closeSelMenu();
        }}
        onComment={onCommentSubmit}
        onCompose={() => setSelMenu((cur) => (cur ? { ...cur, comment: true } : cur))}
        onClose={closeSelMenu}
        onCopy={() => {
          navigator.clipboard?.writeText(lastSel.current || selMenu?.text || '');
          toast('已复制');
          closeSelMenu();
        }}
      />

      <input
        ref={fileAttRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const f = e.target.files;
          e.target.value = '';
          if (f && f.length) addFiles(f);
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

/**
 * 预览弹层（任务 #65）：「agent 执行 get 会收到的提示词」。
 *
 * 只展示服务端渲染好的原文（data.rendered）+ 段落来源，**不在前端二次拼装**——
 * 前端一拼就会与真实交付漂移，而预览的全部价值就是「所见即所得」。
 */
function PreviewModal({ state, onClose }) {
  const toast = useToast();
  const data = state?.data;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(data?.rendered || ''));
      toast('已复制原文');
    } catch {
      toast('复制失败（剪贴板不可用）');
    }
  };
  const sw = data?.switches || {};
  const swLine = data
    ? [
        `回调提示词 ${sw.suffix?.on ? `开（${sw.suffix.count} 条）` : '关'}`,
        `ack ${sw.ack?.on ? `开（${sw.ack.count} 条）` : '关'}`,
        `交付上下文 ${sw.deliveryTemplate?.custom ? '自定义' : '内置默认'}`,
        `持续 get ${data.getLoop?.enabled ? `开（${data.getLoop.waitMinutes} 分钟）` : '关'}`,
      ].join(' · ')
    : '';
  const title = data
    ? `预览：agent 执行 get 会收到的提示词${data.task?.id ? ` · #${data.task.id}` : ' · 草稿'}`
    : '预览：agent 执行 get 会收到的提示词';
  return (
    <Modal
      title={title}
      size='wide'
      onClose={onClose}
      footer={
        <>
          <span className='mdw-prev-hint'>与 CLI 取任务共用同一份排版；不含「已取得下一条任务…」头部行。</span>
          <span className='grow' />
          <button type='button' className='btn ghost sm' onClick={copy} disabled={!data}>复制原文</button>
          <button type='button' className='btn sm' onClick={onClose}>关闭</button>
        </>
      }
    >
      {state.busy && <div className='mdw-prev-note'>渲染中…</div>}
      {state.error && (
        <div className='mdw-prev-note'>
          预览失败：{state.error}
          {/* 「接口不存在」= 正在跑的 serve 进程比页面资产旧（路由启动时加载、
              资产现读磁盘，#65 验收反馈实锤过这个 404）——引导重启，别让它
              看起来像瞬时故障。与 overview 批量删除 / use-templates 同一处理。 */}
          {/接口不存在/.test(String(state.error)) && (
            <div className='mdw-prev-hint'>
              本机面板服务较旧：重启面板（结束当前 serve 进程后重新启动）即可生效，刷新页面不够。
            </div>
          )}
        </div>
      )}
      {data && (
        <>
          <pre className='mdw-prev-body'>{data.rendered || ''}</pre>
          {data.segments?.length ? (
            <details className='mdw-prev-seg'>
              <summary>段落来源（{data.segments.length} 段）</summary>
              <ol>
                {data.segments.map((s, i) => (
                  <li key={i}>
                    <span className='mdw-prev-seg-lab'>{s.label}</span>
                    <span className='mdw-prev-seg-n'>{String(s.text || '').length} 字</span>
                  </li>
                ))}
              </ol>
              <div className='mdw-prev-note'>改这些段去「设置 → 提示词 / 模板」；「持续 get」在项目级设置里。</div>
            </details>
          ) : (
            <div className='mdw-prev-note'>当前没有任何模板段：交付时就只有任务正文。</div>
          )}
          <div className='mdw-prev-switch'>{swLine}</div>
        </>
      )}
    </Modal>
  );
}
