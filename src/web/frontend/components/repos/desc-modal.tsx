// 描述弹窗：左边是这个仓库在**当前看板上下文**里的描述清单，右边就地编辑 md。
//
// 为什么不直接跳文档页签：描述是扫表时的旁注，为了改两个字把整页换掉、
// 连看板筛选和滚动位置一起丢掉，代价太大。这里就地改、就地存，关掉还停在原表。
//
// 「描述列表」里是这一个仓库的全部描述文档：
//   组内描述（group/<组>/<key>.md，只在看板筛选下出现）→ 项目主篇 → 补充篇。
// 条目数量本来就少（一两篇到七八篇），所以不做搜索与折叠。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import { MdPanes, ModeSeg } from '../md/md-panes.jsx';
import type { EditorApi } from '../md/md-panes-helpers.js';
import { renderMarkdownHtml, titleFromMd } from '../../modules/md/md-parse.js';
import { Modal } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import type { BoardRecord, RepoBoardRef, RepoRecord } from '../../page/repos/repo-table.js';

/** 仓库行上的分组引用 + 组内描述文档的**绝对**路径（仓库页行形状只声明了相对路径）。 */
interface RepoBoardRefExt extends RepoBoardRef {
  noteDocPath?: string;
}

/** 左侧清单的一条：组内描述 / 项目主篇 / 补充篇。 */
interface DescEntry {
  id: string;
  kind: 'group' | 'main' | 'link';
  label: string;
  sub: string;
  note: string;
  exists?: boolean;
  writable: boolean;
}

/** /api/docs/item 的返回（外部数据边界：编辑器只读写这几个字段）。 */
interface DescDoc {
  title?: string;
  body: string;
  rel?: string;
  path?: string;
  writable?: boolean;
  missing?: boolean;
  summary?: string;
  [k: string]: any;
}

export interface DescModalProps {
  /** 仓库（列表行对象，含 descDocs / boards） */
  repo: RepoRecord;
  /** 当前筛中的看板（决定「组内描述」这一条是否存在） */
  board: BoardRecord | null;
  onClose: () => void;
  /** 保存成功后刷新列表（摘要回写到 desc / note） */
  onSaved?: () => void;
  /** 打开文档页签（读全文 / 走双链） */
  onOpenTab?: (docId: string) => void;
}

/**
 * 描述清单：组内描述 → 项目主篇 → 补充篇。
 * note 用作「已写/未写」与一行预览：它是保存文档时回写的派生摘要
 * （见 docs/seed.js writeBackSummary），比再读一遍文件便宜。
 */
function buildList(repo: RepoRecord, board: BoardRecord | null): DescEntry[] {
  const out: DescEntry[] = [];
  const docs = repo.descDocs || null;

  if (board) {
    // RepoBoardRefExt 只是给行形状补一个可选字段，原类型不需要转型即可赋值
    const mine: RepoBoardRefExt | undefined = (repo.boards || []).find((b) => b.id === board.id);
    const rel = (mine && mine.noteDocRel) || '';
    const abs = (mine && mine.noteDocPath) || '';
    const id = abs ? 'path:' + abs : rel ? 'rel:' + rel : '';
    if (id) {
      out.push({
        id,
        kind: 'group',
        label: '组内描述',
        sub: `「${board.name}」里 ${repo.name} 的角色`,
        note: (mine && mine.note) || '',
        writable: !abs,
      });
    }
  }

  const main = docs && docs.main;
  if (main && main.docId) {
    out.push({
      id: main.docId,
      kind: 'main',
      label: main.title || '项目主篇',
      sub: main.rel || main.path || '',
      note: main.summary || '',
      exists: !!main.exists,
      writable: !main.path,
    });
  }

  for (const l of (docs && docs.links) || []) {
    if (!l.docId) continue;
    out.push({
      id: l.docId,
      kind: 'link',
      label: l.title || l.docId,
      sub: l.tag ? '#' + l.tag : '',
      note: l.note || '',
      writable: String(l.docId).startsWith('rel:'),
    });
  }
  return out;
}

/**
 * @param {object} props
 * @param {object} props.repo    仓库（列表行对象，含 descDocs / boards）
 * @param {object|null} props.board  当前筛中的看板（决定「组内描述」这一条是否存在）
 * @param {() => void} props.onClose
 * @param {() => void} [props.onSaved]  保存成功后刷新列表（摘要回写到 desc / note）
 * @param {(docId: string) => void} [props.onOpenTab]  打开文档页签（读全文 / 走双链）
 */
