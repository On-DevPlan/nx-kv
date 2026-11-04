// 文档页签面板 —— 一个文档 = 工作区里的一等页签（与任务页同构）。
//
// **真相在磁盘**：打开 GET /api/docs/item 拉正文，保存 PATCH /api/docs/item 写盘。
// 不进 doc-store.js——那是任务草稿的会话内存，文档不需要会话副本（刷新即重新读盘，
// 与 Obsidian 的心智一致）。
//
// 双链 [[..]] 点击 → 在工作区开目标文档的页签：openPanel 按 component+config 去重，
// 同一文档反复点只会聚焦已开的页签。解析规则与后端共用 core/wikilink.js。
// 外部绑定（writable:false）强制预览态——改动请回 vault。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useDialog, useToast } from '../../components/ui.jsx';
import { useApp } from '../../app-context.jsx';
import { openPanel } from '../../workspace.js';
import { MdPanes, ModeSeg } from '../../components/md/md-panes.jsx';
import { IntroRail, introDirFromRef } from '../../components/Introduction/index.jsx';
import { extractMdHeadings, renderMarkdownHtml, slugName, titleFromMd } from '../../modules/md/md-parse.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { resolveWikiLink } from '../../../../shared/wikilink.js';

/**
 * 双链导航（DocPanel 与组详情共用）：拉一次索引，解析目标 → 开 doc 页签。
 * 多同名候选不猜（列出 docId 让人挑）；未命中提示用 CLI 创建。
 */
export function useWikiNav(model) {
  const app = useApp() || {};
  const toast = useToast();
  const m = model || app.model;
  const indexRef = useRef(null);

  const ensureIndex = useCallback(async () => {
    if (!indexRef.current) {
      try {
        indexRef.current = (await api('/api/docs/index')).index || [];
      } catch {
        indexRef.current = [];
      }
    }
    return indexRef.current;
  }, []);

  const openByDocId = useCallback(
    async (targetDocId, index, extra = {}) => {
      const idx = index || (await ensureIndex());
      const entry = idx.find((x) => x.docId === targetDocId);
      openPanel(m, {
        component: 'doc',
        name: entry ? entry.name : targetDocId,
        config: {
          docId: targetDocId,
          ...(extra.repoKey ? { repoKey: extra.repoKey } : {}),
          ...(extra.boardKey ? { boardKey: extra.boardKey, boardName: extra.boardName || '' } : {}),
        },
        location: 'center',
      });
    },
    [m, ensureIndex]
  );

  const nav = useCallback(
    async (target) => {
      const index = await ensureIndex();
      const hit = resolveWikiLink(target, index);
      if (hit && hit.docId) return openByDocId(hit.docId, index);
      if (hit && hit.candidates) return toast(`「${target}」同名文档多份：${hit.candidates.join('、')}`);
      toast(`未找到「${target}」——可用 nx-kv docs add <rel> 创建`);
    },
    [ensureIndex, openByDocId, toast]
  );

  // 预览容器的事件委托：点 [data-wl] 即导航
  const onClick = useCallback(
    (e) => {
      const a = e.target.closest('[data-wl]');
      if (!a) return;
      e.preventDefault();
      nav(a.getAttribute('data-wl'));
    },
    [nav]
  );

  return { nav, onClick, ensureIndex, openByDocId };
}

