// 查看详情弹窗（项目 / 项目组统一）：左侧**完整文档列表**，右侧就地编辑（MdPanes）。
//
// 简介行的补充文档不再以 tag/chip 外显（任务「简介文档优化」）——全部收进这里：
// 主篇 / 补充篇（介绍目录同目录的兄弟 md）/ 登记的 reference / 组内描述（仅项目）。
// 编辑器复用 MdPanes（与文档页签、DescModal 同一套）：分栏编辑、保存写盘、外部只读。
//
// 数据面：repo → GET /api/repos/docs（main/extras/links 三段结构，摘除序号按 docLinks）；
// board → GET /api/boards/:id（introMain/introExtras/docLinks）。列表自带实时拉取——
// 不读父层快照，加/摘/改标签后重拉即可见（Introduction 旧实现的教训）。
// 动作复用 useIntro：setLinkTag（标签）、openDoc（↗ 页签）；＋补充自带实现
// （useIntro.addRef 末尾会跳文档页签，主区切走会把本弹窗卸载——见 addDoc 注）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { MdPanes, ModeSeg } from '../md/md-panes.jsx';
import { renderMarkdownHtml, slugName, titleFromMd } from '../../modules/md/md-parse.js';
import { Modal, useDialog } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { useIntro, introDirFromRef } from './use-intro.js';
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
      writable: !main.path,
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
      writable: !l.path,
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
      writable: !l.path,
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
      writable: !abs,
    });
  }
  return out.filter((x) => x.docId);
}

/**
 * @param {object} props
 * @param {'repo'|'board'} props.kind
 * @param {object} props.owner  仓库 / 看板对象（repoData 行，含 doc / boards / key|id）
 * @param {object} [props.model] FlexLayout model（↗ 页签用）
 * @param {() => void} [props.onChanged] 增删改标签后通知父层刷新
 * @param {() => void} props.onClose
 */
