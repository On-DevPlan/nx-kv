// 附件区（任务页 / 文档页共用）：关系表 task_attach / ref_attach 的呈现与操作。
//
// 与正文的关系：正文只呈现 `role=inline` 那一部分；这里按 area 分区显示
// 「正文内嵌 / 附件区」，不会遗漏只挂在附件区的资源（--no-embed 挂的）。
//
// 交互：拖文件进来直接登记（role=attach）；「添加附件」打开共享弹窗；
// 图片缩略图点开大图；pdf/其它给打开/下载；task 点击跳任务；ref 点击开文档；
// 移除时二选一：只解除关联 / 连资源与字节一起删。
import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { ComponentType, DragEvent, ReactNode, Ref } from 'react';
import { Modal, useDialog } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { api } from '../../api/client.js';
import { uploadOne, droppedFiles } from '../attach/upload.js';
import AttachModal from './attach-modal.jsx';
import {
  AREA_LABEL,
  badgeOf,
  contentUrl,
  endpointOf,
  normAttachment,
} from './attach-common.js';
import { renderMarkdownHtml } from '../../modules/md/md-render.js';
import type {
  AttachAllow,
  AttachHostKind,
  Attachment,
  DocOption,
  NormalizedAttachment,
  TaskOption,
} from './attach-common.js';

type SortBy = 'position' | 'name' | 'kind';

// popup 的 Modal 仍是 JS 模块：JSDoc 从默认值 null 推出的 footer 只能是 null，
// 真实契约是 ReactNode——这里重新标注一次（本文件唯一断言点）。
const ModalBox = Modal as unknown as ComponentType<{
  title?: ReactNode;
  onClose?: () => void;
  busy?: boolean;
  size?: string;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}>;

const SORTERS: Record<SortBy, (a: NormalizedAttachment, b: NormalizedAttachment) => number> = {
  position: (a, b) => (a.position || 0) - (b.position || 0) || String(a.id).localeCompare(String(b.id)),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  kind: (a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name || '').localeCompare(String(b.name || '')),
};

/** 附件区的对外句柄（任务页的「添加附件」按钮经 ref 唤起）。 */
export interface AttachAreaHandle {
  open: () => void;
  refresh: () => void;
}

/** 一条条目的动作集合（renderItem 的入参）。 */
interface ItemActions {
  onRemove: (a: NormalizedAttachment) => void;
  onPreview: (p: { src: string; name?: string }) => void;
  /** mdfile：读磁盘正文并按 md 渲染（不看 MIME / 扩展名） */
  onPreviewMd?: (a: NormalizedAttachment) => void;
  key?: Attachment['id'];
  onOpenTask?: (hit: { key?: string; seq?: number | null }) => void;
  onOpenDoc?: (locator: string) => void;
  onEditNote?: (a: NormalizedAttachment) => void;
  onReplace?: (a: NormalizedAttachment) => void;
}

interface AttachAreaProps {
  host?: AttachHostKind;
  hostId?: string | number;
  hostKey?: string;
  hostCwd?: string;
  refId?: string;
  allow?: AttachAllow;
  taskOptions?: TaskOption[];
  docOptions?: DocOption[] | null;
  disabled?: boolean;
  disabledText?: string;
  openRef?: Ref<AttachAreaHandle>;
  /** React 19 的 ref-as-prop：页面按 `<AttachArea ref={...}>` 传句柄。
   *  历史上本组件只认 openRef，这里保持同一行为（不接管 ref），仅让调用点类型对得上。 */
  ref?: Ref<AttachAreaHandle>;
  onChanged?: () => void;
  onOpenTask?: (hit: { key?: string; seq?: number | null }) => void;
  onOpenDoc?: (locator: string) => void;
}

