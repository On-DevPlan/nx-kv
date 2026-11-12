// 「添加附件」弹窗（任务/文档共用）。
//
// 交互口径（2026-11-08 附件区需求）：
//   · 点「添加附件」先开这个弹窗，不直接弹系统文件框；
//   · 拖拽（落点高亮）/ 点击多选 / 粘贴 都进**待确认清单**，确认后才提交；
//   · 支持添加 URL 与内部引用（任务侧选同主题任务、文档侧选 ref）；
//   · 逐项提交，失败只标红该项可重试，不整批失败；
//   · 提交走 `localtask attach --no-embed` / `docs attach --no-embed`，
//     前端不拼正文（关系表是附件清单的权威）。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClipboardEvent, ComponentType, ReactNode } from 'react';
import { Modal } from '../popup/index.jsx';
import { api } from '../../api/client.js';
import { clipboardFiles, droppedFiles, readableName, uploadOne } from '../attach/upload.js';
import StatusTag from '../status-tag/index.jsx';
import {
  attachBodyOf,
  badgeOf,
  endpointOf,
  fmtSize,
} from './attach-common.js';
import type {
  AttachAllow,
  AttachHostKind,
  DocOption,
  TaskOption,
} from './attach-common.js';

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

const SOURCE_LABEL: Record<PendingItem['source'], string> = {
  file: '本机文件', url: '外部链接', task: '任务引用', ref: '文档引用',
};

/** 待确认清单的一条（本地态，不是服务端形状）。 */
interface PendingItem {
  key: string;
  source: 'file' | 'url' | 'task' | 'ref';
  file?: File;
  fileId?: string;
  name: string;
  mime?: string;
  size?: number;
  url?: string;
  seq?: number;
  docRef?: string;
  note?: string;
  inline?: boolean;
  status: 'pending' | 'uploading' | 'error';
  error?: string;
}

interface AttachModalProps {
  open?: boolean;
  host?: AttachHostKind;
  hostId?: string | number;
  hostKey?: string;
  hostCwd?: string;
  refId?: string;
  allow?: AttachAllow;
  taskOptions?: TaskOption[];
  docOptions?: DocOption[] | null;
  // #168：替换模式——提交成功后把这条旧绑定换掉（换指向）
  replaceAttachment?: string | number | null;
  // #168：换指向时沿用旧绑定的说明（用户写的 desc 不该因为换篇文档就丢）
  replaceNote?: string;
  onClose?: () => void;
  onDone?: () => void;
}

let seqNo = 0;
const nextKey = () => `p${Date.now()}-${(seqNo += 1)}`;

