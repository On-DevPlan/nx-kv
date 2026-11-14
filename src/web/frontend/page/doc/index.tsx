// 文档页签面板 —— 一个文档 = 工作区里的一等页签（与任务页同构）。
// 正文真相在库内（v6 ref_bodies）：GET /api/docs/item 拉正文，PATCH 写库，不落盘。
// 双链 [[..]] 点击开目标文档页签（openPanel 去重）；解析规则与后端共用 core/wikilink.js。
// 外部绑定（path:）登记在册 = 我的文档集；只有目录绑定（dir）仍是只读清单。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import {
  docAttachments,
  listBoards,
  loadDocsIndex,
  getDocItem,
  type DocItem,
} from './api.js';
// #120：文档条目的读写统一走 refs 模块（列表 CRUD 的唯一入口）
import { docsBindings, removeDocItem, updateDocItem } from '../../refs/api.js';
import { createDoc, saveDesc as saveDocDesc } from '../../refs/ops.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useApp } from '../../app-context.jsx';
import { openPanel } from '../../workspace.js';
import { MdPanes } from '../../components/md/md-panes.jsx';
import { DocAttachBody, DocDockPanel, DocStatusBar } from './doc-dock.js';
import { useDocBindings } from './bindings.js';
import { useDock } from '../dir/task-dock.js';
import { docIdOfLocator } from '../../components/md/attach-common.js';
import type { Attachment } from '../../components/md/attach-common.js';
import type { FileDropCtx } from '../../components/md/md-panes-helpers.js';
import DocHead, { groupOf } from '../../components/doc/doc-head.jsx';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { IntroRail } from '../../components/Introduction/index.jsx';
import { uploadMany, snippetsOf } from '../../components/attach/upload.js';
import { extractMdHeadings, insertAttachmentSnippet, renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { docTitleFromMd, setDocTitleInMd } from '../../../../shared/doc-title.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { notifyDocsChanged } from '../../modules/md/doc-bus.js';
import { useWikiNav } from './use-wiki-nav.js';

export { useWikiNav };
export type { DocOpenExtra, WikiNav } from './use-wiki-nav.js';

/** 介绍文档集的一行（右侧轨）。 */
interface IntroLink {
  docId: string;
  label: string;
  note: string;
  main: boolean;
}

/** 编辑器对外暴露的少量句柄（undo/redo 后恢复光标）。 */
interface EditorApi {
  caretFromDiff?: (prev: string, next: string) => void;
}

// md-render 仍未类型化（attachments 默认值 = [] 让参数退化成 never[]），
// 按真实契约在这里重新标注一次（本页唯一的断言点）。
const renderDocHtml = renderMarkdownHtml as unknown as (
  src: string | undefined,
  attachments?: Attachment[],
  knownNames?: Set<string> | null,
) => string;

export default function DocPanel({ docId, repoKey, boardKey, boardName, model, tabId }: {
  docId?: string;
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
  model?: Model | null;
  tabId?: string;
}) {
  const toast = useToast();
  const app = useApp();
  const { dialog, node: dialogNode } = useDialog();
  const histRef = useRef<Map<string, unknown>>(new Map());
  const editorApiRef = useRef<EditorApi | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 双链委托挂在根节点上（预览里的 <a data-wl> 点击冒泡到这里即导航）
  const { onClick: onNavClick, openByDocId } = useWikiNav(model);

  const ownerKind = repoKey ? 'repo' : boardKey ? 'board' : '';
  const ownerKey = repoKey || boardKey || '';
  const openExtra = useMemo(() => {
    if (repoKey) return { repoKey };
    if (boardKey) return { boardKey, boardName: boardName || '' };
    return {};
  }, [repoKey, boardKey, boardName]);

  const [doc, setDoc] = useState<DocItem | null>(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  // #107：描述行直接可编辑（不再点「改」弹窗）——草稿 + 保存态
  const [descDraft, setDescDraft] = useState('');
  const [descBusy, setDescBusy] = useState(false);
  // 底部信息面板（附件 / 归属）：与任务页同一套 dock 状态，存储空间另用 'doc'；
  // 文档页首次进入默认收起（编辑正文为主），入口常驻在底部状态栏
  const dock = useDock('doc', false);
  const [introLinks, setIntroLinks] = useState<IntroLink[]>([]);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  // 最新文档镜像：附件上传是异步的，await 期间用户可能还在敲字，
  // 插入片段得基于最新正文（同任务页 peekDoc 的考量），不能拿闭包里的旧 doc 覆盖
  const docRef = useRef<DocItem | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);

  // #107：描述草稿跟随文档（换文档、保存回来都会重置）。用 desc 而不是 refId 作依赖，
  // 保存成功后服务端回填的 desc 立即反映到输入框，不会和用户正在敲的内容打架。
  useEffect(() => {
    setDescDraft(doc?.desc || '');
  }, [doc?.refId, doc?.desc]);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await getDocItem(docId || '');
      setDoc(d);
      setDirty(false);
    } catch (e) {
      setError(String((e as Error).message || e));
      setDoc(null);
    }
  }, [docId]);

  useEffect(() => {
    setDoc(null);
    load();
  }, [load]);

  // 介绍文档集：项目 / 组统一列进右侧轨（v7：按 ref 归属读，只显示 desc/标题）
  const loadIntroLinks = useCallback(() => {
    if (!ownerKey) {
      setIntroLinks([]);
      return;
    }
    const current = docId
      ? [{ docId, label: '当前', note: '', main: true }]
      : [];
    const toLinks = (rows: Array<{ refId?: string; desc?: string; title?: string; summary?: string; note?: string; main?: boolean }>) => {
      const out: IntroLink[] = [];
      for (const b of rows) {
        if (!b.refId) continue;
        const id = 'ref:' + b.refId;
        if (out.some((x) => x.docId === id)) continue;
        // 显示名：正文标题 → desc → 正文首行摘要（v8 没有路径名了，摘要是兜底）
        out.push({ docId: id, label: b.title || b.desc || b.summary || '未命名文档', note: b.desc || b.note || '', main: !!b.main });
      }
      if (docId && !out.some((x) => x.docId === docId)) out.push(current[0]!);
      return out;
    };
    if (ownerKind === 'repo') {
      docsBindings({ host: ownerKey })
        .then((d) => setIntroLinks(toLinks(d.bindings || [])))
        .catch(() => setIntroLinks(current));
      return;
    }
    // board：先把 id 解析成组 key（docs bindings 按 group key 查）
    listBoards()
      .then(async (d) => {
        const boards = (d && d.boards) || (Array.isArray(d) ? d : []);
        const b = boards.find((x: { id?: string; key?: string }) => x.id === ownerKey || x.key === ownerKey);
        const res = await docsBindings({ group: String(b?.key || ownerKey) });
        setIntroLinks(toLinks(res.bindings || []));
      })
      .catch(() => setIntroLinks(current));
  }, [ownerKey, ownerKind, docId]);
  useEffect(() => { loadIntroLinks(); }, [loadIntroLinks]);

  // 双链索引：一次拉取（刷新页签即刷新；不监听文件系统是第一块的取舍）
  const [known, setKnown] = useState<Set<string> | null>(null); // 双链已解析名集合（渲染未解析态用）
  useEffect(() => {
    loadDocsIndex()
      .then((d) => {
        const set = new Set<string>();
        for (const x of d.index || []) {
          set.add(x.name);
          if (x.path) set.add(String(x.path).replace(/\\/g, '/').toLowerCase());
        }
        setKnown(set);
      })
      .catch(() => {});
  }, []);

  const writable = !!(doc && doc.writable);
  // 归属（ref 视角）：数据与写操作都在 hook 里，面板只拿节点——dock 收起时计数也要准
  const bind = useDocBindings(docId, writable, doc ? (doc.title || doc.desc || doc.summary || '未命名文档') : '');
  // #168：ref 引用在预览/编辑器里显示**文档标题**——需要附件清单里的 ref 条目
  // （服务端读盘补的标题），渲染时按 refId 查表替换链接文字。
  const [attList, setAttList] = useState<Attachment[]>([]);
  // dock 头要显示附件数，挂/摘完还要立刻可见 → 用 tick 驱动重拉
  const [attTick, setAttTick] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!docId) {
      setAttList([]);
      return undefined;
    }
    docAttachments(docId)
      .then((d) => { if (alive) setAttList((d && (d.attachments || d.data?.attachments)) || []); })
      .catch(() => { if (alive) setAttList([]); });
    return () => { alive = false; };
  }, [docId, attTick]);
  const previewHtml = useMemo(
    // 外部/缺失文档不判未解析态（known=null = 全部普通样式）
    () => (doc ? renderDocHtml(doc.body, attList, writable ? known : null) : ''),
    [doc, known, writable, attList]
  );
  const headings = useMemo(() => (doc ? extractMdHeadings(doc.body) : []), [doc]);

  // 预览滚动容器：预览态 .mdw-preview / 实时预览 .mdw-lp
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const pick = () => root.querySelector<HTMLElement>('.mdw-preview, .mdw-lp') || null;
    setScrollRoot(pick());
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => setScrollRoot(pick())) : null;
    if (mo) mo.observe(root, { childList: true, subtree: true });
    return () => { if (mo) mo.disconnect(); };
  }, [doc, mode, previewHtml]);

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e)));

  const openIntroDoc = useCallback(
    (id: string) => openByDocId(id, null, openExtra),
    [openByDocId, openExtra]
  );

  // 「更多 → 文字列表」（#88）：与「进程」同一个右侧栏位，列本项目 / 项目组的全部文章。
  // docs 页签挂在 center、refs 挂在 right，互不顶替，编辑器不会被挤走。
  const openRefsPanel = useCallback(() => {
    const m = model;
    if (!m || !ownerKey) return;
    openPanel(m, {
      component: 'refs',
      name: '文档列表',
      config: repoKey
        ? { repoKey }
        : { boardKey, boardName: boardName || '' },
      location: 'right',
    });
  }, [model, ownerKey, repoKey, boardKey, boardName]);

  // 补充一篇文档（项目 / 组同口径）：直接建 ref（DB 实体 + 归属），
  // 不创建 reference/<slug>.md 这类物理路径——ref 不是文件。
  const addRefDoc = () => {
    if (!ownerKey) return;
    guard(async () => {
      const name = await dialog({
        title: '补充介绍文档',
        input: true,
        placeholder: '文档描述（列表里显示这一行，便于快速定位）',
      });
      if (name === null) return;
      const desc = String(name).trim();
      if (!desc) return;
      // 建文档 + 起标题骨架 + 广播刷新，都在 refs.ops 里（列表 CRUD 唯一入口）
      const refId = await createDoc(
        ownerKind === 'repo'
          ? { owner: 'repo', repo: ownerKey, desc, title: desc }
          : { owner: 'group', group: ownerKey, desc, title: desc }
      );
      toast(`已补充：${desc}`);
      loadIntroLinks();
      openByDocId('ref:' + refId, null, openExtra);
    });
  };

  // ─── 保存（正文进库；desc 由服务端按需回填 / 用户手写优先）───
  // savingRef：一次保存没落地前不再进第二次——Ctrl+S 连击与页头「保存」按钮
  // 是两条入口，键盘侧的节流管不到按钮（#189）
  const savingRef = useRef(false);
  const save = () =>
    guard(async () => {
      if (!doc || !writable || savingRef.current) return;
      savingRef.current = true;
      try {
        const nextBody = doc.body;
        const res = await updateDocItem({ ref: docId, body: nextBody });
        setDoc((d) => (d ? { ...d, body: nextBody, summary: res.summary, desc: res.desc ?? d.desc } : d));
        setDirty(false);
        clearHistory(histRef.current, docId);
        // 标题可能变了（正文首行）→ 右轨与「文档列表」跟着刷（#183）
        loadIntroLinks();
        notifyDocsChanged();
        toast(res.summary ? '已保存，摘要已回写' : '已保存');
      } finally {
        savingRef.current = false;
      }
    });

  // ─── 编辑（#168：文档标题 = 正文**首行**的 `# 标题`；正文第一行不再顶替标题）───
  const onBody = (next: string, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, docId, { body: doc.body }, kind);
    setDirty(true);
    setDoc((d) => (d ? { ...d, body: next, title: docTitleFromMd(next) || d.title } : d));
  };

  const onTitle = (next: string, kind = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, docId, { body: doc.body }, kind);
    setDirty(true);
    // 改写**首行**的标题行（首行不是 # 就补到文首）——标题行永远在首行，
    // 不会被正文其它 # 行带偏。
    const b = setDocTitleInMd(doc.body, next);
    setDoc((d) => (d ? { ...d, body: b, title: next } : d));
  };

  const undo = () => {
    if (!doc) return;
    const snap = undoHistory(histRef.current, docId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => (d ? { ...d, body: snap.body, title: docTitleFromMd(snap.body) || d.title } : d));
    setDirty(true);
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body || '', snap.body));
  };

  const redo = () => {
    if (!doc) return;
    const snap = redoHistory(histRef.current, docId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => (d ? { ...d, body: snap.body, title: docTitleFromMd(snap.body) || d.title } : d));
    setDirty(true);
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body || '', snap.body));
  };

  // ─── 附件：粘贴 / 拖入图片 → 传本机附件仓（一律 local:true）→ markdown 片段插到落点 ───
  // 落点换算交给 insertAttachmentSnippet：源码模式给全文偏移 insertAt，
  // 实时预览给块内坐标（focusIndex/caretInBlock）；拿不到落点就追加文尾。
  const addFiles = async (fileList: FileList | File[] | null, opts: FileDropCtx = {}) => {
    if (!writable) return;
    const files: File[] = [...(fileList || [])];
    if (!files.length) return;
    try {
      const upOpts: { onProgress?: (i: number, total: number, f: File) => void } = {
        onProgress: (i: number, total: number, f: File) => toast(`正在上传 ${i}/${total}：${f.name}`),
      };
      const results = await uploadMany(files, upOpts);
      const snippet = snippetsOf(results);
      if (!snippet) return;
      const cur = docRef.current || doc;
      if (!cur) return;
      const placed = insertAttachmentSnippet(cur.body, snippet, opts);
      pushHistory(histRef.current, docId, { body: cur.body });
      setDirty(true);
      setDoc((d) => (d ? { ...d, body: placed.body, title: docTitleFromMd(placed.body) || d.title } : d));
      toast(`已插入 ${results.length} 个附件`);
    } catch (e) {
      toast(`附件上传失败：${String((e as Error).message || e)}`);
    }
  };

  // ─── 改描述：ref 是 DB 实体，没有路径可改；desc 是列表 / 提示词模板的快速定位标签 ───
  // #107 起主入口是标题下面那一行**直接输入**（见 renderDescRow），菜单里的「改描述」
  // 保留给习惯弹窗的人；两条路走同一个 PATCH。
  const renameDoc = () => {
    if (!doc) return;
    guard(async () => {
      const next = await dialog({
        title: '改描述',
        input: true,
        value: doc.desc || '',
        placeholder: '一句话描述（列表 / 提示词模板里显示）',
      });
      if (next === null) return;
      const desc = String(next).trim();
      const res = await updateDocItem({ ref: docId, desc });
      setDoc((d) => (d ? { ...d, desc: res.desc ?? desc } : d));
      toast('描述已更新');
      notifyDocsChanged();
    });
  };

  /** #107：行内描述保存（失焦 / 回车触发；Esc 放弃）。空串合法 = 清掉描述。 */
  const saveDesc = async () => {
    if (!doc || !writable || descBusy || !docId) return;
    const next = descDraft.trim();
    if (next === String(doc.desc || '').trim()) return;
    setDescBusy(true);
    try {
      // #120：写入 + 广播统一走 refs 模块，不在页面里另拼一次
      const saved = await saveDocDesc(docId, next);
      setDoc((d) => (d ? { ...d, desc: saved } : d));
      toast('描述已更新');
    } catch (e) {
      toast(String((e as Error).message || e));
      setDescDraft(doc.desc || '');
    } finally {
      setDescBusy(false);
    }
  };

  // ─── 删除：danger 确认 → DELETE 落盘 → 主布局就地回归属页（不拆面板，#191 同规）───
  const delDoc = () => {
    if (!doc) return;
    const label = doc.desc || doc.title || doc.refId || docId;
    guard(async () => {
      const ok = await dialog({
        title: `删除文档「${label}」`,
        message: `库内文档 ${label} 及其正文会被一并删除，不可恢复。`,
        danger: true,
        okText: '删除',
      });
      if (!ok) return;
      await removeDocItem({ ref: docId });
      toast(`已删除：${label}`);
      notifyDocsChanged();
      // #191 同规：maincontent 永远不会被删除——主布局里的文档页就地回归属页
      // （仓库 → 仓库管理，项目组 → 组页）；浮窗 / 旁路是辅助视图，直接关掉。
      const node = (tabId && (model || app.model || null)?.getNodeById?.(tabId)) as
        | { getConfig?: () => Record<string, unknown>; getWindowId?: () => string }
        | undefined;
      const cfg = (node && node.getConfig && node.getConfig()) || {};
      const auxiliary =
        (typeof node?.getWindowId === 'function' && node.getWindowId() === 'float') || !!cfg.beside;
      if (auxiliary || !app.onNavigate || (!repoKey && !boardKey)) {
        if (model && tabId) model.doAction(Actions.deleteTab(tabId));
      } else if (repoKey) {
        app.onNavigate('#/repos');
      } else {
        app.onNavigate('#/group/' + encodeURIComponent(boardKey || ''));
      }
    });
  };

  // ─── 特殊形态：目录绑定（外部目录 → 文件清单）───
  if (doc && doc.dir) {
    return (
      <div className="mdw docp">
        <div className="docp-head">
          <span className="docp-path mono">{doc.path}</span>
          <span className="docp-tag ext">外部目录 · 只读</span>
        </div>
        <div className="docp-files">
          {(doc.files || []).map((f: string) => (
            <button key={f} className="docp-file" onClick={() => openByDocId('path:' + f, null)}>
              {f}
            </button>
          ))}
          {!(doc.files || []).length && <div className="muted pad">（目录里还没有 .md 文档）</div>}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mdw docp">
        <div className="pad stack">
          <div><strong>文档打开失败</strong></div>
          <div className="hint">{error}</div>
        </div>
      </div>
    );
  }

  if (!doc) return <div className="mdw"><div className="pad muted">载入中…</div></div>;

  // 缺失的条目：历史空壳 / 外部镜像 / 正文缺失——只解释原因，不提供「创建骨架」
  // （v8 新建文档走宿主面板的 ＋，创建的是空正文的直接 ref）。
  if (doc.missing) {
    const shell = !!doc.kind;
    return (
      <div className="mdw docp">
        <div className="docp-head">
          <span className="docp-path mono">{doc.path || doc.desc || doc.title || '未命名文档'}</span>
        </div>
        <div className="pad stack">
          <div><strong>{shell ? '这条文档没有正文' : '文档还没有正文'}</strong></div>
          <div className="hint">
            {shell
              ? String(doc.reason || '历史索引条目或外部文件镜像，正文不在库内。')
              : '正文的唯一来源是库内 ref_bodies。'}
          </div>
        </div>
      </div>
    );
  }

  // 只读文档：没有模式可选，渲染阅读视图（「阅读」不再是可选模式，#47）
  const effMode = writable ? mode : 'read';

  return (
    <div className="mdw docp" data-mode={effMode} onClick={onNavClick} ref={rootRef}>
      <div className="mdw-main">
        {/* 页头：#88 之后弹窗只负责"选哪篇"，编辑页只有这一个是 maincontent 里的 DocPanel。
            面包屑 / 标题·路径 / 更多 · 保存 一条线，下面是编辑器本体。 */}
        {/* DocHead / IntroRail 尚未类型化：插槽 props 因 = null / = [] 默认值退化成 null / never[]，
            这里在调用边界上放宽，不改它们的实现（属他人负责文件） */}
        <DocHead
          crumb={<RouteBreadcrumb /> as unknown as null}
          title={doc.title || doc.desc || doc.summary || '未命名文档'}
          pathLabel={doc.path || ''}
          dirty={dirty}
          writable={writable}
          external={!!doc.external}
          menuGroups={([
            groupOf('edit', '编辑', [
              {
                id: 'mode',
                label: mode === 'edit' ? '返回实时预览' : '源码模式',
                hint: mode === 'edit' ? '当前' : '',
                run: () => setMode(mode === 'edit' ? 'split' : 'edit'),
              },
            ]),
            groupOf('doc', '文档', [
              { id: 'rename', label: '改描述', run: renameDoc },
              { id: 'delete', label: '删除', run: delDoc, danger: true },
            ]),
            groupOf('view', '查看', [
              ownerKey && {
                id: 'list',
                label: '文字列表',
                hint: '右侧边栏',
                run: openRefsPanel,
              },
            ]),
          ]) as unknown as never[]}
          onSave={save as unknown as null}
        />
        {/* desc 是「快速定位」的一句话：标题下面直接可编辑（#107：不再点「改」），
            失焦 / 回车保存，Esc 放弃；只读文档照旧显示成文字。 */}
        <div className={'docp-desc' + (doc.desc ? '' : ' empty')}>
          <span className="k">描述</span>
          {writable ? (
            <input
              className="docp-desc-input"
              value={descDraft}
              disabled={descBusy}
              spellCheck={false}
              placeholder="未填写——写一句这篇讲什么，列表与提示词里用它快速定位"
              aria-label="文档描述（失焦或回车保存）"
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={() => { void saveDesc(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  setDescDraft(doc.desc || '');
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span className="v">{doc.desc || '未填写——写一句这篇讲什么，列表与提示词里用它快速定位'}</span>
          )}
        </div>
        <MdPanes
          mode={effMode}
          title={doc.title}
          body={doc.body}
          previewHtml={previewHtml}
          onTitle={writable ? onTitle : undefined}
          onBody={writable ? onBody : undefined}
          onFiles={writable ? addFiles : null}
          attachments={attList}
          docKey={docId}
          editorApiRef={editorApiRef}
          onSave={writable ? save : null}
          onUndo={writable ? undo : null}
          onRedo={writable ? redo : null}
        />
        {/* 信息面板（#183）：附件 / 归属两个 tab，外壳与任务页同构（可拖高 / 最大化 / 关闭） */}
        <DocDockPanel
          dock={dock}
          attCount={attList.length}
          bindCount={bind.count}
          attachNode={(
            <DocAttachBody
              refId={docId}
              writable={writable}
              onChanged={() => setAttTick((n) => n + 1)}
              onOpenDoc={(locator: unknown) => {
                const id = docIdOfLocator(locator);
                if (id) openByDocId(id, null, openExtra);
              }}
            />
          )}
          bindNode={bind.strip}
        />
        {/* 状态栏：面板收起后入口仍常驻（附件 / 归属 + 展开箭头） */}
        <DocStatusBar dock={dock} attCount={attList.length} bindCount={bind.count} />
      </div>
      <IntroRail
        headings={headings as unknown as never[]}
        scrollRoot={scrollRoot as unknown as null}
        links={introLinks as unknown as never[]}
        activeDocId={docId}
        onOpenDoc={(ownerKey ? openIntroDoc : null) as unknown as null}
        onAddRef={(ownerKey ? addRefDoc : null) as unknown as null}
      />
      {dialogNode}
      {/* 加绑弹窗（归属 tab 里的「＋ 加绑宿主」唤起） */}
      {bind.modal}
    </div>
  );
}