function renderItem(a: NormalizedAttachment, { onRemove, onPreview, onPreviewMd, onOpenTask, onOpenDoc, onEditNote, onReplace }: ItemActions) {
  const src = a.kind === 'image' ? contentUrl(a.id) : '';
  return (
    <div className={`att-item att-kind-${a.kind}`} key={a.id}>
      {a.kind === 'image' ? (
        <button type="button" className="att-thumb" onClick={() => onPreview({ src, name: a.name })} title="点击看大图">
          <img src={src} alt={a.name} loading="lazy" />
        </button>
      ) : (
        <span className="att-kind-badge">{badgeOf(a.kind)}</span>
      )}

      <span className="att-item-main">
        {a.kind === 'task' ? (
          <button
            type="button"
            className="att-link"
            title={`跳转到任务 #${a.targetSeq ?? ''}`}
            onClick={() => onOpenTask?.({ key: a.targetKey, seq: a.targetSeq })}
          >
            {a.name}
          </button>
        ) : a.kind === 'ref' ? (
          <button
            type="button"
            className="att-link"
            title={a.note || a.title || a.name || '打开文档'}
            onClick={() => onOpenDoc?.(a.refId ? 'ref:' + a.refId : (a.locator || a.targetRef))}
          >
            {a.title || a.name}
          </button>
        ) : a.kind === 'url' ? (
          <a className="att-link" href={a.url} target="_blank" rel="noreferrer" title={a.url}>{a.name}</a>
        ) : (
          <span className="att-item-name" title={a.name}>{a.name}</span>
        )}
        <span className="att-item-meta">
          {a.sizeText ? <span>{a.sizeText}</span> : null}
          {a.kind === 'mdfile' ? (
            <span className="att-note" title={a.absPath || ''}>
              {a.absPath || '（路径为空）'}{a.missing ? ' · 源文件已不在' : ''}
            </span>
          ) : null}
          {a.note ? <span className="att-note">{a.note}</span> : null}
        </span>
      </span>

      {a.kind === 'mdfile' ? (
        <span className="att-item-acts">
          <button type="button" className="att-act" title="按 md 渲染磁盘当前内容（读时核对指纹）" onClick={() => onPreviewMd?.(a)}>预览</button>
        </span>
      ) : null}

      {a.kind === 'file' || a.kind === 'image' ? (
        <span className="att-item-acts">
          <a className="att-act" href={contentUrl(a.id)} target="_blank" rel="noreferrer">打开</a>
          <a className="att-act" href={contentUrl(a.id)} download={a.name}>下载</a>
        </span>
      ) : null}

      {a.kind === 'ref' ? (
        <span className="att-item-acts">
          <button type="button" className="att-act" title="改这条绑定的一行说明（交付清单会透出）" onClick={() => onEditNote?.(a)}>✎ 说明</button>
          <button type="button" className="att-act" title="换成另一篇文档（替换这条绑定）" onClick={() => onReplace?.(a)}>⇄ 更换</button>
        </span>
      ) : null}

      <button type="button" className="att-x" aria-label={`移除 ${a.name}`} onClick={() => onRemove(a)}>×</button>
    </div>
  );
}

