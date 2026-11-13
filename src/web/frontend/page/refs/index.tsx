// 文档列表右侧面板（refs）——全站唯一的「列表」入口。
//
// 口径（v7 / 任务 #97）：ref 是 DB 实体（refs + ref_bodies + ref_bindings），
// 不是实体文件。列表只展示「desc（缺省标题）+ 归属」：
//   · 列表数据来自 GET /api/docs/bindings（host=仓库 / group=组）；
//   · 归属分色：repo（蓝）/ group（紫）/ group_repo（橙）；
//   · 没有正文的行灰化并标「无正文」；
//   · 点击行按 refId 打开（ref:<id>），不再用任何路径寻址；
//   · 「＋」直接建一个空正文的 ref 并按当前面板位置默认归属，建完立即编辑。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Model } from 'flexlayout-react';
import {
  createRef,
  docsBindings,
  unbindRef,
  type BindingRow,
} from './api.js';
import { Icon } from '../../components/icons.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { DocOpenExtra } from '../doc/index.jsx';
import { closeRightPanelOf } from '../../workspace.js';
import { useApp } from '../../app-context.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { notifyDocsChanged, onDocsChanged } from '../../modules/md/doc-bus.js';
import './style.css';

function labelOf(b: BindingRow): string {
  // 标题 = 用户在 md 编辑器里起的标题（正文首行），没有正文才回落到 desc。
  // v8 没有路径名了，再落一层正文摘要——否则旧文档全叫「未命名文档」。
  return b.title || b.desc || b.summary || '未命名文档';
}

function descOf(b: BindingRow): string {
  // desc 是「快速定位」的一句话；与标题相同就不重复占一行。
  const desc = String(b.desc || '').trim();
  return desc && desc !== labelOf(b) ? desc : '';
}

type ScopeBadge = { cls: 'repo' | 'group'; text: string };

function scopeBadgesOf(
  b: BindingRow,
  repoNameOf: (key: string) => string,
  groupNameOf: (key: string) => string
): ScopeBadge[] {
  if (b.type === 'repo') return [{ cls: 'repo', text: `仓库 · ${repoNameOf(b.repoKey)}` }];
  if (b.type === 'group') return [{ cls: 'group', text: `组 · ${groupNameOf(b.repoKey)}` }];
  // group_repo：组领域下的这个 repo —— 两个勋章拼在一起，颜色区分层级
  return [
    { cls: 'group', text: `组 · ${groupNameOf(b.groupKey || '')}` },
    { cls: 'repo', text: `仓库 · ${repoNameOf(b.repoKey)}` },
  ];
}

