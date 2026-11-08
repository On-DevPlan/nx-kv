// 附件区（任务页 / 文档页共用）：关系表 task_attach / ref_attach 的呈现与操作。
//
// 与正文的关系：正文只呈现 `role=inline` 那一部分；这里按 area 分区显示
// 「正文内嵌 / 附件区」，不会遗漏只挂在附件区的资源（--no-embed 挂的）。
//
// 交互：拖文件进来直接登记（role=attach）；「添加附件」打开共享弹窗；
// 图片缩略图点开大图；pdf/其它给打开/下载；task 点击跳任务；ref 点击开文档；
// 移除时二选一：只解除关联 / 连资源与字节一起删。
import { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Modal } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { uploadOne, droppedFiles } from '../cloud/upload.js';
import AttachModal from './attach-modal.jsx';
import {
  AREA_LABEL,
  badgeOf,
  contentUrl,
  endpointOf,
  normAttachment,
} from './attach-common.js';

const SORTERS = {
  position: (a, b) => (a.position || 0) - (b.position || 0) || String(a.id).localeCompare(String(b.id)),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  kind: (a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name || '').localeCompare(String(b.name || '')),
};

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
}) {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [sortBy, setSortBy] = useState('position');
  const [removeOf, setRemoveOf] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [preview, setPreview] = useState(null);

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
      setError(String((e && e.message) || e));
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
    const onKey = (e) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const sorted = useMemo(() => [...list].sort(SORTERS[sortBy] || SORTERS.position), [list, sortBy]);
  const inline = sorted.filter((a) => a.area === 'inline');
  const area = sorted.filter((a) => a.area === 'area');

  const dropFiles = async (files, e) => {
    if (disabled) return;
    const fs = droppedFiles(e);
    const picked = fs.length ? fs : [...(files || [])].filter((f) => f && f.size > 0);
    if (!picked.length) return;
    setDropping(true);
    let ok = 0;
    for (const f of picked) {
      try {
        // 拖进附件区 = 明确要挂到附件区：上传后走 no-embed（不写正文）
        const r = await uploadOne(f, { local: true });
        const fileId = r.fileId || r.id;
        if (!fileId) throw new Error('上传未返回 fileId');
        await ep.attach({ fileId, name: r.name });
        ok += 1;
      } catch (err) {
        toast(`「${f.name || '文件'}」添加失败：${(err && err.message) || err}`);
      }
    }
    setDropping(false);
    if (ok) {
      toast(`已挂到附件区 ${ok} 个文件`);
      await load();
      onChanged?.();
    }
  };

  const doRemove = async (purge) => {
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
      toast(`移除失败：${(e && e.message) || e}`);
    } finally {
      setRemoving(false);
    }
  };

  const emptyAll = !loading && !error && !list.length;

  return (
    <div className={`att-area${disabled ? ' is-disabled' : ''}`}>
      <div
        className={'att-area-head' + (dragOver && !disabled ? ' is-over' : '')}
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) dropFiles(null, e);
        }}
      >
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
              onChange={(e) => setSortBy(e.target.value)}
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
          {inline.map((a) => renderItem(a, { onRemove: setRemoveOf, onPreview: setPreview, onOpenTask, onOpenDoc, key: a.id }))}
        </div>
      ) : null}

      {area.length ? (
        <div className="att-section">
          <div className="att-section-head">{AREA_LABEL.area}<span className="att-section-hint">不依赖正文，删正文行也不会丢</span></div>
          {area.map((a) => renderItem(a, { onRemove: setRemoveOf, onPreview: setPreview, onOpenTask, onOpenDoc, key: a.id }))}
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
        onClose={() => setModalOpen(false)}
        onDone={async () => { await load(); onChanged?.(); }}
      />

      {removeOf ? (
        <Modal
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
        </Modal>
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

function renderItem(a, { onRemove, onPreview, onOpenTask, onOpenDoc }) {
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
            title={a.locator || a.targetRef || '打开文档'}
            onClick={() => onOpenDoc?.(a.locator || a.targetRef)}
          >
            {a.name}
          </button>
        ) : a.kind === 'url' ? (
          <a className="att-link" href={a.url} target="_blank" rel="noreferrer" title={a.url}>{a.name}</a>
        ) : (
          <span className="att-item-name" title={a.name}>{a.name}</span>
        )}
        <span className="att-item-meta">
          {a.sizeText ? <span>{a.sizeText}</span> : null}
          {a.note ? <span className="att-note">{a.note}</span> : null}
        </span>
      </span>

      {a.kind === 'file' || a.kind === 'image' ? (
        <span className="att-item-acts">
          <a className="att-act" href={contentUrl(a.id)} target="_blank" rel="noreferrer">打开</a>
          <a className="att-act" href={contentUrl(a.id)} download={a.name}>下载</a>
        </span>
      ) : null}

      <button type="button" className="att-x" aria-label={`移除 ${a.name}`} onClick={() => onRemove(a)}>×</button>
    </div>
  );
}
