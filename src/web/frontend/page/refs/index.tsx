// 文档列表右侧面板（refs）——与「进程」一致的**右侧栏面板**（可拖、可关）。
//
// 「更多 → 查看列表」打开：列出该项目 / 项目组的介绍文档集与 reference——
// 主篇 + 补充篇（介绍目录同目录 md）+ 登记的 reference（含 tag / note）。
// 点一行 → 在工作区开该文档的页签（带归属上下文，双链可跳）。
// 数据面与 DocsModal 同源：repo → GET /api/repos/docs；board → GET /api/boards/:id。
import { useCallback, useEffect, useState } from 'react';
import { boardDetail, repoDocs } from './api.js';
import { Icon } from '../../components/icons.jsx';
import { useWikiNav } from '../doc/index.jsx';
import type { DocOpenExtra } from '../doc/index.jsx';
import type { Model } from 'flexlayout-react';
import { closeRightPanelOf } from '../../workspace.js';
import './style.css';

/** 文档条目（/api/repos/docs 与 /api/boards/:id 里的 main / extras / links 共用形状）。 */
interface DocLink {
  rel?: string;
  path?: string;
  note?: string;
  tag?: string;
  title?: string;
}

/** 本页要读的两份出站载荷的并集（repo 侧叫 links，board 侧叫 docLinks）。 */
interface RefsData {
  main?: DocLink;
  introMain?: DocLink;
  extras?: DocLink[];
  introExtras?: DocLink[];
  links?: DocLink[];
  docLinks?: DocLink[];
  repo?: { name?: string };
  name?: string;
}

/** 列表行 = 原始条目 + 解析出的寻址串 / 主篇标记 / 显示名。 */
interface RefRow extends DocLink {
  docId: string;
  main: boolean;
  label?: string;
}

function docIdOf(l: DocLink | null | undefined) {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

function baseLabel(l: DocLink) {
  const s = l.rel || l.path || '';
  return String(s).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s || '未命名';
}

/** 数据 → 行（主篇 / 补充 / reference 三段，顺序稳定） */
function buildRows(d: RefsData | null): RefRow[] {
  const rows: RefRow[] = [];
  const main = d && (d.main || d.introMain);
  if (main) rows.push({ ...main, docId: docIdOf(main), main: true, label: d.repo ? d.repo.name : '主篇' });
  for (const l of (d && (d.extras || d.introExtras)) || []) {
    const id = docIdOf(l);
    if (id) rows.push({ ...l, docId: id, main: false, label: baseLabel(l) });
  }
  // 登记的 reference：repo 响应叫 links，board 响应叫 docLinks
  for (const l of (d && (d.links || d.docLinks)) || []) {
    const id = docIdOf(l);
    if (id) rows.push({ ...l, docId: id, main: false, label: baseLabel(l) });
  }
  return rows.filter((r) => r.docId);
}

export default function RefsPanel({ repoKey, boardKey, boardName, model }: {
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
  model?: Model | null;
}) {
  const { openByDocId } = useWikiNav(model);
  const [data, setData] = useState<RefsData | null>(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const d = repoKey ? await repoDocs(repoKey) : await boardDetail(String(boardKey));
        if (alive) setData(d);
      } catch (e) {
        if (alive) { setData(null); setErr(String((e as Error).message || e)); }
      }
    })();
    return () => { alive = false; };
  }, [repoKey, boardKey, tick]);

  const rows = buildRows(data);
  const title = data
    ? (data.repo ? data.repo.name : (data.name || boardName || '项目组'))
    : (boardName || '文档列表');
  // 打开文档页签带上归属上下文（DocPanel 顶部的归属与 IntroRail 数据面）
  const openExtra: DocOpenExtra = repoKey ? { repoKey } : { boardKey, boardName };

  return (
    <div className="nx-refs">
      <div className="nx-refs-h">
        <span className="t" title={title}>{title} · 文档列表</span>
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
        {!err && !data ? <div className="nx-refs-empty">读取中…</div> : null}
        {!err && data && !rows.length ? (
          <div className="nx-refs-empty">
            还没有文档<br />
            {repoKey ? '在目录页「查看详情」里点「＋ 补充」开始写' : '在项目组页「查看详情」里点「＋ 补充」开始写'}
          </div>
        ) : null}
        {rows.map((r) => (
          <button
            key={r.docId}
            type="button"
            className={'nx-refs-row' + (r.main ? ' main' : '')}
            title={`${r.rel || r.path || ''}${r.note ? `\n${r.note}` : ''}`}
            onClick={() => openByDocId(r.docId, null, openExtra)}
          >
            <span className="nx-refs-row-label">
              {r.main ? '● ' : '○ '}
              {r.label}
            </span>
            {r.tag ? <span className="nx-refs-row-tag">{r.tag}</span> : null}
            <span className="nx-refs-row-sub mono">{r.rel || r.path || ''}</span>
          </button>
        ))}
      </div>
      <div className="nx-refs-note">点一行在工作区打开文档页签；完整管理与就地编辑走「查看详情」。</div>
    </div>
  );
}
