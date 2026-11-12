// 文档页的「归属」（ref 视角）：这篇文档被哪些仓库 / 项目组引用。
//
// 形态（#183 收口）：归属不再是正文上方的一条常驻区块——那样白吃一行高度，
// 还和任务页的信息面板长得不一样。现在它是底部信息面板（DocDockPanel）的
// 一个 tab，入口是状态栏上的「归属 N」按钮，正文区只留编辑器本体。
//
// 因此这里导出的是 **hook**：数据与写操作都在 hook 里，面板只拿到 strip
// （tag 行）/ modal（加绑弹窗）两个节点——计数在 dock 收起时也要准，
// 状态不能跟着 tab 的挂载卸载走。
//
// 读：GET /api/docs/bindings?ref=<docId>（position=0 为主篇，不可解绑）。
// 写：复用宿主视角的既有接口——
//   · 仓库 → POST /api/repos/docs（登记）/ DELETE /api/repos/docs（index 1 = 主篇）
//   · 组   → POST /api/docs/link（doc / remove N）
// 后端 syncRefIndex 会在写入后自动重算 ref_bindings，所以操作完重新拉一次即最新。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '../../components/toast/index.jsx';
import { BindTags, type BindTagItem } from '../../components/bindings/bind-tags.js';
import {
  bindRepoDoc,
  docBindings,
  linkBoardDoc,
  listBoards,
  listRepos,
  unbindRepoDoc,
  unlinkBoardDoc,
  type DocBindingRow,
} from './api.js';

interface HostOpt { key: string; name: string; kind: 'repo' | 'group' }

/** docId（rel:/path:）→ locator（接口里 `rel` / `path` 的取值）。 */
function locatorOf(docId: string): string {
  const s = String(docId || '');
  if (s.startsWith('rel:')) return s.slice(4);
  if (s.startsWith('path:')) return s.slice(5);
  return s;
}

/** useDocBindings 的返回面：面板要的两个节点 + 计数。 */
export interface DocBindingsApi {
  count: number;
  /** tag 行（含「＋ 加绑」与空态提示） */
  strip: ReactNode;
  /** 加绑弹窗（关闭时为 null） */
  modal: ReactNode;
}