export default function AttachArea({
  host = 'task',
  hostId,
  hostKey,
  hostCwd,
  refId,
  allow = { file: true, url: true, task: false, ref: false },
  taskOptions = [],
  docOptions,
  disabled = false,
  disabledText = '提交任务后可以在这里挂附件（当前是草稿）。',
  openRef,
  onChanged,
  onOpenTask,
  onOpenDoc,
}: AttachAreaProps) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [list, setList] = useState<NormalizedAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('position');
  const [removeOf, setRemoveOf] = useState<NormalizedAttachment | null>(null);
  // #168：ref 条目的两个动作——改说明（✎）/ 换指向（⇄，替换成另一篇文档）
  const [replaceOf, setReplaceOf] = useState<NormalizedAttachment | null>(null);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState<{ src: string; name?: string } | null>(null);
  const [mdPreview, setMdPreview] = useState<{ name: string; html: string; path: string; stale: boolean; missing: boolean } | null>(null);

  const ep = useMemo(
    () => endpointOf(host, { hostId, hostKey, hostCwd, refId }),
    [host, hostId, hostKey, hostCwd, refId]
  );

  const load = useCallback(async () => {
    if (disabled) {
      setList([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const r = await ep.list();
      setList((r.attachments || []).map(normAttachment));
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, [ep, disabled]);

  useEffect(() => { load(); }, [load]);

  useImperativeHandle(openRef, () => ({
    open: () => setModalOpen(true),
    refresh: load,
  }), [load]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const sorted = useMemo(() => [...list].sort(SORTERS[sortBy] || SORTERS.position), [list, sortBy]);
  const inline = sorted.filter((a) => a.area === 'inline');
  const area = sorted.filter((a) => a.area === 'area');

  const dropFiles = async (files: FileList | File[] | null, e: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    // attach/upload 仍是 JS 模块：droppedFiles 的返回被推成 unknown[]，约定就是 File[]
    const fs = droppedFiles(e) as File[];
    const picked = fs.length ? fs : [...(files || [])].filter((f) => f && f.size > 0);
    if (!picked.length) return;
    setDropping(true);
    let ok = 0;
    for (const f of picked) {
      try {
        // 拖进附件区 = 明确要挂到附件区：上传后走 no-embed（不写正文）
        const r = await uploadOne(f);
        const fileId = r.fileId || r.id;
        if (!fileId) throw new Error('上传未返回 fileId');
        await ep.attach({ fileId, name: r.name });
        ok += 1;
      } catch (err) {
        toast(`「${f.name || '文件'}」添加失败：${(err as Error).message || err}`);
      }
    }
    setDropping(false);
    if (ok) {
      toast(`已挂到附件区 ${ok} 个文件`);
      await load();
      onChanged?.();
    }
  };

  // #168：改一条绑定的说明（desc）——面板直改，不必重挂
  const editNote = async (item: NormalizedAttachment | null) => {
    if (!item) return;
    try {
      // useDialog 仍是 JS 模块：dialog 返回 Promise<unknown>，约定是 string（单输入）或 { value, note }
      const res = await dialog({
        title: `说明 · ${item.name}`,
        input: true,
        placeholder: '这一行里大概是什么（交付清单会透出给 agent）',
        value: item.note || '',
        okText: '保存说明',
      }) as string | { value?: string; note?: string } | null;
      if (res === null) return;
      const note = typeof res === 'string' ? res : (res && (res.value || res.note)) || '';
      const path = host === 'doc'
        ? `/api/docs/attach-note?ref=${encodeURIComponent(String(refId || ''))}`
        : '/api/localtasks/attach-note';
      const body = host === 'doc'
        ? { attachment: item.id, note }
        : { id: Number(hostId), ...(hostKey ? { key: hostKey } : hostCwd ? { cwd: hostCwd } : {}), attachment: item.id, note };
      await api(path, { method: 'PATCH', body });
      toast(note ? `已保存说明：${note}` : '已清空说明');
      await load();
      onChanged?.();
    } catch (e) {
      toast(`改说明失败：${(e as Error).message || e}`);
    }
  };

  // #168：换指向——重新打开「添加附件」弹窗（只选文档），提交后把旧绑定换掉
  const startReplace = (item: NormalizedAttachment | null) => {
    if (!item) return;
    setReplaceOf(item);
    setModalOpen(true);
  };

  const doRemove = async (purge: boolean) => {
    const item = removeOf;
    if (!item) return;
    setRemoving(true);
    try {
      await ep.detach(item.id, !!purge);
      setRemoveOf(null);
      toast(purge ? `已移除并删除资源：${item.name}` : `已解除关联：${item.name}`);
      await load();
      onChanged?.();
    } catch (e) {
      toast(`移除失败：${(e as Error).message || e}`);
    } finally {
      setRemoving(false);
    }
  };

  // mdfile：按 kind 分支直接走 md 渲染（不看 MIME / 扩展名）。
  const openMd = async (item: NormalizedAttachment | null) => {
    if (!item) return;
    try {
      const r = await api<{ body?: string; absPath?: string; stale?: boolean; missing?: boolean }>(
        `/api/docs/mdfile?attachment=${encodeURIComponent(String(item.id))}`
      );
      const body = String(r.body || '');
      setMdPreview({
        name: item.name || 'md',
        html: renderMarkdownHtml(body),
        path: String(r.absPath || item.absPath || ''),
        stale: !!r.stale,
        missing: !!r.missing,
      });
    } catch (e) {
      toast(`读取失败：${(e as Error).message || e}`);
    }
  };

  const emptyAll = !loading && !error && !list.length;

  return (
    <div
      className={`att-area${disabled ? ' is-disabled' : ''}`}
      // 拖放落点是**整个附件区**：空态提示写着「拖文件到这里」，落点只盖头部
      // 一条的话提示区反而是空的（md/pdf 等文件拖上去落空，触发浏览器默认打开文件）。
      onDragOver={(e) => {
        if (disabled || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // DOM 事件边界：relatedTarget 声明为 EventTarget，contains 需要 Node
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        if (disabled || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        dropFiles(null, e);
      }}
    >
      {/* 「改说明」用的输入弹窗挂在这里（#168） */}
      {dialogNode}
      <div className={'att-area-head' + (dragOver && !disabled ? ' is-over' : '')}>
        <span className="att-area-title">
          附件
          {list.length ? <span className="att-count">{list.length}</span> : null}
          {dropping ? <span className="att-area-note">上传中…</span> : null}
        </span>
        <span className="att-area-acts">
          {list.length ? (
            <select
              className="att-sort"
              value={sortBy}
              // DOM 边界：<option> 的 value 就是 SortBy 之一
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              aria-label="附件排序"
            >
              <option value="position">按添加顺序</option>
              <option value="name">按名称</option>
              <option value="kind">按类型</option>
            </select>
          ) : null}
          <button type="button" className="btn ghost att-add-btn" disabled={disabled} onClick={() => setModalOpen(true)}>
            添加附件
          </button>
        </span>
      </div>

      {disabled ? <div className="att-empty">{disabledText}</div> : null}
      {loading ? <div className="att-empty">加载附件…</div> : null}
      {error ? <div className="att-empty att-err-text">附件加载失败：{error}</div> : null}
      {emptyAll ? (
        <div className="att-empty">还没有附件。拖文件到这里，或点「添加附件」——只挂附件区，不写正文。</div>
      ) : null}

      {inline.length ? (
        <div className="att-section">
          <div className="att-section-head">{AREA_LABEL.inline}<span className="att-section-hint">正文里的引用，删正文行会跟着消失</span></div>
          {inline.map((a) => renderItem(a, { onRemove: setRemoveOf, onPreview: setPreview, onPreviewMd: openMd, onOpenTask, onOpenDoc, onEditNote: editNote, onReplace: startReplace, key: a.id }))}
        </div>
      ) : null}

      {area.length ? (
        <div className="att-section">
          <div className="att-section-head">{AREA_LABEL.area}<span className="att-section-hint">不依赖正文，删正文行也不会丢</span></div>
          {area.map((a) => renderItem(a, { onRemove: setRemoveOf, onPreview: setPreview, onPreviewMd: openMd, onOpenTask, onOpenDoc, onEditNote: editNote, onReplace: startReplace, key: a.id }))}
        </div>
      ) : null}

      <AttachModal
        open={modalOpen}
        host={host}
        hostId={hostId}
        hostKey={hostKey}
        hostCwd={hostCwd}
        refId={refId}
        allow={allow}
        taskOptions={taskOptions}
        docOptions={docOptions}
        replaceAttachment={replaceOf ? replaceOf.id : null}
        replaceNote={replaceOf ? replaceOf.note || '' : ''}
        onClose={() => { setModalOpen(false); setReplaceOf(null); }}
        onDone={async () => { setReplaceOf(null); await load(); onChanged?.(); }}
      />

      {removeOf ? (
        <ModalBox
          title="移除附件"
          size="sm"
          busy={removing}
          onClose={removing ? undefined : () => setRemoveOf(null)}
          footer={
            <div className="att-foot">
              <button type="button" className="btn ghost" disabled={removing} onClick={() => setRemoveOf(null)}>取消</button>
              <button type="button" className="btn" disabled={removing} onClick={() => doRemove(false)}>只解除关联</button>
              <button type="button" className="btn danger" disabled={removing} onClick={() => doRemove(true)}>
                {removeOf.kind === 'file' ? '连文件一起删' : '连资源一起删'}
              </button>
            </div>
          }
        >
          <div className="att-confirm">
            <div className="att-confirm-name">{removeOf.name}</div>
            <div className="att-confirm-text">
              只解除关联：从这份{host === 'task' ? '任务' : '文档'}的附件清单里移除，资源仍留在孤儿池，可被重新挂载。
              连资源一起删：在本机没有其它任务/文档引用它时，删除资源行（本机文件同时删字节）；仍被引用时只解除关联。
            </div>
          </div>
        </ModalBox>
      ) : null}

      {mdPreview ? (
        <ModalBox
          title={<span>{mdPreview.name}<span className="att-md-path">{mdPreview.path}</span></span>}
          size="lg"
          onClose={() => setMdPreview(null)}
          footer={<button type="button" className="btn ghost" onClick={() => setMdPreview(null)}>关闭</button>}
        >
          {mdPreview.missing ? (
            <div className="att-empty">源文件已不在：{mdPreview.path || '（路径为空）'}</div>
          ) : (
            <div className="att-md-preview">
              {mdPreview.stale ? (
                <div className="att-md-warn">内容已变化（与登记指纹不一致），以下为磁盘当前内容。</div>
              ) : null}
              <article dangerouslySetInnerHTML={{ __html: mdPreview.html }} />
            </div>
          )}
        </ModalBox>
      ) : null}

      {preview ? (
        <div className="att-lightbox" role="dialog" aria-label="图片预览" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="att-lightbox-card">
            <div className="att-lightbox-head">
              <span className="att-lightbox-name">{preview.name}</span>
              <a className="att-lightbox-open" href={preview.src} target="_blank" rel="noreferrer">新窗口打开</a>
              <button type="button" className="pp-x" aria-label="关闭" onClick={() => setPreview(null)}>×</button>
            </div>
            <img className="att-lightbox-img" src={preview.src} alt={preview.name} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