export default function DocPanel({ docId, repoKey, boardKey, boardName, model }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const histRef = useRef(new Map());
  const editorApiRef = useRef(null);
  const rootRef = useRef(null);
  // 双链委托挂在根节点上（预览里的 <a data-wl> 点击冒泡到这里即导航）
  const { onClick: onNavClick, openByDocId } = useWikiNav(model);

  const ownerKind = repoKey ? 'repo' : boardKey ? 'board' : '';
  const ownerKey = repoKey || boardKey || '';
  const openExtra = useMemo(() => {
    if (repoKey) return { repoKey };
    if (boardKey) return { boardKey, boardName: boardName || '' };
    return {};
  }, [repoKey, boardKey, boardName]);

  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  const [introLinks, setIntroLinks] = useState([]);
  const [scrollRoot, setScrollRoot] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await api('/api/docs/item?ref=' + encodeURIComponent(docId || ''));
      setDoc(d);
      setDirty(false);
    } catch (e) {
      setError(String(e.message || e));
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
      api('/api/repos/docs?id=' + encodeURIComponent(ownerKey))
        .then((d) => {
          const out = [];
          const push = (x, main) => {
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
    api('/api/boards')
      .then((d) => {
        const boards = (d && d.boards) || (Array.isArray(d) ? d : []);
        const b = boards.find((x) => x.id === ownerKey || x.key === ownerKey);
        const out = [];
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
  const [known, setKnown] = useState(null); // 双链已解析名集合（渲染未解析态用）
  useEffect(() => {
    api('/api/docs/index')
      .then((d) => {
        const set = new Set();
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
  const previewHtml = useMemo(
    // 外部/缺失文档不判未解析态（known=null = 全部普通样式）
    () => (doc ? renderMarkdownHtml(doc.body, [], writable ? known : null) : ''),
    [doc, known, writable]
  );
  const headings = useMemo(() => (doc ? extractMdHeadings(doc.body) : []), [doc]);

  // 预览滚动容器：预览态 .mdw-preview / 实时预览 .mdw-lp
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const pick = () => root.querySelector('.mdw-preview, .mdw-lp') || null;
    setScrollRoot(pick());
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => setScrollRoot(pick())) : null;
    if (mo) mo.observe(root, { childList: true, subtree: true });
    return () => { if (mo) mo.disconnect(); };
  }, [doc, mode, previewHtml]);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  const openIntroDoc = useCallback(
    (id) => openByDocId(id, null, openExtra),
    [openByDocId, openExtra]
  );

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
      await api('/api/docs/item', {
        method: 'POST',
        body: { rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` },
      });
      try {
        if (ownerKind === 'repo') {
          await api('/api/repos/docs', { method: 'POST', body: { id: ownerKey, rel } });
        } else {
          await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, doc: rel } });
        }
      } catch {
        /* 已在集里 / 旧数据：文件已创建即可打开 */
      }
      toast(`已补充：${rel}`);
      loadIntroLinks();
      openByDocId('rel:' + rel, null, openExtra);
    });
  };

  // ─── 保存（写盘 + 摘要回写 desc / 组内 note）───
  const save = () =>
    guard(async () => {
      if (!doc || !writable) return;
      const res = await api('/api/docs/item', { method: 'PATCH', body: { ref: docId, body: doc.body } });
      setDoc((d) => ({ ...d, body: doc.body, summary: res.summary }));
      setDirty(false);
      clearHistory(histRef.current, docId);
      toast(res.summary ? '已保存，摘要已回写' : '已保存');
    });

  // ─── 编辑（文档没有独立标题：标题 = 正文首个 # 行）───
  const onBody = (next, kind = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, docId, { body: doc.body }, kind);
    setDirty(true);
    setDoc((d) => ({ ...d, body: next, title: titleFromMd(next, d.title) }));
  };

  const onTitle = (next, kind = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, docId, { body: doc.body }, kind);
    setDirty(true);
    const b = /^#\s+/m.test(doc.body)
      ? doc.body.replace(/^#\s+.+$/m, `# ${next || '未命名文档'}`)
      : `# ${next || '未命名文档'}\n\n${doc.body}`;
    setDoc((d) => ({ ...d, body: b, title: next }));
  };

  const undo = () => {
    if (!doc) return;
    const snap = undoHistory(histRef.current, docId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => ({ ...d, body: snap.body, title: titleFromMd(snap.body, d.title) }));
    setDirty(true);
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  const redo = () => {
    if (!doc) return;
    const snap = redoHistory(histRef.current, docId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => ({ ...d, body: snap.body, title: titleFromMd(snap.body, d.title) }));
    setDirty(true);
    requestAnimationFrame(() => editorApiRef.current?.caretFromDiff?.(doc.body, snap.body));
  };

  // 缺失的自有文档：给一个「创建骨架」的出口（约定路径/自选路径都走 POST）
  const createDoc = () =>
    guard(async () => {
      const rel = String(docId || '').startsWith('rel:')
        ? docId.slice(4)
        : String(docId || '').startsWith('path:')
          ? ''
          : String(docId || '');
      if (!rel) return;
      const name = rel.replace(/\.md$/i, '').split('/').pop() || '未命名文档';
      await api('/api/docs/item', { method: 'POST', body: { rel, body: `# ${name}\n\n（待补）\n` } });
      toast(`已创建：${rel}`);
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
          {doc.files.map((f) => (
            <button key={f} className="docp-file" onClick={() => openByDocId('path:' + f, null)}>
              {f}
            </button>
          ))}
          {!doc.files.length && <div className="muted pad">（目录里还没有 .md 文档）</div>}
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

  const effMode = writable ? mode : 'preview';

  return (
    <div className="mdw docp" data-mode={effMode} onClick={onNavClick} ref={rootRef}>
      <div className="mdw-main">
        <div className="docp-head">
          <span className="docp-path mono" title={doc.rel || doc.path}>
            {doc.rel || doc.path}
          </span>
          {dirty && <span className="docp-dirty">未保存</span>}
          {!writable && <span className="docp-tag ext">外部绑定 · 只读</span>}
          <span className="grow" />
          {writable && (
            <>
              <ModeSeg mode={effMode} onChange={setMode} />
              <button className="btn sm docp-save" onClick={save}>保存</button>
            </>
          )}
        </div>
        {doc.summary && writable && <div className="docp-summary">摘要（回写 desc）：{doc.summary}</div>}
        <MdPanes
          mode={effMode}
          title={doc.title}
          body={doc.body}
          previewHtml={previewHtml}
          onTitle={writable ? onTitle : null}
          onBody={writable ? onBody : null}
          attachments={[]}
          docKey={docId}
          editorApiRef={editorApiRef}
          onSave={writable ? save : null}
          onUndo={writable ? undo : null}
          onRedo={writable ? redo : null}
        />
        <div className="docp-hint">双链 [[]] 点击跳转 · Ctrl+S 保存 · 文档即磁盘文件（~/.nx-kv/docs/）</div>
      </div>
      <IntroRail
        headings={headings}
        scrollRoot={scrollRoot}
        links={introLinks}
        activeDocId={docId}
        onOpenDoc={ownerKey ? openIntroDoc : null}
        onAddRef={ownerKey ? addRefDoc : null}
      />
      {dialogNode}
    </div>
  );
}
