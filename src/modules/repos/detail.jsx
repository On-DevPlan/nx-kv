// 仓库详情页（#/repo/<key>）：**一个仓库的信息 + 它的 md 描述 + 它的任务**。
//
// 为什么要这一页（用户的原始诉求）：
//   1. 侧边栏「所有资源都应该支持点击」——没有任务队列的仓库以前点了没反应，
//      因为它唯一的去处是工作台（#/dir/<topicKey>），而空队列没有 topicKey；
//   2. 点开要能看到**仓库信息**，并且 desc 不是一句话而是 **md 列表**
//      （[]md 是 string desc 的上位替代，链到仓库里的本地 md 文件）；
//   3. 顺带能看到这个仓库**相关的任务**（本机队列按 cwd 匹配到它）。
//
// 数据边界：仓库登记来自 /api/repos/:id，md 正文来自 /api/repos/doc，
// 任务来自 App 已经轮询着的 localtasks（rows），这一页不自己再拉一遍队列。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useGuard, useToast, Copyable } from '../../web/frontend/components/ui.jsx';
import { Icon } from '../../web/frontend/components/icons.jsx';
import { renderMarkdownHtml } from '../../web/frontend/modules/md-workspace/md-parse.js';

/** 任务正文里抽一行标题（与侧边栏同一口径：`# 标题` 优先，否则首行） */
function taskTitle(t) {
  const text = String(t?.text || '');
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const line = text.split('\n').find((l) => l.trim());
  return (line || `#${t.id}`).trim().slice(0, 80);
}

const isDeleted = (t) => !!t.deletedAt;
const isPending = (t) => t.status !== 'consumed' && !t.deletedAt;