export default function RefsPanel({ repoKey, boardKey, boardName, model }: {
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
  model?: Model | null;
}) {
  const app = useApp();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav(model);

  // boardKey 可能传的是 id（组页面）——统一收成组 key（group/xxx）再去查归属
  const groupKey = useMemo(() => {
    const raw = String(boardKey || '');
    const b = (app.repoData?.boards || []).find(
      (x: any) => x.id === raw || x.key === raw || String(x.name || '').toLowerCase() === raw.toLowerCase()
    ) as any;
    return b?.key || raw;
  }, [app.repoData, boardKey]);

  const ownerName = useMemo(() => {
    if (repoKey) {
      const r = (app.repoData?.repos || []).find((x: any) => x.key === repoKey) as any;
      return r?.name || repoKey;
    }
    return boardName || groupKey.replace(/^group\//, '') || '项目组';
  }, [app.repoData, repoKey, boardName, groupKey]);

  const repoNameOf = useCallback((key: string) => {
    const r = (app.repoData?.repos || []).find((x: any) => x.key === key) as any;
    return r?.name || String(key || '').split('/').pop() || key || '未知仓库';
  }, [app.repoData]);

  const groupNameOf = useCallback((key: string) => {
    const raw = String(key || '');
    const seg = raw.replace(/^(board|group)\//, '');
    const b = (app.repoData?.boards || []).find((x: any) => {
      const k = String(x.key || '');
      return k === raw || k.replace(/^(board|group)\//, '') === seg || String(x.name || '') === seg;
    }) as any;
    return b?.name || seg || '未知组';
  }, [app.repoData]);

  const [rows, setRows] = useState<BindingRow[] | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const d = repoKey ? await docsBindings({ host: repoKey }) : await docsBindings({ group: groupKey });
        if (alive) setRows(d.bindings || []);
      } catch (e) {
        if (alive) { setRows([]); setErr(String((e as Error).message || e)); }
      }
    })();
    return () => { alive = false; };
  }, [repoKey, groupKey, tick]);

  // 文档页保存 / 新建 / 删除后自动刷新
  useEffect(() => onDocsChanged(reload), [reload]);

  const openExtra: DocOpenExtra = repoKey ? { repoKey } : { boardKey: groupKey, boardName };
  const openDoc = (refId: string) => openByDocId('ref:' + refId, null, openExtra);

  const guard = (fn: () => Promise<unknown>) => fn().catch((e) => toast(String((e as Error).message || e)));

  // ＋：直接建 ref（desc 空 + 当前宿主归属），建完立即打开编辑；不再弹窗、不拼任何文件名。
  const addDoc = () => guard(async () => {
    if (!repoKey && !groupKey) return;
    const owner = repoKey && groupKey ? 'group_repo' : repoKey ? 'repo' : 'group';
    const res = await createRef({ owner, repo: repoKey, group: owner === 'repo' ? undefined : groupKey, desc: '' });
    toast('已新建文档');
    notifyDocsChanged();
    reload();
    openDoc(res.refId);
  });

  // ×：解绑归属（文档不删）
  const removeRow = (b: BindingRow) => guard(async () => {
    const label = labelOf(b);
    const ok = await dialog({ message: `从「${label}」摘除？只解除归属，文档不删。`, danger: true });
    if (!ok) return;
    await unbindRef({ ref: b.refId, type: b.type, repo: b.repoKey, group: b.groupKey || undefined });
    toast('已摘除归属');
    notifyDocsChanged();
    reload();
  });

  const canAdd = !!(repoKey || groupKey);
  const count = rows ? rows.length : 0;

  return (
    <div className="nx-refs">
      <div className="nx-refs-h">
        <span className="t" title={ownerName}>{ownerName} · 文档列表</span>
        <span className="nx-refs-count">{count ? `${count} 篇` : ''}</span>
        {canAdd && (
          <button type="button" className="iconbtn" title="新建文档（直接编辑）" aria-label="新建文档" onClick={addDoc}>
            ＋
          </button>
        )}
        <button type="button" className="iconbtn" title="刷新" aria-label="刷新文档列表" onClick={reload}>
          <Icon name="refresh" size={13} title={undefined} />
        </button>
        {model && (
          <button
            type="button"
            className="iconbtn"
            title="关闭文档列表面板"
            aria-label="关闭文档列表面板"
            onClick={() => closeRightPanelOf(model, 'refs')}
          >
            <Icon name="x" size={14} title={undefined} />
          </button>
        )}
      </div>
      <div className="nx-refs-list">
        {err ? <div className="nx-refs-empty">{err}</div> : null}
        {!err && !rows ? <div className="nx-refs-empty">读取中…</div> : null}
        {!err && rows && !rows.length ? (
          <div className="nx-refs-empty">
            还没有文档<br />
            {canAdd ? '点右上角「＋」新建，建完直接编辑' : '这个宿主还没有可挂的文档'}
          </div>
        ) : null}
        {(rows || []).map((b) => {
          const title = labelOf(b);
          const desc = descOf(b);
          const badges = scopeBadgesOf(b, repoNameOf, groupNameOf);
          return (
            <div
              key={`${b.type}:${b.repoKey}:${b.groupKey || ''}:${b.refId}`}
              className={'nx-refs-row-wrap' + (b.hasBody ? '' : ' no-body') + (b.main ? ' main' : '')}
            >
              <button
                type="button"
                className="nx-refs-row"
                title={`${[title, desc, b.note].filter(Boolean).join('\n')}\n点击打开（可编辑）`}
                onClick={() => openDoc(b.refId)}
              >
                <span className="nx-refs-row-label">
                  <span className="nx-refs-row-badges">
                    {badges.map((x, i) => (
                      <span key={`${x.cls}:${i}`} className={`nx-refs-scope ${x.cls}`}>{x.text}</span>
                    ))}
                    {!b.hasBody && <span className="nx-refs-chip none">无正文</span>}
                  </span>
                  <span className="nx-refs-row-text">{title}</span>
                </span>
                {desc && <span className="nx-refs-row-desc">{desc}</span>}
                {b.note && <span className="nx-refs-row-sub">备注：{b.note}</span>}
              </button>
              <span className="nx-refs-row-acts">
                <button
                  type="button"
                  className="nx-refs-mini danger"
                  title="解绑归属（文档不删）"
                  onClick={() => removeRow(b)}
                >
                  ×
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <div className="nx-refs-note">点一行打开文档（编辑 / 保存在那一页）；× 摘除归属，不删文档。</div>
      {dialogNode}
    </div>
  );
}
