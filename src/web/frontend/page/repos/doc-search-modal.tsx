// 文档检索（弹窗）：不铺全量长列表 —— 先按「仓库 / 组内 / 分组 / 未绑定」分档，
// 再叠加关键词过滤；绑定 chip 可点，直接跳到宿主。
// 归属只读 ref_bindings（GET /api/docs/bindings），不反推任何文档路径。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listDocBindings, listDocs, removeDocItem } from './api.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog, Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { BoardRecord, RepoRecord, ReposReload } from './repo-table.js';

/** 一篇自有文档（GET /api/docs 的 docs[]）。 */
interface DocRow {
  docId?: string;
  /** refs.id：归属唯一键（不展示） */
  refId?: string;
  name?: string;
  title?: string;
  /** v7：一句话描述（列表第二行 + 检索命中） */
  desc?: string;
  /** v6：没有正文（历史空壳 / 外部镜像 / 正文缺失）——列表里必须显式标注 */
  hasBody?: boolean;
  /** normal | legacy | external | empty */
  kind?: string;
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
}

/** 文档 → 宿主的反推项（kind 用来筛「仓库 / 分组 / 组内」三档）。 */
interface DocHost {
  key: string;
  kind: string;
  label: string;
  tip: string;
  target: string;
}

/** 文档分档。 */
type DocScopeKey = 'all' | 'repo' | 'board' | 'scoped' | 'orphan';