export default function RepoDetail({ dirKey, rows, onNavigate }) {
  const guard = useGuard();
  const toast = useToast();

  const [repo, setRepo] = useState(null);   // 仓库登记
  const [err, setErr] = useState('');
  const [active, setActive] = useState(''); // 当前 md（相对路径）
  const [doc, setDoc] = useState(null);     // { path, text, size }
  const [docErr, setDocErr] = useState('');
  const [adding, setAdding] = useState(''); // 「挂一个 md」输入框

  const load = useCallback(async () => {
    if (!dirKey) return;
    setErr('');
    try {
      const d = await api('/api/repos/' + encodeURIComponent(dirKey));
      setRepo(d);
      // 选中哪份 md：?doc=<相对路径> 优先（列表里点具体某份直达），否则第一份
      const want = (() => {
        const m = /[?&]doc=([^&]+)/.exec(typeof location !== 'undefined' ? location.hash || '' : '');
        return m ? decodeURIComponent(m[1]) : '';
      })();
      setActive((cur) => {
        if (want && (d.docs || []).includes(want)) return want;
        if (cur && (d.docs || []).includes(cur)) return cur;
        return (d.docs || [])[0] || '';
      });
    } catch (e) {
      setErr(String((e && e.message) || e));
    }
  }, [dirKey]);
  useEffect(() => { load(); }, [load]);

  // md 正文按需拉（一次一份，切换时再拉：md 可能很大，没必要全预取）
  useEffect(() => {
    if (!repo || !active) { setDoc(null); return; }
    let alive = true;
    setDocErr('');
    api('/api/repos/doc?id=' + encodeURIComponent(repo.key) + '&path=' + encodeURIComponent(active))
      .then((d) => { if (alive) setDoc(d); })
      .catch((e) => { if (alive) { setDoc(null); setDocErr(String((e && e.message) || e)); } });
    return () => { alive = false; };
  }, [repo, active]);

  // 这个仓库的本机队列：服务端按 cwd 匹配登记，topic.repo.id 就是它
  const topic = useMemo(() => {
    if (!repo) return null;
    return (rows || []).find((t) => t.repo && t.repo.id === repo.id) || null;
  }, [rows, repo]);

  const tasks = useMemo(() => {
    const list = (topic && topic.tasks) || [];
    return {
      pending: list.filter(isPending),
      done: list.filter((t) => t.status === 'consumed' && !isDeleted(t)).slice().reverse(),
    };
  }, [topic]);

  const addDoc = () => guard(async () => {
    const p = adding.trim();
    if (!p) return;
    setAdding('');
    if ((repo.docs || []).includes(p)) return;
    await api('/api/repos/' + encodeURIComponent(repo.id), {
      method: 'PATCH',
      body: { docs: [...(repo.docs || []), p] },
    });
    await load();
    setActive(p); // 挂上就直接看它（挂错了下一步就是「摘掉」）
    toast('已挂上 ' + p);
  });

  const removeDoc = (p) => guard(async () => {
    await api('/api/repos/' + encodeURIComponent(repo.id), {
      method: 'PATCH',
      body: { docs: (repo.docs || []).filter((x) => x !== p) },
    });
    if (active === p) setActive('');
    await load();
  });

  const openFolder = () => guard(async () => {
    await api('/api/repos/open', { method: 'POST', body: { id: repo.id } });
  });

  if (err) {
    return (
      <div className="rpd">
        <div className="rpd-err">
          仓库读取失败：{err}
          <button className="btn small ghost" onClick={load}>重试</button>
          <button className="btn small ghost" onClick={() => onNavigate('#/repos')}>回仓库管理</button>
        </div>
      </div>
    );
  }
  if (!repo) return <div className="rpd"><div className="muted" style={{ padding: 24 }}>读取中…</div></div>;

  return (
    <div className="rpd" data-testid="repo-detail">
      <div className="rpd-head">
        <div className="rpd-title">
          <h2>{repo.name}</h2>
          <span className="rpd-badge">{repo.type === 'ref' ? '参考仓库' : '开发仓库'}</span>
          {repo.frozen ? (
            <span className="rpd-badge warn" title="没有 key：既没有远程地址，也没有自定义 key。导出导入不包含它">无 key · 冻结</span>
          ) : (
            <span className="rpd-badge key" title="key 是身份，导出导入按它映射">
              {repo.keyCustom ? '自定义 key' : 'key 跟随远程地址'}
            </span>
          )}
        </div>
        {repo.desc ? <div className="rpd-desc">{repo.desc}</div> : null}
        <div className="rpd-acts">
          {topic ? (
            <button className="btn small" onClick={() => onNavigate('#/dir/' + encodeURIComponent(topic.key))}>
              打开工作台{topic.pending ? `（${topic.pending} 待领）` : ''}
            </button>
          ) : null}
          <button className="btn small ghost" onClick={openFolder}>打开目录</button>
          <button className="btn small ghost" onClick={() => onNavigate('#/repos')}>仓库管理</button>
        </div>
      </div>

      <div className="rpd-cols">
        {/* 左：md 描述列表（desc 的上位替代） */}
        <section className="rpd-docs">
          <div className="rpd-colhead">
            <h3>描述文档</h3>
            <span className="muted">仓库内的 md（相对路径），谁写谁维护</span>
          </div>
          <div className="rpd-tabs">
            {(repo.docs || []).map((p) => (
              <span key={p} className={'rpd-tab' + (active === p ? ' on' : '')}>
                <button className="rpd-tab-name" onClick={() => setActive(p)} title={p}>{p}</button>
                <button className="rpd-tab-x" title="从描述里摘掉（不删文件）" onClick={() => removeDoc(p)}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
            <span className="rpd-add">
              <input
                value={adding}
                placeholder="挂一个 md，如 README.md"
                spellCheck="false"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addDoc(); }}
              />
              <button className="btn small ghost" onClick={addDoc} disabled={!adding.trim()}>挂上</button>
            </span>
          </div>
          {active ? (
            docErr ? (
              <div className="rpd-docerr">
                {docErr}
                <button className="btn small ghost" onClick={() => setActive('')}>关闭</button>
              </div>
            ) : doc ? (
              <article
                className="rpd-md"
                // md 渲染用工作台同一份解析器：预览与真实内容不会各说各话
                dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(doc.text) }}
              />
            ) : (
              <div className="muted" style={{ padding: 12 }}>读取中…</div>
            )
          ) : (
            <div className="rpd-empty">
              还没有描述文档。{repo.desc ? '现在只有一句描述：' : ''}
              {repo.desc ? <b>{repo.desc}</b> : null}
              <div className="muted">
                在上面的输入框里填一个**仓库内**的 md 相对路径（<code>README.md</code>、
                <code>docs/arch.md</code>），挂上就能在这里读。
              </div>
            </div>
          )}
        </section>

        {/* 右：身份 + 项目组 + 相关任务 */}
        <aside className="rpd-side">
          <div className="rpd-card">
            <div className="rpd-colhead"><h3>登记信息</h3></div>
            <dl className="rpd-fields">
              <dt>key</dt>
              <dd><Copyable text={repo.key || '（无）'} title="点击复制">{repo.frozen ? '（无 · 冻结）' : repo.key}</Copyable></dd>
              <dt>远程</dt>
              <dd>{repo.remote ? <Copyable text={repo.remote} title="点击复制">{repo.remote}</Copyable> : <span className="muted">（无）</span>}</dd>
              <dt>路径</dt>
              <dd><Copyable text={repo.path} title="点击复制">{repo.path}</Copyable></dd>
              {repo.notes ? (<><dt>备注</dt><dd>{repo.notes}</dd></>) : null}
            </dl>
          </div>

          <div className="rpd-card">
            <div className="rpd-colhead">
              <h3>项目组</h3>
              <span className="muted">{(repo.boards || []).length ? `${repo.boards.length} 个` : ''}</span>
            </div>
            {(repo.boards || []).length ? (
              <div className="rpd-chips">
                {repo.boards.map((b) => (
                  <button key={b.id} className="rpd-chip" title={b.desc || ''}
                    onClick={() => onNavigate('#/repos?board=' + encodeURIComponent(b.id))}>
                    {b.name}
                  </button>
                ))}
              </div>
            ) : <div className="muted rpd-none">还没进任何项目组</div>}
          </div>

          <div className="rpd-card">
            <div className="rpd-colhead">
              <h3>相关任务</h3>
              <span className="muted">
                {topic ? `${tasks.pending.length} 待领 · ${tasks.done.length} 已领` : '本机队列未建立'}
              </span>
            </div>
            {!topic ? (
              <div className="rpd-empty small">
                这个目录还没有任务队列。往它投一条任务（在本目录下）：
                <code>nx-kv localtask add "要做的事" --cwd {repo.path}</code>
              </div>
            ) : (
              <>
                {tasks.pending.length || tasks.done.length ? (
                  <ul className="rpd-tasks">
                    {tasks.pending.map((t) => (
                      <li key={t.id} className="pending">
                        <span className="rpd-dot" />
                        <span className="rpd-task-title" title={t.text || ''}>{taskTitle(t)}</span>
                        <button className="rpd-task-go" title="在工作台打开"
                          onClick={() => onNavigate('#/dir/' + encodeURIComponent(topic.key) + '?task=' + encodeURIComponent(t.id))}>
                          <Icon name="jump" size={11} />
                        </button>
                      </li>
                    ))}
                    {tasks.done.map((t) => (
                      <li key={t.id} className="done">
                        <span className="rpd-dot" />
                        <span className="rpd-task-title" title={t.text || ''}>{taskTitle(t)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rpd-empty small">
                    队列是空的——没有待领取的任务。
                    <code>nx-kv localtask add "要做的事"</code>
                  </div>
                )}
                <button className="btn small ghost rpd-open-dir" onClick={() => onNavigate('#/dir/' + encodeURIComponent(topic.key))}>
                  去工作台
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