export default function DescModal({ repo, board, onClose, onSaved, onOpenTab }: DescModalProps) {
  const toast = useToast();
  const list = useMemo(() => buildList(repo, board), [repo, board]);
  const [activeId, setActiveId] = useState<string>(() => (list[0] ? list[0].id : ''));
  const [doc, setDoc] = useState<DescDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState('split');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apiRef = useRef<EditorApi | null>(null);

  const active = list.find((x) => x.id === activeId) || null;

  const load = useCallback(async (id: string) => {
    if (!id) { setDoc(null); return; }
    setErr('');
    try {
      const d = await api('/api/docs/item?ref=' + encodeURIComponent(id));
      setDoc(d);
      setDirty(false);
    } catch (e) {
      setErr(String((e as Error).message || e));
      setDoc(null);
    }
  }, []);

  useEffect(() => { load(activeId); }, [activeId, load]);

  const onBody = (next: string) => {
    setDirty(true);
    setDoc((d) => (d ? { ...d, body: next, title: titleFromMd(next, d.title) } : d));
  };

  const onTitle = (next: string) => {
    setDirty(true);
    setDoc((d) => {
      if (!d) return d;
      const body = /^#\s+/m.test(d.body)
        ? d.body.replace(/^#\s+.+$/m, `# ${next || '未命名文档'}`)
        : `# ${next || '未命名文档'}\n\n${d.body}`;
      return { ...d, body, title: next };
    });
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!doc || !doc.writable || busy) return true;
    setBusy(true);
    setErr('');
    try {
      // missing = 约定路径上还没有文件：POST 建，PATCH 写。两种都走同一个路由表。
      const res = doc.missing
        ? await api('/api/docs/item', { method: 'POST', body: { rel: doc.rel, body: doc.body } })
        : await api('/api/docs/item', { method: 'PATCH', body: { ref: activeId, body: doc.body } });
      setDoc((d) => (d ? { ...d, missing: false, summary: res && res.summary } : d));
      setDirty(false);
      if (toast) toast('描述已保存');
      if (onSaved) onSaved();
      return true;
    } catch (e) {
      setErr(String((e as Error).message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [doc, busy, activeId, toast, onSaved]);

  // 换条目时先把改动落盘：描述是随手补两句的东西，切走就丢比多存一次更烦人。
  // 存失败就不切——错误留在原地，人看得见。
  const pick = async (id: string) => {
    if (id === activeId) return;
    if (dirty && doc && doc.writable) {
      const ok = await save();
      if (!ok) return;
    }
    setActiveId(id);
  };

  const writable = !!(doc && doc.writable);
  const previewHtml = useMemo(
    () => (doc ? renderMarkdownHtml(doc.body, []) : ''),
    [doc]
  );

  // 关窗（× / Esc / 点遮罩）前把改动落盘：没人想在「随手补一句」之后
  // 因为按了 Esc 才发现白写。
  const requestClose = async () => {
    if (dirty && doc && doc.writable) await save();
    onClose();
  };

  return (
    <Modal
      size="wide"
      title={`描述 · ${repo.name}${board ? ` @「${board.name}」` : ''}`}
      onClose={requestClose}
    >
      <div className="rpd">
        <div className="rpd-list">
          {list.length === 0 ? <div className="rpd-none">这个仓库还没有描述文档</div> : null}
          {list.map((it) => {
            const written = it.kind === 'link' ? true : !!(it.note || it.exists);
            return (
              <button
                key={it.id}
                type="button"
                className={'rpd-item' + (it.id === activeId ? ' on' : '')}
                onClick={() => pick(it.id)}
                title={it.sub || it.label}
              >
                <span className="rpd-item-top">
                  <span className="rpd-item-label">{it.label}</span>
                  {it.kind === 'group' ? <span className="rpd-badge">组内</span> : null}
                  {it.kind === 'link' && it.sub ? <span className="rpd-badge">{it.sub}</span> : null}
                  {written ? null : <span className="rpd-todo">未写</span>}
                </span>
                {it.note ? <span className="rpd-item-note">{it.note}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="rpd-main">
          <div className="rpd-bar">
            <span className="rpd-path mono" title={doc ? doc.rel || doc.path : ''}>
              {doc ? doc.rel || doc.path : (active ? active.sub : '')}
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
            {onOpenTab && doc ? (
              <button
                type="button"
                className="btn small ghost"
                title="在文档页签里打开（读全文 / 点双链跳转）"
                onClick={() => { onOpenTab(activeId); onClose(); }}
              >
                ↗ 页签
              </button>
            ) : null}
          </div>

          {err ? <div className="rpd-err">{err}</div> : null}

          {doc ? (
            <div className="rpd-body">
              <MdPanes
                mode={writable ? mode : 'read'}
                title={doc.title}
                body={doc.body}
                previewHtml={previewHtml}
                onTitle={writable ? onTitle : undefined}
                onBody={writable ? onBody : undefined}
                attachments={[]}
                docKey={activeId}
                editorApiRef={apiRef}
                onSave={writable ? save : null}
              />
            </div>
          ) : (
            <div className="rpd-empty">{err ? '' : '选择左侧的一篇描述开始编辑'}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
