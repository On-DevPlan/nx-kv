// MD 页签面板 —— 一个 MD 页 = 工作区里的一等页签。
//
// 面板化之后，原来的「工作台内部页签栏」没了：开哪几页、在哪开、能不能并排，
// 都由工作区布局管（可拖拽 / 可拆分 / 可浮出）。这个面板只管**一页的内容**：
// 编辑、保存/提交、附件、撤销重做、划选浮条。
//
// 文档内容存在会话内存（doc-store.js），页签身份在 FlexLayout 模型里——
// 两者分工明确：布局归布局，内容归内容。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/ui.jsx';
import { GLOBAL_KEY } from '../../../../modules/localtask/board.js';
import { buildReopenText } from '../../../../modules/localtask/reopen-text.js';
import ToolBar from '../../components/md/tool-bar.jsx';
import { MdPanes } from '../../components/md/md-panes.jsx';
import AttachBar from '../../components/md/attach-bar.jsx';
import SelMenu from '../../components/md/sel-menu.jsx';
import ShortcutSheet from '../../components/md/shortcut-sheet.jsx';
import { useApp } from '../../app-context.jsx';
import { openPanel } from '../../workspace.js';
import { filesToAttachments, persistAtt } from '../../components/md/attachments.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { renderMarkdownHtml, slugName, titleFromMd, parseFrontmatter, stripFrontmatter, stripTitleHeading, withFrontmatter } from '../../modules/md/md-parse.js';
import {
  docIdOf,
  getDoc,
  isDraftTask,
  nextDraftId,
  promoteDoc,
  saveDoc,
  scopeOf,
  useDocs,
} from '../../modules/md/doc-store.js';