export function useDocBindings(docId: string | undefined, writable: boolean): DocBindingsApi {
  const toast = useToast();
  const [rows, setRows] = useState<DocBindingRow[]>([]);
  const [tick, setTick] = useState(0);
  const [repos, setRepos] = useState<HostOpt[]>([]);
  const [groups, setGroups] = useState<HostOpt[]>([]);
  const [busy, setBusy] = useState(false);
  // 加绑弹窗：kind + 选中宿主 + 备注
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<'repo' | 'group'>('repo');
  const [hostKey, setHostKey] = useState('');
  const [note, setNote] = useState('');

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // 宿主清单（名称映射 + 弹窗候选）：一次性拉，失败静默降级成 key 直显
  useEffect(() => {
    let alive = true;
    listRepos().then((d) => {
      if (!alive) return;
      const arr: any[] = Array.isArray(d) ? d : (d?.repos || []);
      const out = arr
        .filter((r) => r && r.key && (r.type || 'dev') !== 'group')
        .map((r) => ({ key: String(r.key), name: String(r.name || r.key), kind: 'repo' as const }));
      setRepos(out);
    }).catch(() => { /* 名称回落 key */ });
    listBoards().then((d) => {
      if (!alive) return;
      const arr: any[] = Array.isArray(d) ? d : (d?.boards || []);
      const out = arr
        .filter((b) => b && (b.key || b.id))
        .map((b) => ({ key: String(b.key || ('board/' + (b.name || b.id))), name: String(b.name || b.key), kind: 'group' as const }));
      setGroups(out);
    }).catch(() => { /* 同上 */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!docId) { setRows([]); return undefined; }
    let alive = true;
    docBindings(docId)
      .then((d) => { if (alive) setRows(Array.isArray(d?.bindings) ? d.bindings : []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [docId, tick]);

  const nameOf = useCallback((key: string): string => {
    const hit = repos.find((r) => r.key === key) || groups.find((g) => g.key === key);
    return hit ? hit.name : key;
  }, [repos, groups]);

  async function doUnbind(b: DocBindingRow) {
    if (busy) return;
    if (!window.confirm(`解绑：${b.repoKey} 不再引用这篇文档？\n（文档本身不删除，只摘掉这条归属）`)) return;
    setBusy(true);
    try {
      if (b.type === 'group') {
        await unlinkBoardDoc({ board: b.repoKey, remove: b.position });
      } else if (b.type === 'group_repo') {
        toast('组内成员描述请在该组的成员管理里摘除');
        setBusy(false);
        return;
      } else {
        await unbindRepoDoc({ id: b.repoKey, index: b.main ? 1 : b.position + 1 });
      }
      toast('已解绑');
      reload();
    } catch (e: any) {
      toast('解绑失败：' + (e?.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  function openAdd() {
    setKind('repo'); setHostKey(''); setNote(''); setAddOpen(true);
  }

  async function confirmAdd() {
    if (!hostKey) { toast('先选一个宿主'); return; }
    const loc = locatorOf(docId || '');
    if (!loc) { toast('当前文档没有可登记的路径'); return; }
    setBusy(true);
    try {
      if (kind === 'repo') {
        const isPath = String(docId).startsWith('path:');
        await bindRepoDoc(isPath ? { id: hostKey, path: loc, note } : { id: hostKey, rel: loc, note });
      } else {
        await linkBoardDoc({ board: hostKey, doc: loc, note });
      }
      setAddOpen(false);
      toast(kind === 'repo' ? '已加绑到仓库文档集' : '已加绑到组附加文档');
      reload();
    } catch (e: any) {
      toast('加绑失败：' + (e?.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }

  const items: BindTagItem[] = useMemo(() => rows.map((b) => {
    const group = b.type === 'group_repo' ? b.groupKey : null;
    const canRemove = writable && !b.main;
    return {
      id: `${b.refId}:${b.repoKey}:${b.groupKey || ''}:${b.position}`,
      label: nameOf(b.repoKey),
      kind: b.type === 'group' ? 'group' : 'repo',
      main: b.main,
      note: b.note || (group ? `组 ${nameOf(group)}` : ''),
      title: `${b.repoKey}${group ? ' @ ' + group : ''}\n${b.locator}`,
      onRemove: canRemove ? () => doUnbind(b) : undefined,
    } satisfies BindTagItem;
  }), [rows, writable, nameOf]);

  const candidates = kind === 'repo' ? repos : groups;
  // 已绑的宿主不再出现在候选里（group_repo 是「组内成员描述」，不占组/仓的文档集席位）
  const bound = new Set(rows.filter((b) => b.type !== 'group_repo').map((b) => b.repoKey));
  const free = candidates.filter((h) => !bound.has(h.key));

  // 面板体：没有标题行——计数在 dock tab / 状态栏上，说明在 title 里
  const strip = docId ? (
    <div className="docp-bind-panel" title="这篇文档被谁引用 —— tag 上的 ✕ 解绑（不删文档）">
      <BindTags
        items={items}
        addLabel="加绑宿主"
        onAdd={writable ? openAdd : undefined}
        empty="没有任何归属（孤儿文档）—— 不会被任何仓库 / 组面板列出"
      />
      {!rows.length && writable ? (
        <div className="docp-bind-orphan">孤儿状态：给这篇文档加绑一个仓库或项目组，它才会出现在对应面板的文档集里。</div>
      ) : null}
    </div>
  ) : null;

  const modal = addOpen ? (
    <div className="nb-overlay" onClick={(e) => { if (e.target === e.currentTarget) setAddOpen(false); }}>
      <div className="nb-modal">
        <div className="nb-modal-head">
          <span className="t">加绑宿主</span>
          <span className="sub">{locatorOf(docId || '')}</span>
          <button type="button" className="close" onClick={() => setAddOpen(false)}>✕</button>
        </div>
        <div className="nb-modal-body">
          <div className="nb-frow">
            <label>宿主类型</label>
            <div className="nb-seg">
              <button type="button" className={kind === 'repo' ? 'on' : ''} onClick={() => { setKind('repo'); setHostKey(''); }}>仓库</button>
              <button type="button" className={kind === 'group' ? 'on' : ''} onClick={() => { setKind('group'); setHostKey(''); }}>项目组</button>
            </div>
          </div>
          <div className="nb-frow">
            <label>{kind === 'repo' ? '选择仓库' : '选择项目组'}</label>
            <div className="nb-list">
              {free.length ? free.map((h) => (
                <label key={h.key} style={{ fontWeight: 400 }}>
                  <input type="radio" name="nb-host" checked={hostKey === h.key} onChange={() => setHostKey(h.key)} />
                  <span>{h.name}</span>
                  <span className="p">{h.key}</span>
                </label>
              )) : <label>（没有可加绑的{kind === 'repo' ? '仓库' : '项目组'}）</label>}
            </div>
          </div>
          <div className="nb-frow">
            <label>备注（可选）</label>
            <input className="nb-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：契约参考 / 旧版说明…" />
          </div>
        </div>
        <div className="nb-modal-foot">
          <span className="note">{kind === 'repo' ? '落点：repo.doc.add' : '落点：docs.link'}</span>
          <button type="button" className="nb-btn" onClick={() => setAddOpen(false)}>取消</button>
          <button type="button" className="nb-btn primary" disabled={busy} onClick={confirmAdd}>加绑</button>
        </div>
      </div>
    </div>
  ) : null;

  return { count: rows.length, strip, modal };
}
