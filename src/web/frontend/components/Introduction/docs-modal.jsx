// 「查看详情」弹窗（项目 / 项目组统一）：**列表视图 + 文档视图**两态，同在一个弹窗里。
//
// #88 反馈「弹窗面板只是显示文章列表不能编辑」后的口径：
//   ① 列表视图：只列标题（不铺 tag、不渲染正文），点一行进文档视图；
//   ② 文档视图：复用 DocPanel 那套 md 编辑器（MdPanes），布局与任务页同构——
//      面包屑（返回列表）/ 标题·路径 / 「更多 · 保存」，右上角保存，更多里放「文字列表」；
//   ③ 写回：自有（rel:）写自有树；外部（path:，Obsidian vault 等）写回原文件——
//      后端 updateDoc 会再校验一次绑定闭包，不在闭包里一律拒写。
//
// 「文字列表」= 与「进程」同一个右侧栏位（component:refs）。弹窗是模态，侧栏会被遮罩
// 压住，所以先关弹窗再开侧栏——用户要的就是"出去看全量列表"。
//
// 数据面：repo → GET /api/repos/docs（main/extras/links 三段），
// board → GET /api/boards/:id（introMain/introExtras/docLinks）。列表自带实时拉取，
// 加/摘/改标签后重拉即可见（不读父层快照——Introduction 旧实现的教训）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../app-context.jsx';
import { MdPanes, ModeSeg } from '../md/md-panes.jsx';
import { renderMarkdownHtml, slugName, titleFromMd } from '../../modules/md/md-parse.js';
import { clearHistory, pushHistory, redoHistory, undoHistory } from '../../modules/md/md-history.js';
import { Modal, useDialog } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import DocHead, { groupOf } from '../doc/doc-head.jsx';
import { useIntro, introDirFromRef } from './use-intro.js';
import { openPanel } from '../../workspace.js';
import './style.css';