/** 任务展示名只取标题首行，绝不把正文铺到面板上。 */
const taskTitleOf = (t: TaskOption | null | undefined) => {
  const line = String(t && (t.title || t.text) || '')
    .split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  return line.replace(/^#+\s*/, '').trim().slice(0, 80);
};

export default function AttachModal({
  open,
  host = 'task',
  hostId,
  hostKey,
  hostCwd,
  refId,
  allow = { file: true, url: true, task: false, ref: false },
  taskOptions = [],
  docOptions = null,
  replaceAttachment = null,
  replaceNote = '',
  onClose,
  onDone,
}: AttachModalProps) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urlVal, setUrlVal] = useState('');
  const [urlErr, setUrlErr] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [refSearch, setRefSearch] = useState('');
  const [docs, setDocs] = useState<DocOption[]>(docOptions || []);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const ep = useMemo(
    () => endpointOf(host, { hostId, hostKey, hostCwd, refId }),
    [host, hostId, hostKey, hostCwd, refId]
  );

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setDragOver(false);
    setBusy(false);
    setUrlVal('');
    setUrlErr('');
    setTaskSearch('');
    setRefSearch('');
    // 焦点落在拖拽区：不点任何地方直接 Ctrl/⌘+V 也能接住剪贴板里的截图
    const t = setTimeout(() => dropRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || docOptions || !allow.ref) return;
    let alive = true;
    // v7：ref 是 DB 实体，列表只给 desc / 标题与 refId——不展示任何 .md 路径。
    api<{ docs?: Array<DocOption & { docId?: string; refId?: string; desc?: string; rel?: string }> }>('/api/docs').then((r) => {
      if (!alive) return;
      const list = (r.docs || []).map((d) => {
        const ref = d.refId || d.docId || (d.rel ? `rel:${d.rel}` : '');
        const desc = String(d.desc || '').trim();
        const title = String(d.title || d.name || '').trim();
        return {
          ref,
          title: desc || title || '未命名文档',
          sub: desc && title && title !== desc ? title : '',
          desc,
        };
      }).filter((d) => !!d.ref);
      setDocs(list);
    }).catch(() => { /* 拉不到就只用手动输入 */ });
    return () => { alive = false; };
  }, [open, docOptions, allow.ref]);

  const addFiles = (list: FileList | File[] | null | undefined) => {
    if (!allow.file) return;
    const files = [...(list || [])].filter((f) => f && f.size > 0);
    if (!files.length) return;
    setItems((prev) => [
      ...prev,
      ...files.map((f, i) => {
        const name = readableName(f, i);
        return {
          key: nextKey(),
          source: 'file' as const,
          file: f,
          name,
          mime: f.type || '',
          size: f.size,
          status: 'pending' as const,
        };
      }),
    ]);
  };

  const addUrl = () => {
    const u = String(urlVal || '').trim();
    if (!/^https?:\/\//i.test(u)) {
      setUrlErr('需要 http(s) 绝对地址');
      return;
    }
    setUrlErr('');
    setUrlVal('');
    setItems((prev) => [
      ...prev,
      { key: nextKey(), source: 'url', url: u, name: u, size: 0, status: 'pending' },
    ]);
  };

  const addTask = (t: TaskOption) => {
    // name 只放标题（#seq + 首行），不要把整段正文当展示名传给服务端。
    const label = taskTitleOf(t);
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        source: 'task',
        seq: Number(t.id),
        name: `#${t.id} ${label}`.trim(),
        size: 0,
        status: 'pending',
      },
    ]);
    setTaskSearch('');
  };

  const addRef = (d: DocOption) => {
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        source: 'ref',
        docRef: d.ref,
        name: d.title || d.desc || d.name || d.ref,
        size: 0,
        status: 'pending',
        // 文档绑定的两个可选属性（#162）：说明（desc，随边落库、交付清单透出）
        // 与「进原文」（任务侧：交付带全文而不是只给路径）
        note: '',
        inline: false,
      },
    ]);
    setRefSearch('');
  };

  /** 改某个待确认文档条目的说明 / 进原文开关 */
  const patchRefItem = (key: string, patch: Partial<PendingItem>) =>
    setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const removeItem = (key: string) => setItems((prev) => prev.filter((x) => x.key !== key));

  const submitOne = async (it: PendingItem) => {
    setItems((prev) => prev.map((x) => (x.key === it.key ? { ...x, status: 'uploading', error: '' } : x)));
    try {
      let fileId = it.fileId;
      if (it.source === 'file' && !fileId) {
        const r = await uploadOne(it.file);
        fileId = r.fileId || r.id;
        if (!fileId) throw new Error('上传未返回 fileId');
      }
      await ep.attach(attachBodyOf({ ...it, fileId, note: it.note || replaceNote || '' }, host));
      // #168：换指向——新绑定挂好后解除旧的那条（旧资源进孤儿池，不删字节）
      if (replaceAttachment) {
        try { await ep.detach(replaceAttachment, false); } catch { /* 旧边解不掉也不影响新绑定 */ }
      }
      setItems((prev) => prev.filter((x) => x.key !== it.key));
      return true;
    } catch (e) {
      setItems((prev) => prev.map((x) =>
        x.key === it.key ? { ...x, status: 'error', error: String((e as Error).message || e) } : x
      ));
      return false;
    }
  };

  const submit = async (onlyKey?: string) => {
    if (busy) return;
    const targets = onlyKey ? items.filter((x) => x.key === onlyKey) : items;
    if (!targets.length) return;
    setBusy(true);
    let any = false;
    let failed = 0;
    for (const it of targets) {
      // 串行：上传/关系写入都是本机服务，逐项状态更可预期
      const ok = await submitOne(it);
      if (ok) any = true;
      else failed += 1;
    }
    setBusy(false);
    if (any) onDone?.();
    // 全部成功才关闭；有失败项就留在弹窗里让用户单独重试
    if (!failed) onClose?.();
  };

  const taskList = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    return taskOptions
      .filter((t) => String(t.id) !== String(hostId))
      .filter((t) => (q ? `${t.id} ${t.text || ''}`.toLowerCase().includes(q) : true))
      .slice(0, 12);
  }, [taskOptions, taskSearch, hostId]);
  const refList = useMemo(() => {
    const q = refSearch.trim().toLowerCase();
    return docs
      .filter((d) => (q ? `${d.title || ''} ${d.sub || ''} ${d.desc || ''} ${d.ref}`.toLowerCase().includes(q) : true))
      .slice(0, 12);
  }, [docs, refSearch]);

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = clipboardFiles(e);
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const pendingCount = items.filter((x) => x.status !== 'error').length;

  // 所有 hook 都已无条件跑完，才能早退（否则 open 由 false→true 时会
  // 多出两个 useMemo，React 直接报 #310）。
  if (!open) return null;

  return (
    <ModalBox
      title={replaceAttachment ? '更换文档绑定' : '添加附件'}
      size="md"
      onClose={busy ? undefined : onClose}
      busy={busy}
      className="att-modal"
      footer={
        <div className="att-foot">
          <span className="att-foot-hint">
            {items.length ? `待确认 ${pendingCount} 项${items.some((x) => x.status === 'error') ? '（失败项可单独重试）' : ''}` : '拖文件进来，或选择下面的来源'}
          </span>
          <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="btn" disabled={busy || !pendingCount} onClick={() => submit()}>
            {busy ? '提交中…' : '确认添加'}
          </button>
        </div>
      }
    >
      <div
        ref={dropRef}
        className={'att-drop' + (dragOver ? ' is-over' : '')}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.target === e.currentTarget) setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // attach/upload 仍是 JS 模块：droppedFiles 的返回被推成 unknown[]，约定就是 File[]
          addFiles(droppedFiles(e) as File[]);
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          // DOM 事件目标边界：键盘事件只有落在元素上才有 tagName
          const t = e.target as HTMLElement;
          if (e.key === 'Enter' && !e.defaultPrevented && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(t.tagName)) {
            e.preventDefault();
            submit();
          }
        }}
        tabIndex={0}
      >
        <div className="att-drop-title">拖拽文件到这里，或</div>
        <button type="button" className="btn ghost" onClick={() => fileRef.current?.click()}>
          选择文件（可多选）
        </button>
        <div className="att-drop-sub">支持截图直接粘贴（Ctrl/⌘ + V）</div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            // ⚠️ 先拷贝再清 value：FileList 是活引用，`value = ''` 会把它清空
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            addFiles(files);
          }}
        />
      </div>

      {allow.url && (
        <div className="att-row att-url-row">
          <input
            className="pp-input"
            placeholder="添加 URL（http/https）"
            value={urlVal}
            onChange={(e) => { setUrlVal(e.target.value); setUrlErr(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addUrl(); }
            }}
            spellCheck="false"
          />
          <button type="button" className="btn ghost" onClick={addUrl}>添加</button>
          {urlErr ? <span className="att-err-text">{urlErr}</span> : null}
        </div>
      )}

      {allow.task && (
        <div className="att-pick">
          <div className="att-pick-head">关联任务（本主题）</div>
          <input
            className="pp-input"
            placeholder="搜索任务编号或标题"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            onKeyDown={(e) => {
              const first = taskList[0];
              if (e.key === 'Enter' && first) { e.preventDefault(); addTask(first); }
            }}
            spellCheck="false"
          />
          {taskList.length ? (
            <div className="att-pick-list">
              {taskList.map((t) => (
                <button key={t.id} type="button" className="att-pick-item" onClick={() => addTask(t)}>
                  <span className="att-pick-main">#{t.id} {taskTitleOf(t) || '（无标题）'}</span>
                  {/* #121 统一组件：配色由 tstat-* 接管，att-sbadge 只给尺寸 */}
                  {/* icons/status-tag 仍是 JS：title 被推成必填，显式 undefined 不影响渲染 */}
                  <StatusTag t={t} className="att-sbadge" title={undefined} />
                </button>
              ))}
            </div>
          ) : (
            <div className="att-empty-inline">{taskOptions.length ? '没有匹配的任务' : '本主题暂无其它任务'}</div>
          )}
        </div>
      )}

      {allow.ref && (
        <div className="att-pick">
          <div className="att-pick-head">关联文档（ref）</div>
          <input
            className="pp-input"
            placeholder="搜索描述或标题"
            value={refSearch}
            onChange={(e) => setRefSearch(e.target.value)}
            onKeyDown={(e) => {
              const first = refList[0];
              if (e.key === 'Enter' && first) { e.preventDefault(); addRef(first); }
            }}
            spellCheck="false"
          />
          {refList.length ? (
            <div className="att-pick-list">
              {refList.map((d) => (
                <button key={d.ref} type="button" className="att-pick-item" onClick={() => addRef(d)}>
                  <span className="att-pick-main">{d.title || d.ref}</span>
                  {d.sub ? <span className="att-pick-path">{d.sub}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="att-empty-inline">{docs.length ? '没有匹配的文档' : '文档库为空'}</div>
          )}
        </div>
      )}

      {items.length ? (
        <div className="att-pending">
          <div className="att-pending-head">待确认清单</div>
          {items.map((it) => (
            <div key={it.key} className={'att-pending-item' + (it.status === 'error' ? ' is-error' : '')}>
              <span className="att-badge">{SOURCE_LABEL[it.source]}</span>
              <span className="att-pending-name" title={it.name}>{it.name}</span>
              <span className="att-pending-type">
                {badgeOf(it.source === 'file' ? (/^image\//i.test(it.mime || '') ? 'image' : 'file') : it.source)}
              </span>
              {it.size ? <span className="att-pending-size">{fmtSize(it.size)}</span> : null}
              {/* 文档条目：说明（desc）+ 进原文（任务侧才有效，#162） */}
              {it.source === 'ref' ? (
                <span className="att-pending-ref-opts">
                  <input
                    className="att-pending-note"
                    type="text"
                    value={it.note || ''}
                    placeholder="说明（这一行里大概是什么）"
                    disabled={busy}
                    onChange={(e) => patchRefItem(it.key, { note: e.target.value })}
                  />
                  {host === 'task' ? (
                    <label className="att-pending-inline" title="交付时把文档全文附进提示词，而不是只给路径">
                      <input
                        type="checkbox"
                        checked={!!it.inline}
                        disabled={busy}
                        onChange={(e) => patchRefItem(it.key, { inline: e.target.checked })}
                      />
                      进原文
                    </label>
                  ) : null}
                </span>
              ) : null}
              {it.status === 'uploading' ? <span className="att-pending-state">上传中…</span> : null}
              {it.status === 'error' ? (
                <>
                  <span className="att-err-text" title={it.error}>{it.error || '失败'}</span>
                  <button type="button" className="btn ghost att-mini" disabled={busy} onClick={() => submit(it.key)}>
                    重试
                  </button>
                </>
              ) : null}
              <button type="button" className="att-x" aria-label="移除待确认项" disabled={busy} onClick={() => removeItem(it.key)}>
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ModalBox>
  );
}
