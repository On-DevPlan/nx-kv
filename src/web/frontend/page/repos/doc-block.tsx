// 文档区块（#143）：**只在 main 分支**出现，装着「现在文档管理的全部」。
//
// 为什么 main 要有这一块：右侧栏的文档列表是**按宿主收敛**的（某个仓库 / 某个组），
// 没有主篇、也没绑到任何宿主的 ref 在那边无处可见。main 作为「全部」视角，
// 正好承接这批「全局文档」——顺带把每一篇的归属（仓库 / 组 / 组内 / 参考）列清楚。
//
// 组分支里没有这一块：组的文档收敛在右侧「<组名> · 文档列表」里，切过去看更顺手
// （按钮在区块条右侧，点了就开右侧栏并提示）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useWikiNav } from '../doc/index.jsx';
import { listDocBindings, listDocs, removeDocItem } from './api.js';
import type { BoardRecord, RepoRecord } from './repo-table.js';
import { IconDoc, IconDocs } from './icons.jsx';

/** 一篇自有文档（GET /api/docs 的 docs[]）。 */
interface DocRow {
  docId?: string;
  refId?: string;
  name?: string;
  title?: string;
  desc?: string;
  summary?: string;
  size?: number;
  hasBody?: boolean;
  kind?: string;
  missing?: boolean;
  reason?: string;
}

/** 一条归属（GET /api/docs/bindings 的 bindings[]）。 */
interface BindingRow {
  refId: string;
  repoKey: string;
  groupKey: string | null;
  type: string;
  position: number;
  main: boolean;
  hostKind?: string;
}

interface HostBadge {
  text: string;
  cls: string;
  kind: 'repo' | 'group';
  target: string;
  title: string;
}

