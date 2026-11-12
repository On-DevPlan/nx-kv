// 文档页签面板 —— 一个文档 = 工作区里的一等页签（与任务页同构）。
//
// **真相在磁盘**：打开 GET /api/docs/item 拉正文，保存 PATCH /api/docs/item 写盘。
// 不进 doc-store.js——那是任务草稿的会话内存，文档不需要会话副本（刷新即重新读盘，
// 与 Obsidian 的心智一致）。
//
// 双链 [[..]] 点击 → 在工作区开目标文档的页签：openPanel 按 component+config 去重，
// 同一文档反复点只会聚焦已开的页签。解析规则与后端共用 core/wikilink.js。
// 外部绑定（path:）也可写：登记在册 = 我的文档集，保存直接写回来源文件
// （后端再校验一次绑定闭包）；只有目录绑定（dir）仍是只读清单。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Actions } from 'flexlayout-react';
import type { Model } from 'flexlayout-react';
import {
  bindRepoDoc,
  createDocItem,
  docAttachments,
  linkBoardDoc,
  listBoards,
  loadDocsIndex,
  removeDocItem,
  getDocItem,
  updateDocItem,
  type DocItem,
  repoDocs,
} from './api.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { openPanel } from '../../workspace.js';
import { MdPanes } from '../../components/md/md-panes.jsx';
import DocAttachDock from './attach-dock.js';
import { docIdOfLocator } from '../../components/md/attach-common.js';
import type { Attachment } from '../../components/md/attach-common.js';
import type { FileDropCtx } from '../../components/md/md-panes-helpers.js';
import DocHead, { groupOf } from '../../components/doc/doc-head.jsx';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { IntroRail, introDirFromRef } from '../../components/Introduction/index.jsx';
import { uploadMany, snippetsOf } from '../../components/cloud/upload.js';
import { extractMdHeadings, insertAttachmentSnippet, renderMarkdownHtml, slugName } from '../../modules/md/md-parse.js';
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
  // 附件 dock 展开态（默认展开：文档页的附件是常用入口，#183 统一成任务页的 dock 外壳）
  const [dockOpen, setDockOpen] = useState(true);
  const [introLinks, setIntroLinks] = useState<IntroLink[]>([]);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  // 最新文档镜像：附件上传是异步的，await 期间用户可能还在敲字，
  // 插入片段得基于最新正文（同任务页 peekDoc 的考量），不能拿闭包里的旧 doc 覆盖
  const docRef = useRef<DocItem | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);

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

  // 介绍文档集：项目 / 组统一列进右侧轨
  const loadIntroLinks = useCallback(() => {
    if (!ownerKey) {
      setIntroLinks([]);
      return;
    }
    if (ownerKind === 'repo') {
      repoDocs(ownerKey)
        .then((d) => {
          const out: IntroLink[] = [];
          const push = (x: { rel?: string; path?: string; note?: string } | null | undefined, main: boolean) => {
            if (!x) return;
            const id = x.rel ? 'rel:' + x.rel : x.path ? 'path:' + x.path : '';
            if (id) out.push({ docId: id, label: x.rel || x.path || (main ? '主篇' : '补充'), note: x.note || '', main });
          };
          // 主篇：登记表里的 main；没登记则回退**约定路径** repo/<key>.md
          // （介绍文档的权威路径就是它 —— 登记与否只是「有没有显式挂载」）
          push(d.main || { rel: `repo/${ownerKey}.md` }, true);
          for (const l of d.links || []) push(l, false);
          // 当前打开的文档不在集里（读的是某篇补充）→ 补一行「当前」
          if (docId && !out.some((x) => x.docId === docId)) {
            out.push({ docId, label: '当前', note: '', main: true });
          }
          setIntroLinks(out);
        })
        .catch(() => setIntroLinks(docId ? [{ docId, label: '当前', note: '', main: true }] : []));
      return;
    }
    // board：从看板数据里取 docLinks（看板在 /api/boards，不在 /api/repos）
    listBoards()
      .then((d) => {
        const boards = (d && d.boards) || (Array.isArray(d) ? d : []);
        const b = boards.find((x: { id?: string; key?: string }) => x.id === ownerKey || x.key === ownerKey);
        const out: IntroLink[] = [];
        if (docId) out.push({ docId, label: '当前', note: '', main: true });
        for (const l of (b && b.docLinks) || []) {
          const id = l.rel ? `rel:${l.rel}` : l.path ? `path:${l.path}` : '';
          if (!id || out.some((x) => x.docId === id)) continue;
          out.push({ docId: id, label: l.rel || l.path || '补充', note: l.note || '', main: false });
        }
        setIntroLinks(out);
      })
      .catch(() => setIntroLinks(docId ? [{ docId, label: '当前', note: '', main: true }] : []));
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
          if (x.rel) set.add(String(x.rel).toLowerCase());
          if (x.path) set.add(String(x.path).replace(/\\/g, '/').toLowerCase());
        }
        setKnown(set);
      })
      .catch(() => {});
  }, []);

  const writable = !!(doc && doc.writable);
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

  // 补充一篇 reference（项目 / 组同口径）
  const addRefDoc = () => {
    if (!ownerKey) return;
    guard(async () => {
      const name = await dialog({
        title: '补充介绍文档',
        input: true,
        placeholder: '文档名（如 architecture / api-notes）',
      });
      if (name === null) return;
      const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
      const base = String(docId || '').startsWith('rel:')
        ? introDirFromRef(docId)
        : (ownerKind === 'repo' ? `repo/${ownerKey}` : `board/${boardName || ownerKey}`);
      const rel = `${base}/reference/${slug}.md`;
      await createDocItem({ rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` });
      try {
        if (ownerKind === 'repo') {
          await bindRepoDoc({ id: ownerKey, rel });
        } else {
          await linkBoardDoc({ board: ownerKey, doc: rel });
        }
      } catch {
        /* 已在集里 / 旧数据：文件已创建即可打开 */
      }
      toast(`已补充：${rel}`);
      notifyDocsChanged();
      loadIntroLinks();
      openByDocId('rel:' + rel, null, openExtra);
    });
  };

  // ─── 保存（写盘 + 摘要回写 desc / 组内 note）───
  const save = () =>
    guard(async () => {
      if (!doc || !writable) return;
      const nextBody = doc.body;
      const res = await updateDocItem({ ref: docId, body: nextBody });
      setDoc((d) => (d ? { ...d, body: nextBody, summary: res.summary } : d));
      setDirty(false);
      clearHistory(histRef.current, docId);
      // 标题可能变了（正文首行）→ 右轨与「文档列表」跟着刷（#183）
      loadIntroLinks();
      notifyDocsChanged();
      toast(res.summary ? '已保存，摘要已回写' : '已保存');
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
      // uploadMany 的实现已支持 onProgress，但其 options 类型尚未声明该字段
      const upOpts: { local?: boolean; onProgress?: (i: number, total: number, f: File) => void } = {
        local: true,
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

  // ─── 重命名：自有文档 = 磁盘文件换路径 —— POST 新 rel（复制正文）→ DELETE 旧 ref → 开新页签 ───
  const renameDoc = () => {
    if (!doc || !doc.rel) return;
    const prevRel = doc.rel;
    const prevBody = doc.body;
    guard(async () => {
      const next = await dialog({
        title: '重命名文档',
        input: true,
        value: prevRel,
        placeholder: '新路径（相对 docs 根，以 .md 结尾）',
      });
      if (next === null) return;
      const rel = String(next).trim();
      if (!rel || rel === prevRel) return;
      if (!/\.md$/i.test(rel)) return toast('文档路径必须以 .md 结尾');
      try {
        await createDocItem({ rel, body: prevBody });
      } catch (e) {
        // 目标已存在等冲突由后端报错，原样透出
        toast(`重命名失败：${String((e as Error).message || e)}`);
        return;
      }
      await removeDocItem({ ref: docId });
      clearHistory(histRef.current, docId);
      toast(`已重命名为：${rel}`);
      notifyDocsChanged();
      openByDocId('rel:' + rel, null, openExtra);
    });
  };

  // ─── 删除：danger 确认 → DELETE 落盘 → 关掉当前页签 ───
  const delDoc = () => {
    if (!doc) return;
    const docTitle = doc.title;
    const docRel = doc.rel;
    guard(async () => {
      const ok = await dialog({
        title: `删除文档「${docTitle || docRel || docId}」`,
        message: `磁盘上的 ${docRel || docId} 会被一并删除，不可恢复。`,
        danger: true,
        okText: '删除',
      });
      if (!ok) return;
      await removeDocItem({ ref: docId });
      toast(`已删除：${docRel || docId}`);
      notifyDocsChanged();
      if (model && tabId) model.doAction(Actions.deleteTab(tabId));
    });
  };

  // 缺失的自有文档：给一个「创建骨架」的出口（约定路径/自选路径都走 POST）
  const createDoc = () =>
    guard(async () => {
      const rel = String(docId || '').startsWith('rel:')
        ? String(docId || '').slice(4)
        : String(docId || '').startsWith('path:')
          ? ''
          : String(docId || '');
      if (!rel) return;
      const name = rel.replace(/\.md$/i, '').split('/').pop() || '未命名文档';
      await createDocItem({ rel, body: `# ${name}\n\n（待补）\n` });
      toast(`已创建：${rel}`);
      notifyDocsChanged();
      await load();
    });

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

  if (doc.missing) {
    const creatable = String(docId || '').startsWith('rel:') || !String(docId || '').startsWith('path:');
    return (
      <div className="mdw docp">
        <div className="docp-head">
          <span className="docp-path mono">{doc.rel || doc.path || docId}</span>
        </div>
        <div className="pad stack">
          <div><strong>文档还没有落盘</strong></div>
          <div className="hint">描述内容的权威是磁盘上的 .md 文件——对应的字符串字段会在读取时播种，也可以直接创建骨架。</div>
          {creatable && (
            <div>
              <button className="btn sm" onClick={createDoc}>创建骨架</button>
            </div>
          )}
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
          title={doc.title || doc.rel || doc.path || '文档'}
          pathLabel={doc.rel || doc.path || ''}
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
              { id: 'rename', label: '重命名', run: renameDoc },
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
        {doc.summary && writable && <div className="docp-summary">摘要（回写 desc）：{doc.summary}</div>}
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
        {/* 附件 dock（#183）：外壳、host 口径与折叠都在 attach-dock 里 */}
        <DocAttachDock
          refId={docId}
          count={attList.length}
          writable={writable}
          open={dockOpen}
          onToggle={() => setDockOpen((v) => !v)}
          onChanged={() => setAttTick((n) => n + 1)}
          onOpenDoc={(locator: unknown) => {
            const id = docIdOfLocator(locator);
            if (id) openByDocId(id, null, openExtra);
          }}
        />
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
    </div>
  );
}