function docIdOf(l) {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

function baseLabel(l) {
  const s = l.rel || l.path || '';
  return String(s).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s || '未命名';
}

/**
 * 列表条目：sections = 主篇 / 补充 / reference / 组内（仅项目）。
 * removable=摘除入口（登记的 docLinks 与主篇自定义绑定）；taggable=可改标签。
 */
function buildSections(data, owner, kind) {
  const out = [];
  const main = data && (data.main || data.introMain);
  if (main) {
    out.push({
      id: docIdOf(main),
      kind: 'main',
      label: '主篇',
      sub: main.rel || main.path || '',
      tag: '',
      note: '',
      docId: docIdOf(main),
      removable: kind === 'repo' && !!(owner && owner.doc),
      removeTip: '摘除主篇自定义绑定（回退约定路径，文档不删）',
      taggable: false,
    });
  }
  for (const l of (data && (data.extras || data.introExtras)) || []) {
    const id = docIdOf(l);
    if (!id) continue;
    out.push({
      id,
      kind: 'extra',
      label: baseLabel(l),
      sub: l.rel || l.path || '',
      tag: '',
      note: '',
      docId: id,
      removable: false,
      taggable: String(id).startsWith('rel:'),
    });
  }
  // 登记的 reference：repo 与 board 的响应字段名不同（links / docLinks）
  const registered = (data && (data.links || data.docLinks)) || [];
  registered.forEach((l, i) => {
    const id = docIdOf(l);
    if (!id) return;
    out.push({
      id,
      kind: 'link',
      label: baseLabel(l),
      sub: l.rel || l.path || '',
      tag: l.tag || '',
      note: l.note || '',
      docId: id,
      // repo：1=主篇绑定，≥2=docLinks[n-2]；board：docLinks 1-based
      removeIndex: kind === 'repo' ? i + 2 : i + 1,
      removable: true,
      taggable: true,
    });
  });
  // 组内描述（仅项目）：仓库 × 分组这一层，全部所属组逐条列出
  for (const b of (kind === 'repo' && owner && owner.boards) || []) {
    const abs = b.noteDocPath || '';
    const rel = b.noteDocRel || '';
    const id = abs ? 'path:' + abs : rel ? 'rel:' + rel : '';
    if (!id) continue;
    out.push({
      id,
      kind: 'scoped',
      label: `${b.name} · 组内描述`,
      sub: abs || rel,
      tag: '',
      note: b.note || '',
      docId: id,
      removable: false,
      taggable: false,
    });
  }
  return out.filter((x) => x.docId);
}

const KIND_MARK = { main: '● ', scoped: '◇ ', extra: '○ ', link: '○ ' };

/**
 * @param {object} props
 * @param {'repo'|'board'} props.kind
 * @param {object} props.owner  仓库 / 看板对象（repoData 行，含 doc / boards / key|id）
 * @param {object} [props.model] FlexLayout model（页签 / 右侧栏用）
 * @param {() => void} [props.onChanged] 增删改后通知父层刷新
 * @param {() => void} props.onClose
 */
export default function DocsModal({ kind, owner, model, onClose, onChanged }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  // model 兜底取全局：仓库页/项目组页调用时并没有把 FlexLayout model 往下传，
  // 少这一层兜底 → 「更多 → 文字列表」只会弹「工作区不可用」，侧栏永远打不开（探针实证）。
  const app = useApp() || {};
  const wsModel = model || app.model;
  const intro = useIntro({ kind, owner, model: wsModel });
  const ownerKey = intro.ownerKey;
  const ownerName = owner && owner.name;

  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(''); // 空 = 列表视图
  const [doc, setDoc] = useState(null);
  const [missing, setMissing] = useState(null); // { rel } 约定路径上还没有文件 → 可创建
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const apiRef = useRef(null);
  const histRef = useRef(new Map()); // 撤销栈（与 DocPanel 同一套 md-history）

  const active = items.find((x) => x.id === activeId) || null;

  // ─── 列表：实时拉取（repo / board 两个端点，结构化三段）─────────────────
  const reload = useCallback(async () => {
    if (!ownerKey) { setItems([]); return; }
    try {
      const d = kind === 'repo'
        ? await api('/api/repos/docs?id=' + encodeURIComponent(ownerKey))
        : await api('/api/boards/' + encodeURIComponent(String(ownerKey)));
      setItems(buildSections(d, owner, kind));
    } catch (e) {
      setItems([]);
      setErr(String(e.message || e));
    }
  }, [kind, ownerKey, owner]);

  // ─── 打开一篇 → 文档视图（读正文，外部/自有同一套）──────────────────────
  const openDoc = useCallback(async (it) => {
    if (!it) return;
    setErr('');
    setMissing(null);
    setLoading(true);
    setActiveId(it.id);
    try {
      const d = await api('/api/docs/item?ref=' + encodeURIComponent(it.docId));
      setDoc(d);
      setDirty(false);
    } catch {
      if (String(it.docId).startsWith('rel:')) {
        // 约定路径上还没有文件：给「创建」入口，不让「未写」成死链
        setDoc(null);
        setMissing({ rel: String(it.docId).slice(4), title: it.label });
      } else {
        setDoc(null);
        setErr('文档不存在（外部路径未落盘）');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // 选中项被摘掉/换列表后不在清单里 → 回列表视图
  useEffect(() => {
    if (activeId && items.length && !items.some((x) => x.id === activeId)) {
      setActiveId('');
      setDoc(null);
      setDirty(false);
    }
  }, [activeId, items]);

  // ─── 编辑（文档没有独立标题：标题 = 正文首个 # 行，同 DocPanel）──────────
  const writable = !!(doc && doc.writable);

  const onBody = (next, kindOf = 'op') => {
    if (!doc) return;
    pushHistory(histRef.current, activeId, { body: doc.body }, kindOf);
    setDirty(true);
    setDoc((d) => (d ? { ...d, body: next, title: titleFromMd(next, d.title) } : d));
  };

  const onTitle = (next, kindOf = 'typing') => {
    if (!doc) return;
    pushHistory(histRef.current, activeId, { body: doc.body }, kindOf);
    setDirty(true);
    setDoc((d) => {
      if (!d) return d;
      const body = /^#\s+/m.test(d.body)
        ? d.body.replace(/^#\s+.+$/m, `# ${next || '未命名文档'}`)
        : `# ${next || '未命名文档'}\n\n${d.body}`;
      return { ...d, body, title: next };
    });
  };

  const undo = () => {
    if (!doc) return;
    const snap = undoHistory(histRef.current, activeId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => ({ ...d, body: snap.body, title: titleFromMd(snap.body, d.title) }));
    setDirty(true);
  };

  const redo = () => {
    if (!doc) return;
    const snap = redoHistory(histRef.current, activeId, { body: doc.body });
    if (!snap) return;
    setDoc((d) => ({ ...d, body: snap.body, title: titleFromMd(snap.body, d.title) }));
    setDirty(true);
  };

  const save = useCallback(async () => {
    if (!doc || !doc.writable || busy) return true;
    setBusy(true);
    setErr('');
    try {
      const res = missing
        ? await api('/api/docs/item', { method: 'POST', body: { rel: missing.rel, body: doc.body } })
        : await api('/api/docs/item', { method: 'PATCH', body: { ref: activeId, body: doc.body } });
      setDoc((d) => (d ? { ...d, missing: false, writable: true, summary: res && res.summary } : d));
      setMissing(null);
      setDirty(false);
      clearHistory(histRef.current, activeId);
      toast(doc.external ? '已写回来源文件' : '已保存');
      onChanged && onChanged();
      return true;
    } catch (e) {
      setErr(String(e.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [doc, busy, activeId, missing, toast, onChanged]);

  const guard = (fn) => fn().catch((e) => toast(String(e.message || e)));

  /** 回到列表（有改动先落盘——同 DocPanel 的"关窗前落盘"口径） */
  const backToList = useCallback(async () => {
    if (dirty && doc && doc.writable) {
      const ok = await save();
      if (!ok) return;
    }
    setActiveId('');
    setDoc(null);
    setMissing(null);
    setErr('');
    clearHistory(histRef.current, activeId);
  }, [dirty, doc, save, activeId]);

  const requestClose = async () => {
    if (dirty && doc && doc.writable) await save();
    onClose();
  };

  const createMissing = () => guard(async () => {
    if (!missing) return;
    const body = `# ${missing.title || '未命名文档'}\n\n`;
    await api('/api/docs/item', { method: 'POST', body: { rel: missing.rel, body } });
    toast(`已创建：${missing.rel}`);
    setMissing(null);
    const d = await api('/api/docs/item?ref=' + encodeURIComponent('rel:' + missing.rel));
    setDoc(d);
    setDirty(false);
    onChanged && onChanged();
  });

  // ─── 管理：摘除 / 标签 / ＋补充（列表视图的行内小动作）─────────────────
  const removeItem = (it) => guard(async () => {
    const ok = await dialog({ message: `摘除「${it.label}」？${it.kind === 'main' ? '（只拆绑定，文档不删）' : '（文档不删，仅移出列表）'}`, danger: true });
    if (!ok) return;
    if (kind === 'repo') {
      await api('/api/repos/docs', { method: 'DELETE', body: { id: ownerKey, index: it.removeIndex } });
    } else {
      await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, remove: it.removeIndex } });
    }
    if (activeId === it.id) { setDoc(null); setDirty(false); }
    toast('已摘除');
    reload();
    onChanged && onChanged();
  });

  const editTag = (it) => (async () => {
    const res = await dialog({
      title: `标签 · ${it.label}`,
      input: true,
      placeholder: '标签（如 qa；留空 = 清掉）',
      value: it.tag || '',
      okText: '保存标签',
    });
    if (res === null) return;
    const tag = typeof res === 'string' ? res : (res && res.tag) || '';
    await intro.setLinkTag(it.docId, tag, it);
    toast(tag ? `标签已设为 [${tag}]` : '标签已清除');
    reload();
    onChanged && onChanged();
  })().catch((e) => toast(String(e.message || e)));

  // ＋补充：落一篇 reference 并登记——就地刷新列表（不跳文档页签，主区切走会卸载弹窗）
  const addDoc = () => (async () => {
    if (!ownerKey || !String(intro.docRef || '').startsWith('rel:')) {
      toast('当前简介无法补充（需要自有树路径）');
      return;
    }
    const res = await dialog({
      title: '补充介绍文档',
      input: true,
      tagInput: true,
      placeholder: '文档名（如 architecture / api-notes）',
      tagPlaceholder: '标签（可选，如 qa）',
    });
    if (res === null) return;
    const name = typeof res === 'string' ? res : (res && res.value) || '';
    const tag = typeof res === 'object' && res ? (res.tag || '') : '';
    const slug = slugName(String(name).trim() || 'note').replace(/\.md$/i, '');
    const dir = introDirFromRef(intro.docRef) || (kind === 'repo' ? `repo/${ownerKey}` : `board/${ownerName || ownerKey}`);
    const rel = `${dir}/reference/${slug}.md`;
    await api('/api/docs/item', { method: 'POST', body: { rel, body: `# ${String(name).trim() || slug}\n\n（待补）\n` } });
    try {
      if (kind === 'repo') {
        await api('/api/repos/docs', { method: 'POST', body: { id: ownerKey, rel, tag: tag || undefined } });
      } else {
        await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, doc: rel, tag: tag || undefined } });
      }
    } catch {
      /* 集里已有 / 旧数据：文件已创建即可——同 doc 重复添加 = 更新（tag 以本次为准） */
    }
    toast(`已补充：${rel}${tag ? ` [${tag}]` : ''}`);
    await reload();
    onChanged && onChanged();
  })().catch((e) => toast(String(e.message || e)));

  // 「文字列表」= refs 右侧边栏；弹窗是模态，先关它再开侧栏（否则被遮罩压住）
  const openRefsPanel = () => {
    const m = wsModel;
    if (!m) { toast('工作区不可用，无法打开右侧列表'); return; }
    openPanel(m, {
      component: 'refs',
      name: '文档列表',
      config: kind === 'repo'
        ? { repoKey: ownerKey }
        : { boardKey: ownerKey, boardName: ownerName || '' },
      location: 'right',
    });
    onClose();
  };

  const previewHtml = useMemo(() => (doc ? renderMarkdownHtml(doc.body, []) : ''), [doc]);
  const canAdd = !!String(intro.docRef || '').startsWith('rel:') && ownerKey;
  const total = items.length;

  const title = `文档列表 · ${ownerName || ''}${kind === 'board' ? '（项目组）' : ''}`;

  // ─── 列表视图：只列标题 ────────────────────────────────────────────────
  if (!activeId) {
    return (
      <Modal size="md" title={title} onClose={onClose}>
        <div className="nx-dl">
          <div className="nx-dl-head">
            <span className="nx-dl-count">{total ? `${total} 篇` : '还没有文档'}</span>
            <span className="grow" />
            {canAdd && (
              <button type="button" className="btn ghost sm" title="补充一篇介绍文档（reference）" onClick={addDoc}>
                ＋ 补充
              </button>
            )}
          </div>
          {err ? <div className="rpd-err">{err}</div> : null}
          {!err && total === 0 ? (
            <div className="rpd-none">还没有文档 —— 点「＋ 补充」写第一篇</div>
          ) : null}
          <div className="nx-dl-list">
            {items.map((it) => (
              <div key={it.id} className="nx-dl-row-wrap">
                <button
                  type="button"
                  className="nx-dl-row"
                  title={it.sub || it.label}
                  onClick={() => openDoc(it)}
                >
                  <span className="nx-dl-row-title">
                    {KIND_MARK[it.kind] || '○ '}
                    {it.label}
                  </span>
                  {it.tag ? <span className="rpd-badge">{it.tag}</span> : null}
                </button>
                <span className="nx-docs-modal-item-acts">
                  {it.taggable && (
                    <button type="button" className="nx-docs-modal-mini" title={it.tag ? `改标签（当前：${it.tag}）` : '加标签'} onClick={() => editTag(it)}>＃</button>
                  )}
                  {it.removable && (
                    <button type="button" className="nx-docs-modal-mini danger" title={it.removeTip || `摘除「${it.label}」（文档不删）`} onClick={() => removeItem(it)}>×</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
        {dialogNode}
      </Modal>
    );
  }

  // ─── 文档视图：布局与任务页同构（面包屑 / 标题·路径 / 更多 · 保存）────────
  return (
    <Modal size="wide" title={title} onClose={requestClose}>
      <div className="mdw docp nx-doc-modal" data-mode={writable ? mode : 'read'}>
        <div className="mdw-main">
          <DocHead
            crumb={(
              <button type="button" className="nx-doc-back" title="返回文章列表" onClick={() => guard(backToList)}>
                ← 列表
              </button>
            )}
            title={doc ? (doc.title || (active && active.label) || '文档') : (active && active.label) || '文档'}
            pathLabel={doc ? (doc.rel || doc.path || '') : (missing ? missing.rel : (active && active.sub) || '')}
            dirty={dirty}
            writable={writable}
            external={!!(doc && doc.external)}
            saving={busy}
            menuGroups={[
              groupOf('edit', '编辑', [
                mode && {
                  id: 'mode',
                  label: mode === 'edit' ? '返回实时预览' : '源码模式',
                  hint: mode === 'edit' ? '当前' : '',
                  run: () => setMode(mode === 'edit' ? 'split' : 'edit'),
                },
              ]),
              groupOf('doc', '文档', [
                active && active.removable && {
                  id: 'remove',
                  label: '从列表摘除',
                  hint: '文档不删',
                  run: () => removeItem(active),
                  danger: true,
                },
              ]),
              groupOf('view', '查看', [
                { id: 'list', label: '文字列表', hint: '右侧边栏', run: openRefsPanel },
              ]),
            ]}
            onSave={save}
          />

          {err ? <div className="rpd-err">{err}</div> : null}

          {missing ? (
            <div className="rpd-empty">
              这篇还没写过（{missing.rel}）
              <button type="button" className="btn small" style={{ marginLeft: 10 }} onClick={createMissing}>创建</button>
            </div>
          ) : loading ? (
            <div className="rpd-empty">载入中…</div>
          ) : doc ? (
            <>
              <div className="nx-doc-bar">
                {doc.summary ? <span className="docp-summary">摘要（回写 desc）：{doc.summary}</span> : null}
                <span className="grow" />
                {writable ? <ModeSeg mode={mode} onChange={setMode} /> : null}
              </div>
              <div className="mdw-main-body">
                <MdPanes
                  mode={writable ? mode : 'read'}
                  title={doc.title}
                  body={doc.body}
                  previewHtml={previewHtml}
                  onTitle={writable ? onTitle : null}
                  onBody={writable ? onBody : null}
                  attachments={[]}
                  docKey={activeId}
                  editorApiRef={apiRef}
                  onSave={writable ? save : null}
                  onUndo={writable ? undo : null}
                  onRedo={writable ? redo : null}
                />
              </div>
            </>
          ) : (
            <div className="rpd-empty">选择左侧的一篇文档开始编辑</div>
          )}
        </div>
      </div>
      {dialogNode}
    </Modal>
  );
}
