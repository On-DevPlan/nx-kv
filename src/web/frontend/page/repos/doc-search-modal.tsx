// 文档检索（弹窗）：不铺全量长列表 —— 先按「仓库 / 组内 / 分组 / 未绑定」分档，
// 再叠加关键词过滤；绑定 chip 可点，直接跳到宿主。
// 文档自己不记宿主，宿主关系散在仓库/分组的绑定字段上（docHosts 反推）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useGuard, useToast } from '../../components/toast/index.jsx';
import { useDialog, Modal } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { BoardRecord, RepoRecord, ReposReload } from './repo-table.js';

/** 一篇自有文档（GET /api/docs 的 docs[]）。 */
interface DocRow {
  docId?: string;
  rel?: string;
  name?: string;
  title?: string;
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
  // 全部自有文档（GET /api/docs）：弹窗每次打开重新拉，保证是最新的
  const [docs, setDocs] = useState<DocRow[]>([]);
  // 分档：仓库文档 / 分组文档 / 组内文档 / 未绑定。
  // 这三档正是「repo、repo+group、group」三层 key —— 分开看才看得清关联。
  const [docScope, setDocScope] = useState<DocScopeKey>('all');
  const [docKw, setDocKw] = useState('');

  const loadDocs = useCallback(async () => {
    const d = await api('/api/docs').catch(() => null);
    setDocs((d && d.docs) || []);
  }, []);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // 文档 → 绑定宿主 反推表：一篇文档被哪些仓库/分组引用。
  // 文档自己不记宿主，宿主关系散落在仓库与分组的绑定字段上：
  //   repo.descDocs.main.rel（主篇）/ repo.descDocs.links[].docId（补充篇，'rel:' 前缀）
  //   repo.boards[].noteDocRel（组内描述，仓库侧冗余）
  //   board.docRel（组介绍）/ board.docLinks[].rel（组补充）/ board.repos[].noteDocRel（组内描述）
  // kind 用来筛「仓库 / 分组 / 组内」三档；target 是点击跳转的落点（仓库 key 或分组 id）。
  const docHosts = useMemo(() => {
    const m = new Map<string, DocHost[]>(); // rel → [{ key, kind, label, tip, target }]
    const add = (rel: string | undefined, kind: string, label: string, tip: string, target: string) => {
      if (!rel) return;
      if (!m.has(rel)) m.set(rel, []);
      const arr = m.get(rel);
      if (!arr) return;
      if (arr.some((x) => x.label === label)) return;
      arr.push({ key: rel + '|' + label, kind, label, tip: tip || label, target });
    };
    for (const r of repos) {
      const main = r.descDocs && r.descDocs.main;
      if (main && main.rel) add(main.rel, 'repo', `仓：${r.name}`, `「${r.name}」的项目介绍主篇`, r.key);
      for (const l of (r.descDocs && r.descDocs.links) || []) {
        const rel = String(l.docId || '').startsWith('rel:') ? String(l.docId).slice(4) : '';
        add(rel, 'repo', `仓：${r.name}`, `「${r.name}」的补充文档${l.tag ? `（${l.tag}）` : ''}`, r.key);
      }
      for (const b of r.boards || []) {
        add(b.noteDocRel, 'scoped', `组内：${b.name} / ${r.name}`, `「${r.name}」在组「${b.name}」里的组内描述`, b.id);
      }
    }
    for (const b of boardList) {
      if (b.docRel) add(b.docRel, 'board', `组：${b.name}`, `组「${b.name}」的介绍文档`, b.id);
      for (const l of b.docLinks || []) add(l.rel, 'board', `组：${b.name}`, `组「${b.name}」的补充文档`, b.id);
      for (const mb of b.repos || []) {
        add(mb.noteDocRel, 'scoped', `组内：${b.name} / ${mb.name || mb.key}`, `组「${b.name}」里的组内描述`, b.id);
      }
    }
    return m;
  }, [repos, boardList]);

  const docRows = useMemo(() => {
    const kw = docKw.trim().toLowerCase();
    const rows = docs.map((d) => ({ d, hosts: docHosts.get(d.rel || '') || [] }));
    const hit = (x: { d: DocRow; hosts: DocHost[] }) => {
      if (!kw) return true;
      return [x.d.title, x.d.name, x.d.rel]
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
      const hosts = docHosts.get(d.rel || '') || [];
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

  // 「新建文档」不先逼人取名：点＋直接用默认路径落盘并打开编辑器，
  // 想改名在文档页「更多 → 重命名」里改（#49）。重名自动加序号，不覆盖已有文件。
  const nextDocRel = (base: string) => {
    const taken = new Set((docs || []).map((d) => String(d.rel || '').toLowerCase()));
    let rel = `${base}.md`;
    if (!taken.has(rel.toLowerCase())) return rel;
    for (let i = 2; ; i += 1) {
      rel = `${base}-${i}.md`;
      if (!taken.has(rel.toLowerCase())) return rel;
    }
  };

  // 新建文档：默认路径 → 落空文档 → 打开编辑器（一步到位，不弹命名框）
  const createDoc = () => guard(async () => {
    const rel = nextDocRel('note/untitled');
    await api('/api/docs/item', { method: 'POST', body: { rel, body: '' } }).catch(() => {});
    onClose(); // 先关弹窗，落点是编辑器
    openByDocId('rel:' + rel);
    await loadDocs();
  });

  // 删文档：文件本体删掉（入参 ref = docId）。它仍被引用时先把引用数摆出来让人知情。
  const delDoc = (d: DocRow) => guard(async () => {
    const hosts = docHosts.get(d.rel || '') || [];
    const ok = await dialog({
      message: `删除文档「${d.title || d.rel}」？磁盘文件会被删除。`
        + (hosts.length ? `它正被 ${hosts.length} 处引用（${hosts.map((h) => h.label).join('、')}）。` : ''),
      danger: true,
    });
    if (!ok) return;
    await api('/api/docs/item', { method: 'DELETE', body: { ref: d.docId } });
    toast(`已删除：${d.rel}`);
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
          placeholder="搜标题 / 路径 / 组名 / 仓库名…"
          aria-label="检索文档"
        />
        {docKw ? <Button small onClick={() => setDocKw('')}>清空</Button> : null}
        <span className="acts">
          <Button small onClick={createDoc}>新建文档</Button>
        </span>
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
                  title={`打开「${d.title || d.rel}」`}
                  onClick={() => openByDocId(d.docId)}
                >
                  {d.title || d.name || d.rel}
                </button>
                <code className="rp-doc-row-rel" title={d.rel}>{d.rel}</code>
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
          还没有文档 —— 点「新建文档」给一个相对路径（如 note/inbox.md）就开写；
          或在仓库行上点「＋ 写项目介绍」。
        </div>
      )}
      {dialogNode}
    </Modal>
  );
}