export default function DocSearchModal({ repos, boardList, onClose, onFilter, reload }: {
  repos: RepoRecord[];
  boardList: BoardRecord[];
  onClose: () => void;
  onFilter: (id: string) => void;
  reload: ReposReload;
}) {
  const guard = useGuard();
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const { openByDocId } = useWikiNav();
  // 全部自有文档（GET /api/docs）与全部归属（GET /api/docs/bindings）：
  // 弹窗每次打开重新拉，保证是最新的
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  // 分档：仓库文档 / 分组文档 / 组内文档 / 未绑定。
  // 这三档正是「repo、repo+group、group」三层 key —— 分开看才看得清关联。
  const [docScope, setDocScope] = useState<DocScopeKey>('all');
  const [docKw, setDocKw] = useState('');

  const loadDocs = useCallback(async () => {
    const [d, b] = await Promise.all([
      listDocs().catch(() => null),
      listDocBindings().catch(() => null),
    ]);
    setDocs((d && d.docs) || []);
    setBindings((b && b.bindings) || []);
  }, []);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // 文档 → 归属宿主：直接读 ref_bindings（一篇文档可挂多处）。
  // kind 用来筛「仓库 / 分组 / 组内」三档；target 是点击跳转的落点（仓库 key 或分组 id）。
  const docHosts = useMemo(() => {
    const m = new Map<string, DocHost[]>(); // refId → [{ key, kind, label, tip, target }]
    const repoName = (key: string) => repos.find((r) => r.key === key)?.name || key;
    const boardOf = (key: string) => boardList.find((b) =>
      b.id === key || b.key === key || b.name === key || 'board/' + b.name === key);
    const add = (refId: string, kind: string, label: string, tip: string, target: string) => {
      if (!refId || !target) return;
      if (!m.has(refId)) m.set(refId, []);
      const arr = m.get(refId);
      if (!arr) return;
      if (arr.some((x) => x.label === label)) return;
      arr.push({ key: refId + '|' + label, kind, label, tip: tip || label, target });
    };
    for (const b of bindings) {
      if (!b || !b.refId) continue;
      if (b.type === 'repo') {
        const name = repoName(b.repoKey);
        add(b.refId, 'repo', `仓：${name}`, `「${name}」的${b.main ? '项目介绍主篇' : '文档'}`, b.repoKey);
      } else if (b.type === 'group') {
        const board = boardOf(b.repoKey);
        const name = board ? board.name : b.repoKey;
        add(b.refId, 'board', `组：${name}`, `组「${name}」的${b.main ? '介绍文档' : '文档'}`, board ? board.id : '');
      } else if (b.type === 'group_repo') {
        const board = boardOf(String(b.groupKey || ''));
        const gname = board ? board.name : String(b.groupKey || '');
        const rname = repoName(b.repoKey);
        add(b.refId, 'scoped', `组内：${gname} / ${rname}`, `「${rname}」在组「${gname}」里的描述`, board ? board.id : '');
      }
    }
    return m;
  }, [bindings, repos, boardList]);

  const docRows = useMemo(() => {
    const kw = docKw.trim().toLowerCase();
    const rows = docs.map((d) => ({ d, hosts: docHosts.get(d.refId || '') || [] }));
    const hit = (x: { d: DocRow; hosts: DocHost[] }) => {
      if (!kw) return true;
      return [x.d.title, x.d.desc, x.d.name]
        .some((s) => s && String(s).toLowerCase().includes(kw))
        || x.hosts.some((h) => h.label.toLowerCase().includes(kw));
    };
    const list = rows.filter(hit);
    if (docScope === 'orphan') return list.filter((x) => !x.hosts.length);
    if (docScope === 'all') return list;
    return list.filter((x) => x.hosts.some((h) => h.kind === docScope));
  }, [docs, docHosts, docScope, docKw]);
  const docScopeCounts = useMemo<Record<DocScopeKey, number>>(() => {
    const c: Record<DocScopeKey, number> = { all: docs.length, repo: 0, board: 0, scoped: 0, orphan: 0 };
    for (const d of docs) {
      const hosts = docHosts.get(d.refId || '') || [];
      if (!hosts.length) c.orphan += 1;
      for (const k of ['repo', 'board', 'scoped'] as const) {
        if (hosts.some((h) => h.kind === k)) c[k] += 1;
      }
    }
    return c;
  }, [docs, docHosts]);

  // 区块跳转：绑定 chip 点击 = 跳到宿主（滚动到目标区块，不改变页面状态）。
  // 不用 scrollIntoView —— 面板内容挂在 FlexLayout 的 tab 里（.flexlayout__tab_moveable
  // 才是真正的滚动容器），这条链上的 scrollIntoView 实测无效，必须手动算 scrollTop。
  const scrollToEl = (el: HTMLElement | null, block = 'start') => {
    if (!el) return;
    let box: Element | null = el.parentElement;
    while (box) {
      const st = getComputedStyle(box);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && box.scrollHeight > box.clientHeight) break;
      box = box.parentElement;
    }
    if (!box) box = document.scrollingElement || document.documentElement;
    const base = box.getBoundingClientRect ? box.getBoundingClientRect().top : 0;
    const offset = el.getBoundingClientRect().top - base;
    const pad = block === 'center' ? (box.clientHeight - el.offsetHeight) / 2 : 12;
    box.scrollTop = Math.max(0, box.scrollTop + offset - pad);
  };
  const jumpTo = (id: string) => scrollToEl(document.getElementById(id));

  // 分组 → 筛到该组；仓库/组内 → 滚到那行并闪一下
  const docGo = (h: DocHost) => {
    if (!h || !h.target) return;
    if (h.kind === 'board') {
      onFilter(h.target);
      jumpTo('rp-repos');
      return;
    }
    onFilter('');
    const row = document.getElementById('rp-row-' + h.target);
    if (!row) { jumpTo('rp-repos'); return; }
    scrollToEl(row, 'center');
    row.classList.add('rp-row-flash');
    setTimeout(() => row.classList.remove('rp-row-flash'), 1400);
  };

  /** 文档标题：正文首行标题 → desc → 名字，不显示任何路径。 */
  const docLabelOf = (d: DocRow) => d.title || d.desc || d.name || '未命名文档';

  // 删文档：只删文档库条目与正文；不涉及磁盘文件。
  const delDoc = (d: DocRow) => guard(async () => {
    const label = docLabelOf(d);
    const hosts = docHosts.get(d.refId || '') || [];
    const ok = await dialog({
      message: `删除文档「${label}」？正文与归属会一并删除，不可恢复。`
        + (hosts.length ? `它正被 ${hosts.length} 处引用（${hosts.map((h) => h.label).join('、')}）。` : ''),
      danger: true,
    });
    if (!ok) return;
    await removeDocItem({ ref: d.docId });
    toast(`已删除：${label}`);
    await Promise.all([loadDocs(), reload.repos(), reload.boards()]);
  });

  return (
    <Modal size="wide" title={`文档检索 · ${docs.length}`} onClose={onClose}>
      <div className="rp-modal-bar rp-doc-bar">
        <input
          className="rp-search"
          type="search"
          value={docKw}
          onChange={(e) => setDocKw(e.target.value)}
          placeholder="搜标题 / 描述 / 组名 / 仓库名…"
          aria-label="检索文档"
        />
        {docKw ? <Button small onClick={() => setDocKw('')}>清空</Button> : null}
      </div>
      {docs.length ? (
        <>
          <div className="rp-doc-scopes">
            {([
              ['all', '全部', docScopeCounts.all],
              ['repo', '仓库文档', docScopeCounts.repo],
              ['scoped', '组内文档', docScopeCounts.scoped],
              ['board', '分组文档', docScopeCounts.board],
              ['orphan', '未绑定', docScopeCounts.orphan],
            ] as const).map(([id, label, n]) => (
              <button
                key={id}
                className={'rp-chip' + (docScope === id ? ' on' : '')}
                onClick={() => setDocScope(id)}
              >
                {label} <b>{n}</b>
              </button>
            ))}
          </div>
          <div className="rp-doc-rows rp-doc-rows-modal">
            {docRows.map(({ d, hosts }) => (
              <div className="rp-doc-row" key={d.docId}>
                <button
                  type="button"
                  className="rp-doc-row-title"
                  title={`打开「${docLabelOf(d)}」`}
                  onClick={() => openByDocId(d.docId)}
                >
                  {docLabelOf(d)}
                </button>
                {d.desc && d.title && d.desc !== d.title ? (
                  <span className="rp-doc-row-desc">{d.desc}</span>
                ) : null}
                {/* #114：「无正文」徽标已去掉——空文档不再当作可展示状态 */}
                <span className="rp-doc-row-hosts">
                  {hosts.length ? hosts.map((h) => (
                    <button
                      type="button"
                      className={'rp-bind-chip ' + h.kind}
                      key={h.key}
                      title={`${h.tip}\n点击跳到这个宿主`}
                      onClick={() => { docGo(h); onClose(); }}
                    >
                      {h.label}
                    </button>
                  )) : <span className="rp-bind-chip none">未绑定</span>}
                </span>
                <span className="rp-doc-row-acts">
                  <Button small onClick={() => openByDocId(d.docId)}>打开编辑</Button>
                  <Button small danger onClick={() => delDoc(d)}>删除</Button>
                </span>
              </div>
            ))}
            {!docRows.length ? (
              <div className="rp-board-empty muted">这一档没有匹配的文档。</div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="rp-board-empty muted">
          还没有文档 —— 到右侧文档列表点 ＋ 新建（直接写标题与描述）；
          或在仓库行上点「＋ 写项目介绍」。
        </div>
      )}
      {dialogNode}
    </Modal>
  );
}
