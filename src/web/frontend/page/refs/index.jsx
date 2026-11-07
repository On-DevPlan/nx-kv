// 文档列表右侧面板（refs）——与「进程」一致的**右侧栏面板**（可拖、可关）。
//
// 「更多 → 查看列表」打开：列出该项目 / 项目组的介绍文档集与 reference——
// 主篇 + 补充篇（介绍目录同目录 md）+ 登记的 reference（含 tag / note）。
// 点一行 → 在工作区开该文档的页签（带归属上下文，双链可跳）。
// 数据面与 DocsModal 同源：repo → GET /api/repos/docs；board → GET /api/boards/:id。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { Icon } from '../../components/icons.jsx';
import { useWikiNav } from '../doc/index.jsx';
import { closeRightPanelOf } from '../../workspace.js';
import './style.css';

function docIdOf(l) {
  if (!l) return '';
  if (l.rel) return 'rel:' + l.rel;
  if (l.path) return 'path:' + l.path;
  return '';
}

function baseLabel(l) {
  const s = l.rel || l.path || '';
  return String(s).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || s || '未命名';
}

/** 数据 → 行（主篇 / 补充 / reference 三段，顺序稳定） */
function buildRows(d) {
  const rows = [];
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

export default function RefsPanel({ repoKey, boardKey, boardName, model }) {
  const { openByDocId } = useWikiNav(model);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setErr('');
    (async () => {
      try {
        const d = repoKey
          ? await api('/api/repos/docs?id=' + encodeURIComponent(repoKey))
          : await api('/api/boards/' + encodeURIComponent(String(boardKey)));
        if (alive) setData(d);
      } catch (e) {
        if (alive) { setData(null); setErr(String(e.message || e)); }
      }
    })();
    return () => { alive = false; };
  }, [repoKey, boardKey, tick]);

  const rows = buildRows(data);
  const title = data
    ? (data.repo ? data.repo.name : (data.name || boardName || '项目组'))
    : (boardName || '文档列表');
  // 打开文档页签带上归属上下文（DocPanel 顶部的归属与 IntroRail 数据面）
  const openExtra = repoKey ? { repoKey } : { boardKey, boardName };

  return (
    <div className="nx-refs">
      <div className="nx-refs-h">
        <span className="t" title={title}>{title} · 文档列表</span>
        <button type="button" className="iconbtn" title="刷新" aria-label="刷新文档列表" onClick={reload}>
          <Icon name="refresh" size={13} />
        </button>
        {model && (
          <button
            type="button"
            className="iconbtn"
            title="关闭文档列表面板"
            aria-label="关闭文档列表面板"
            onClick={() => closeRightPanelOf(model, 'refs')}
          >
            <Icon name="x" size={14} />
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