export default function DocsModal({ kind, owner, model, onClose, onChanged }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const intro = useIntro({ kind, owner, model });
  const ownerKey = intro.ownerKey;
  const ownerName = owner && owner.name;

  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [doc, setDoc] = useState(null);
  const [missing, setMissing] = useState(null); // { rel } 约定路径上还没有文件 → 可创建
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apiRef = useRef(null);

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

  // ─── 编辑器：读一条 → 就地改 → 写盘（DescModal 同一套守卫）─────────────
  const load = useCallback(async (it) => {
    if (!it) { setDoc(null); setMissing(null); return; }
    setErr('');
    setMissing(null);
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
        setErr('文档不存在且为外部引用，无法在此创建');
      }
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // 选中项被摘掉/换列表后不在清单里 → 清空选中与编辑器（自动选中在下一拍接管）
  useEffect(() => {
    if (activeId && items.length && !items.some((x) => x.id === activeId)) {
      setActiveId('');
      setDoc(null);
      setDirty(false);
    }
  }, [activeId, items]);

  // 首条自动选中：打开弹窗即显示主篇（列表为空/出错时不动）。
  // selectRef = 「点名选中」意图（＋补充的新篇走这里，先于首条兜底）。
  const selectRef = useRef('');
  useEffect(() => {
    if (activeId || !items.length) return;
    const want = selectRef.current && items.some((x) => x.id === selectRef.current)
      ? selectRef.current
      : items[0].id;
    selectRef.current = '';
    setActiveId(want);
    load(items.find((x) => x.id === want));
  }, [activeId, items, load]);

  const pick = async (it) => {
    if (it.id === activeId) return;
    if (dirty && doc && doc.writable) {
      const ok = await save();
      if (!ok) return;
    }
    setActiveId(it.id);
    load(it);
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

  const onBody = (next) => {
    setDirty(true);
    setDoc((d) => (d ? { ...d, body: next, title: titleFromMd(next, d.title) } : d));
  };
  const onTitle = (next) => {
    setDirty(true);
    setDoc((d) => {
      if (!d) return d;
      const body = /^#\s+/m.test(d.body)
        ? d.body.replace(/^#\s+.+$/m, `# ${next || '未命名文档'}`)
        : `# ${next || '未命名文档'}\n\n${d.body}`;
      return { ...d, body, title: next };
    });
  };

  const save = useCallback(async () => {
    if (!doc || !doc.writable || busy) return true;
    setBusy(true);
    setErr('');
    try {
      const res = missing
        ? await api('/api/docs/item', { method: 'POST', body: { rel: missing.rel, body: doc.body } })
        : await api('/api/docs/item', { method: 'PATCH', body: { ref: activeId, body: doc.body } });
      setDoc((d) => (d ? { ...d, missing: false, summary: res && res.summary } : d));
      setDirty(false);
      toast && toast('已保存');
      onChanged && onChanged();
      return true;
    } catch (e) {
      setErr(String(e.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [doc, busy, activeId, missing, toast, onChanged]);

  function guard(fn) {
    fn().catch((e) => toast(String(e.message || e)));
  }

  // 关窗前落盘：随手补一句之后按 Esc 才发现白写，比多存一次更烦人
  const requestClose = async () => {
    if (dirty && doc && doc.writable) await save();
    onClose();
  };

  // ─── 管理：摘除 / 标签 / ＋补充 ────────────────────────────────────────
  const removeItem = (it) => guard(async () => {
    const ok = await dialog({ message: `摘除「${it.label}」？${it.kind === 'main' ? '（只拆绑定，文档不删）' : '（文档不删，仅移出列表）'}`, danger: true });
    if (!ok) return;
    if (kind === 'repo') {
      await api('/api/repos/docs', { method: 'DELETE', body: { id: ownerKey, index: it.removeIndex } });
    } else {
      await api('/api/docs/link', { method: 'POST', body: { board: ownerKey, remove: it.removeIndex } });
    }
    if (activeId === it.id) { setDoc(null); setDirty(false); } // 选中态由 prune 效应清（摘的是当前这篇时）
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

  // ＋补充：落一篇 reference 并登记——**不跳文档页签**（useIntro.addRef 末尾会
  // openByDocId，主区切走会把本弹窗整个卸载）。就地刷新列表并选中新篇编辑。
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
    selectRef.current = 'rel:' + rel; // 列表刷新后由自动选中效应点名新篇（单通道加载，无竞态）
    await reload();
    onChanged && onChanged();
  })().catch((e) => toast(String(e.message || e)));

  const writable = !!(doc && doc.writable);
  const previewHtml = useMemo(() => (doc ? renderMarkdownHtml(doc.body, []) : ''), [doc]);
  const canAdd = !!docRefStartsRel(intro.docRef) && ownerKey;

  return (
    <Modal
      size="wide"
      title={`文档列表 · ${ownerName || ''}${kind === 'board' ? '（项目组）' : ''}`}
      onClose={requestClose}
    >
      <div className="rpd nx-docs-modal">
        <div className="rpd-list">
          <div className="nx-docs-modal-acts">
            {canAdd && (
              <button type="button" className="btn small" title="补充一篇介绍文档（reference）" onClick={addDoc}>
                ＋ 补充
              </button>
            )}
          </div>
          {items.length === 0 && !err ? <div className="rpd-none">还没有文档 —— 点「＋ 补充」写第一篇</div> : null}
          {items.map((it) => (
            <div key={it.id} className="nx-docs-modal-item-wrap">
              <button
                type="button"
                className={'rpd-item' + (it.id === activeId ? ' on' : '')}
                onClick={() => pick(it)}
                title={it.sub || it.label}
              >
                <span className="rpd-item-top">
                  <span className="rpd-item-label">
                    {it.kind === 'main' ? '● ' : it.kind === 'scoped' ? '◇ ' : '○ '}
                    {it.label}
                  </span>
                  {it.kind === 'main' ? <span className="rpd-badge">主篇</span> : null}
                  {it.kind === 'scoped' ? <span className="rpd-badge">组内</span> : null}
                  {it.tag ? <span className="rpd-badge">{it.tag}</span> : null}
                </span>
                {it.note ? <span className="rpd-item-note">{it.note}</span> : null}
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

        <div className="rpd-main">
          <div className="rpd-bar">
            <span className="rpd-path mono" title={doc ? doc.rel || doc.path : (active ? active.sub : '')}>
              {doc ? doc.rel || doc.path : (active ? active.sub : (missing ? missing.rel : ''))}
            </span>
            {dirty ? <span className="rpd-dirty">未保存</span> : null}
            {doc && !writable ? <span className="rpd-badge">外部 · 只读</span> : null}
            <span className="grow" />
            {writable ? (
              <>
                <ModeSeg mode={mode} onChange={setMode} />
                <button type="button" className="btn small" disabled={busy || !dirty} onClick={save}>
                  {busy ? '保存中…' : '保存'}
                </button>
              </>
            ) : null}
            {active && (
              <button
                type="button"
                className="btn small ghost"
                title="在文档页签里打开（读全文 / 点双链跳转）"
                onClick={() => { intro.openDoc(active.docId); onClose(); }}
              >
                ↗ 页签
              </button>
            )}
          </div>

          {err ? <div className="rpd-err">{err}</div> : null}

          {missing ? (
            <div className="rpd-empty">
              这篇还没写过（{missing.rel}）
              <button type="button" className="btn small" style={{ marginLeft: 10 }} onClick={createMissing}>创建</button>
            </div>
          ) : doc ? (
            <div className="rpd-body">
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
              />
            </div>
          ) : (
            <div className="rpd-empty">{err ? '' : '选择左侧的一篇文档开始编辑'}</div>
          )}
        </div>
      </div>
      {dialogNode}
    </Modal>
  );
}

function docRefStartsRel(docRef) {
  return String(docRef || '').startsWith('rel:');
}