export default function DocBlock({ repos, boardList, q, onGoHost, tick, onCount }: {
  repos: RepoRecord[];
  boardList: BoardRecord[];
  q: string;
  onGoHost: (kind: 'repo' | 'group', target: string) => void;
  /** 外部写入（新建 / 删除文档）后 +1，用来重拉 */
  tick: number;
  onCount?: (n: number) => void;
}) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav();
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [bindings, setBindings] = useState<BindingRow[]>([]);

  const load = useCallback(async () => {
    const d = await listDocs().catch(() => null);
    const b = await listDocBindings().catch(() => null);
    setDocs((d && d.docs) || []);
    setBindings((b && b.bindings) || []);
  }, []);

  useEffect(() => { load(); }, [load, tick]);

  useEffect(() => {
    if (docs && onCount) onCount(docs.length);
  }, [docs, onCount]);

  const repoNameOf = useMemo(() => {
    const m = new Map<string, { name: string; isRef: boolean }>();
    for (const r of repos) m.set(r.key, { name: r.name || r.key, isRef: (r.type || 'dev') === 'ref' });
    return m;
  }, [repos]);

  const boardNameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of boardList) { m.set(b.key || '', b.name); m.set(b.id, b.name); }
    return m;
  }, [boardList]);

  const badgesOf = useCallback((refId: string): HostBadge[] => {
    const out: HostBadge[] = [];
    for (const b of bindings) {
      if (b.refId !== refId) continue;
      const main = Number(b.position) === 0 ? '（主篇）' : '';
      if (b.type === 'repo') {
        const hit = repoNameOf.get(b.repoKey);
        const isRef = hit ? hit.isRef : b.hostKind === 'ref';
        out.push({
          text: `${isRef ? '参考' : '仓'} · ${hit ? hit.name : b.repoKey}${main}`,
          cls: isRef ? 'ref' : 'repo',
          kind: 'repo',
          target: b.repoKey,
          title: `${isRef ? '参考仓库' : '开发仓库'}「${hit ? hit.name : b.repoKey}」的文档列表`,
        });
      } else if (b.type === 'group') {
        const name = boardNameOf.get(b.repoKey) || b.repoKey;
        out.push({
          text: `组 · ${name}${main}`,
          cls: 'group',
          kind: 'group',
          target: b.repoKey,
          title: `项目组「${name}」的文档列表`,
        });
      } else {
        const name = boardNameOf.get(b.groupKey || '') || b.groupKey || '';
        const rn = repoNameOf.get(b.repoKey);
        out.push({
          text: `组内 · ${name} / ${rn ? rn.name : b.repoKey}`,
          cls: 'scoped',
          kind: 'group',
          target: b.groupKey || '',
          title: `「${name}」里给仓库「${rn ? rn.name : b.repoKey}」的组内描述`,
        });
      }
    }
    return out;
  }, [bindings, repoNameOf, boardNameOf]);

  const shown = useMemo(() => {
    const list = docs || [];
    const k = q.trim().toLowerCase();
    if (!k) return list;
    return list.filter((d) => [d.name, d.title, d.desc, d.summary].some((x) => x && String(x).toLowerCase().includes(k)));
  }, [docs, q]);

  if (!docs) return <div className="rp-block-empty"><div className="rp-block-empty-t">读取中…</div></div>;

  if (!docs.length) {
    return (
      <div className="rp-block-empty">
        <div className="rp-block-empty-t">还没有文档</div>
        <div className="rp-block-empty-d">文档挂在仓库 / 组的文档列表里，也可以从仓库行的「＋ 写项目介绍」起一篇。</div>
      </div>
    );
  }

  const del = async (d: DocRow) => {
    const refId = String(d.refId || '');
    if (!refId) { toast('这篇文档没有可删除的 refId'); return; }
    const ok = await dialog({
      message: `删除文档「${d.title || d.name || refId}」？\n（自有文档，正文与归属一起删；不可恢复）`,
      danger: true,
    });
    if (!ok) return;
    const r = await removeDocItem({ ref: refId }).catch((e) => ({ error: String((e as Error).message || e) }));
    if (r && (r as { error?: string }).error) { toast(String((r as { error?: string }).error)); return; }
    toast('已删除');
    await load();
  };

  const open = (d: DocRow) => {
    const id = String(d.docId || (d.refId ? 'ref:' + d.refId : ''));
    if (!id) { toast('这篇文档没有可打开的地址'); return; }
    openByDocId(id);
  };

  return (
    <>
    <div className="rp-table-wrap" id="rp-docs">
      <table className="rp-table rp-table-doc">
        <thead>
          <tr>
            <th scope="col" style={{ width: '34%' }}>文档</th>
            <th scope="col" style={{ width: '30%' }}>归属</th>
            <th scope="col">摘要</th>
            <th scope="col" style={{ width: '84px' }}>大小</th>
            <th scope="col" style={{ width: '52px' }} aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {shown.map((d) => {
            const refId = String(d.refId || '');
            const badges = refId ? badgesOf(refId) : [];
            const title = d.title || d.name || '未命名文档';
            return (
              <tr key={d.docId || refId} className="rp-docrow" onClick={() => open(d)}
                title="点击打开这篇文档（可编辑）">
                <td className="rp-doc-cell-title">
                  <strong>
                    <span className="rp-doc-ico">{d.hasBody ? <IconDoc size={13} /> : <IconDocs size={13} />}</span>
                    {title}
                  </strong>
                  {d.desc ? <span className="rp-doc-desc">{d.desc}</span> : null}
                  {d.missing ? <span className="rp-doc-miss" title={d.reason || '没有正文'}>{d.reason || '无正文'}</span> : null}
                </td>
                <td className="rp-doc-cell-hosts">
                  {badges.length ? (
                    <span className="rp-doc-badges">
                      {badges.map((b, i) => (
                        <button
                          key={`${b.cls}:${b.target}:${i}`}
                          type="button"
                          className={'rp-scope-badge ' + b.cls}
                          title={b.title + '\n点击跳到这个宿主'}
                          onClick={(e) => { e.stopPropagation(); onGoHost(b.kind, b.target); }}
                        >
                          {b.text}
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="rp-doc-orphan" title="没有绑到任何仓库 / 组：只在 main 的文档区块里能看到">
                      未归属
                    </span>
                  )}
                </td>
                <td className="rp-doc-cell-summary">
                  <span className="rp-doc-summary" title={d.summary || ''}>{d.summary || '—'}</span>
                </td>
                <td className="rp-doc-cell-size mono">{d.size ? `${Math.max(1, Math.round(Number(d.size) / 1024))} KB` : '—'}</td>
                <td className="rp-doc-cell-acts">
                  {/* 删除（原来的「文档检索」弹窗里的能力）：只在 main 的文档区块提供，
                      删的是自有文档，归属会一起摘掉，正文随 ref 一起走。 */}
                  <button
                    type="button"
                    className="rp-doc-del"
                    title="删除这篇文档（自有文档；归属一并摘除）"
                    onClick={(e) => { e.stopPropagation(); del(d); }}
                  >×</button>
                </td>
              </tr>
            );
          })}
          {!shown.length ? (
            <tr><td colSpan={5} className="muted rp-empty">没有匹配的文档：换个关键字。</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
    {dialogNode}
    </>
  );
}