export default function PagePanel({ dirKey, task, tabId, model }) {
  const app = useApp() || {};
  const toast = useToast();
  const rows = app.rows || [];
  const refreshLocal = app.refreshLocal;
  const tpl = app.tpl;

  const isGlobal = !dirKey || dirKey === GLOBAL_KEY;
  const scope = scopeOf(dirKey);
  const isDraft = isDraftTask(task);
  const id = docIdOf(scope, task);

  // 本目录的主题（提交/删除要它的 cwd）
  const topic = useMemo(() => {
    if (isGlobal) return rows.find((r) => r.isGlobal) || null;
    return rows.find((r) => r.key === dirKey) || null;
  }, [rows, dirKey, isGlobal]);

  const taskRow = useMemo(
    () => (topic?.tasks || []).find((x) => String(x.id) === String(task)) || null,
    [topic, task]
  );

  const docs = useDocs();
  const doc = docs[id] || null;

  // 时间目标（任务级 timegoal 声明）：草稿与未领取任务可设/改/清；已领取计时中的
  // 只读展示（领取即计时，声明是既成事实——要调先在目录页重开任务）。
  // goalDraft 为 null 表示「还没动过」——此时跟随服务端值（taskRow 可能晚于首轮渲染到）。
  const [goalDraft, setGoalDraft] = useState(null);
  useEffect(() => {
    setGoalDraft(null);
  }, [id]);
  const declaredGoal = taskRow?.timegoal || null;
  const goal = goalDraft || { duration: declaredGoal?.duration || '', prompt: declaredGoal?.prompt || '' };
  const goalEditable = isDraft || (!!taskRow && taskRow.status !== 'consumed');

  // ─── 验收条（完成任务）：agent 的完成总结（ack）+ 用户回复（通行 / 重做 / 划线评论提详细问题）───
  // 「通行」只在本机记一笔（localStorage，per-viewer 的轻量状态）：done 本身已是终态，
  // 验收与否不进队列 schema——「无更新则直接结束」的口径里，通行 = 不需要再做什么。
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
  /** 重做：走**正常评论模式**（不再弹窗输入框）——评论框开在正文末尾，
      提交即把这条任务重开，反馈文字（加粗）带进正文。 */
  const redoTask = () => {
    // 浮层是 .mdw 内的绝对定位 → 坐标要相对容器（用条带相对容器的偏移）
    const bar = reviewBarRef.current;
    const host = bar?.closest?.('.mdw');
    const b = bar?.getBoundingClientRect();
    const h = host?.getBoundingClientRect();
    const x = b && h ? b.left - h.left + 80 : 80;
    const y = b && h ? b.top - h.top - 190 : 120;
    setSelMenu({
      kind: 'task',
      text: '', // 重做针对整条任务，不锚定选区
      comment: true,
      mode: 'redo',
      x: Math.min(window.innerWidth - 320, Math.max(8, x)),
      y: Math.min(window.innerHeight - 260, Math.max(8, y)),
    });
  };
  /** 评论框提交：重做模式 → 重开本任务（反馈加粗进正文）；普通划线评论 → 开新任务 */
  const onCommentSubmit = (q) => {
    if (selMenu?.mode === 'redo') {
      submitRedo(q);
      return;
    }
    spawnComment(q);
  };
  const submitRedo = (feedback) => {
    const fb = String(feedback || '').trim();
    closeSelMenu();
    if (!fb) {
      toast('写一下要改的地方');
      return;
    }
    const title = doc?.title || `#${task}`;
    guard(async () => {
      // 反馈是**追加**不是替换：reopen 的 text 是整段新正文，直接把反馈当正文发
      // 会把原任务丢掉。拼成「原正文 + 上一轮 ack 完成总结 + 验收反馈」——
      // 重做后验收条会消失，上轮总结若不落进正文就没人看得见了（agent 下一轮
      // 同样看不见：它只拿到正文）。反馈逐行加粗（用户口径：重开的任务要携带着
      // 反馈文字在正文中，最好加粗）。
      const text = buildReopenText({
        base: doc?.body || '',
        feedback: fb,
        ackSummary: taskRow?.roundSummary || '',
      });
      await api('/api/localtasks/reopen', {
        method: 'POST',
        body: {
          ...(isGlobal ? { key: GLOBAL_KEY } : { cwd: topic?.cwd }),
          id: Number(task),
          text,
        },
      });
      // 把重开后的正文写回**打开的这份文档**：文档是会话内存里的副本，重开只改了
      // 服务端队列正文——不写回的话，这一页显示的还是旧正文，用户看不到刚追加的
      // 「上一轮完成总结 / 验收反馈」两段（agent 领到的新正文却是新的，两边对不上）。
      // text 是拿 doc.body 拼的，未保存的编辑原样带在里面，不会被抹掉。
      saveDoc(id, { title: titleFromMd(text), body: text });
      setDirty(false);
      toast(`已重开「${title}」——agent 可再次领取`);
      refreshLocal();
    });
  };

  // 工作组语义（frontmatter）：组面板「新增任务」创建的草稿带 board/project——
  // 工具区给「归属项目」下拉（限本组成员），提交按 project 路由进对应项目的队列。
  // 非组任务没有 frontmatter，整段不渲染，零噪音。
  const docFm = useMemo(() => (doc ? parseFrontmatter(doc.body) : {}), [doc && doc.body]);
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
  useEffect(() => {
    if (docs[id]) return;
    if (isDraft) getDoc(id, { title: '', body: tpl ? tpl.defaultBody() : '' });
    else if (taskRow) getDoc(id, { title: titleFromMd(taskRow.text), body: taskRow.text });
  }, [id, isDraft, taskRow]);

  const [selMenu, setSelMenu] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const fileMdRef = useRef(null);
  const fileAttRef = useRef(null);
  const articleRef = useRef(null);
  const reviewBarRef = useRef(null);
  const editorApiRef = useRef(null);
  const lastSel = useRef('');
  const histRef = useRef(new Map());
  const [dirty, setDirty] = useState(false);

  // 阅读视图：剥掉首个一级标题行——它就是文档标题（页头已渲染），正文再渲染一遍是重复
  const previewHtml = useMemo(
    () => (doc ? renderMarkdownHtml(stripTitleHeading(doc.body), doc.attachments) : ''),
    [doc]
  );

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
  const openProgress = () => {
    const m = model || app.model;
    if (!m) return;
    openPanel(m, {
      component: 'progress',
      name: '进程',
      config: { dirKey: dirKey || GLOBAL_KEY },
      location: 'right',
    });
  };

  const markDirty = useCallback(() => setDirty(true), []);

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
    const hasFm = Object.keys(fm).length > 0;
    let bare = stripFrontmatter(doc.body);
    if (!/^#\s+/m.test(bare)) bare = `# ${t}\n\n${bare}`;
    else bare = bare.replace(/^#\s+.+$/m, `# ${t}`);
    const b = hasFm ? withFrontmatter(bare, fm) : bare;
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
      await api('/api/localtasks/item', {
        method: 'PATCH',
        body: {
          cwd: isGlobal ? (projTopic ? projTopic.cwd : undefined) : topic?.cwd,
          key: isGlobal && !projTopic ? GLOBAL_KEY : undefined,
          id: Number(task),
          text: b,
          ...gp,
        },
      });
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
      const landedKey = res?.key || dirKey;
      const landedScope = scopeOf(landedKey);
      persistAtt(newId, doc.attachments);
      const newDocId = docIdOf(landedScope, String(newId));
      promoteDoc(id, newDocId, { title: t, body: b });
      // 页签的 config 换成新任务（否则刷新后还认着 draft 号）
      if (model && tabId) {
        model.doAction(Actions.updateNodeAttributes(tabId, { config: { dirKey: landedKey, task: String(newId) } }));
      }
      setDirty(false);
      clearHistory(histRef.current, newDocId);
    }
    toast(`已提交：${slugName(t)}`);
    refreshLocal();
  });

  // ─── 导入 .md（在本目录里建一个任务，并开它的页签）───
  const importMd = async (file) => {
    const text = await file.text();
    const name = file.name.replace(/\.md$/i, '');
    await guard(async () => {
      const bodyText = text.startsWith('#') ? text : `# ${name}\n\n${text}`;
      const res = await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal ? { global: true, text: bodyText } : { cwd: topic.cwd, text: bodyText },
      });
      toast(`已导入：${file.name}`);
      refreshLocal();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) app.openPage({ dirKey, task: String(newId), name: `#${newId}` });
    });
  };

  // ─── 删除本页（软删除）───
  const delTask = () => {    if (!doc || isDraft) return;
    const title = doc.title || `#${task}`;
    if (!confirm(`删除任务「${title}」？\n软删除：CLI localtask task restore 可恢复。`)) return;
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
    // 图床优先：图片嵌在光标处、文件追加文尾（嵌入即附件，正文随任务走）；
    // 图床不可达时 items 带 dataURL 走 localStorage 老路（fileInserts 为空）。
    const { items, imageInserts, fileInserts } = await filesToAttachments(fileList);
    const b = doc.body || '';
    const ins = imageInserts.join('');
    let body = b;
    if (ins && opts.insertAt != null && opts.insertAt >= 0) {
      const at = Math.min(opts.insertAt, b.length);
      body = b.slice(0, at) + ins + b.slice(at);
      if (opts.mode === 'edit') {
        requestAnimationFrame(() => {
          editorApiRef.current?.focus?.();
          const ta = document.querySelector('.mdw-editor');
          if (ta) {
            const caret = at + ins.length;
            try { ta.setSelectionRange(caret, caret); } catch { /* ignore */ }
          }
        });
      }
    } else if (ins) {
      body = b + ins;
    }
    if (fileInserts.length) body += fileInserts.join('');
    const patch = {};
    if (body !== b) patch.body = body;
    if (items.length) patch.attachments = [...(doc.attachments || []), ...items];
    if (!Object.keys(patch).length) return;
    saveDoc(id, patch);
    markDirty();
    if (!isDraft && patch.attachments) persistAtt(task, patch.attachments);
  };

  const closeSelMenu = () => {
    setSelMenu(null);
    lastSel.current = '';
  };

  /** 划线评论 → **直接提交**成新任务：锚定选区原文，正文就是提出的问题。
   *
   * 两条口径（用户验收反馈 2026-11-04）：
   *   1. 原任务带工作组语义（frontmatter 里的 board / project）→ 评论出的新任务
   *      **也归该组**。不继承的话，这条问题会从组面板里掉出去——用户是在组里
   *      提问的，闭环断在半路。正文整块继承原 frontmatter（归属 + 介绍引用）。
   *   2. 评论**直接提交**，不再先落成草稿、让人再点一次提交。评论是提问不是
   *      写作，多一道编辑页就多一次流失；提交完再打开新任务页（看得到提交了什么）。
   */
  const spawnComment = (question) => {
    const quote = lastSel.current || '';
    const q = String(question || '').trim();
    if (!quote) {
      toast('先划选一段再评论');
      return;
    }
    if (!q) {
      toast('写一下要提的问题');
      return;
    }
    const parent = doc?.title || topic?.name || '';
    const t = `问题：${q.slice(0, 28)}`;
    const raw = `# ${t}\n\n> 锚定自「${parent}」：\n> ${quote.replace(/\n/g, '\n> ')}\n\n## 问题\n${q}\n\n## 要做什么\n- [ ] …\n`;
    // 工作组语义继承：原任务的 frontmatter（board / project / 介绍引用）整块带过去
    const b = withFrontmatter(raw, docFm);
    guard(async () => {
      // 落点 = 原任务所在队列（显式给 cwd：尊重当前落点，不被归属推导挪走）；
      // 归属由正文 frontmatter 决定（服务端 fail-open 补介绍引用）。
      const res = await api('/api/localtasks', {
        method: 'POST',
        body: isGlobal ? { global: true, text: b } : { cwd: topic?.cwd, text: b },
      });
      closeSelMenu();
      toast('已提交问题（评论）');
      refreshLocal();
      const newId = res?.task?.id ?? res?.id;
      if (newId != null && app.openPage) app.openPage({ dirKey, task: String(newId), name: t });
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
    if (doc.mode !== 'split' && /^# (?!#)/m.test(doc.body)) {
      patch.body = doc.body.replace(/^# (?!#).+$/m, `# ${next || '未命名任务'}`);
    }
    saveDoc(id, patch);
  };

  const onBody = (next, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, id, { title: doc.title, body: doc.body }, kind);
    markDirty();
    const patch = { body: next };
    if (doc.mode !== 'split') patch.title = titleFromMd(next);
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
    if (!doc || doc.mode === 'edit') return;
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
              onClick={() => app.onNavigate && app.onNavigate(isGlobal ? '#/global' : '#/dir/' + encodeURIComponent(dirKey || ''))}
            >
              回到目录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mdw" data-mode={doc.mode || 'split'} onMouseUp={onPreviewMouseUp}>
      <div className="mdw-main">
        <div className="mdw-top">
          <div className="mdw-head">
            <div className="mdw-title">{isDraft ? (doc.title || '新 MD 任务') : (doc.title || '任务')}</div>
            <div className="mdw-path">
              {isGlobal ? '全局任务池' : (topic?.cwd || topic?.name || '—')}
              {isDraft ? ` / (${task})` : ` / #${task}`}
              {dirty ? ' · 未保存' : ''}
            </div>
          </div>
        </div>

        {/* 时间目标行：可编辑（草稿/未领取）或只读回显（已领取计时中）。整行在没有
            任何目标信息且不可编辑时隐藏，不给已完成页面添噪音。 */}
        {(goalEditable || declaredGoal) && (
          <div className="mdw-goal">
            <span className="mdw-goal-lab" title="任务级 timegoal：领取即计时，未到点不许标完成">⏱ 时间目标</span>
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
        )}

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

        <ToolBar
          mode={doc.mode}
          onMode={(m) => saveDoc(id, { mode: m })}
          showMark={doc.mode !== 'edit'}
          submitLabel={isDraft ? '提交为任务' : '保存并同步'}
          onImg={() => pickAtt('image/*')}
          onAtt={() => pickAtt('image/*,.pdf,.zip,.txt,.json,.csv')}
          onShortcuts={() => setShowShortcuts(true)}
          onImport={() => fileMdRef.current?.click()}
          onNew={() => app.openPage && app.openPage({ dirKey, task: nextDraftId(), name: '新任务' })}
          onMark={openCommentFromToolbar}
          onDraft={() => toast('草稿随页签保留（刷新后需从侧栏或页签重新打开）')}
          onSubmit={submit}
          onDelete={isDraft ? null : delTask}
          onProg={openProgress}
          onOverview={() => app.onNavigate && app.onNavigate('#/overview')}
          onFormat={(op) => editorApiRef.current?.format?.(op)}
          onTurn={(id2) => editorApiRef.current?.turn?.(id2)}
        />

        <MdPanes
          ref={articleRef}
          mode={doc.mode}
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
            正好看到 agent 的完成总结，等你回复——划选正文评论 = 提详细问题（生成
            新任务）；重做 = 评论模式下带反馈重开；通行 = 验收通过。 */}
        {!isDraft && taskRow?.completedAt && (
          <div className="mdw-review" ref={reviewBarRef}>
            <div className="mdw-review-main">
              <span className="mdw-review-badge">已完成 · 等待验收</span>
              <span className="mdw-review-at mono">{taskRow.completedAt}</span>
              {taskRow.roundSummary ? (
                <div className="mdw-review-sum" title="agent 的完成总结（ack）">
                  {taskRow.roundSummary}
                </div>
              ) : null}
            </div>
            <div className="mdw-review-acts">
              {reviewAcked ? (
                <span className="mdw-review-ok">已验收</span>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={redoTask}>
                    重做（带反馈）
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
