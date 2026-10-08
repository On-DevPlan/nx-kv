// 实时任务页：主题（按工作目录划分）总览 + 选中某个主题回填 + 该主题的任务队列。
// 本质是「agent 提交结果 → 阻塞 → 用户在 web 针对主题回填 → agent 接收」。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../web/frontend/api/client.js';
import { useToast, useGuard } from '../../web/frontend/components/ui.jsx';
import { CliHints } from '../../web/frontend/components/CliHints.jsx';

// “YYYY-MM-DD HH:mm:ss” → 本地 Date
function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '');
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
function countdown(s) {
  const d = parseStamp(s);
  if (!d) return '';
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return '等待中 0:00';
  const mm = Math.floor(ms / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  return `等待中 ${mm}:${String(ss).padStart(2, '0')}`;
}

export default function SessionTaskView() {
  const toast = useToast();
  const guard = useGuard();

  const [overview, setOverview] = useState(null);
  const [activeKey, setActiveKey] = useState(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState(180);
  const [cfgSaving, setCfgSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await api('/api/sessiontasks'));
    } catch (e) {
      toast(e.message);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时刷新：主题状态/倒计时、任务是否被取走，每 1.5s 轮询
  useEffect(() => {
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  const topics = overview ? overview.topics : [];

  // 同步页面上的超时配置（来源：后端 settings）
  useEffect(() => {
    if (overview && overview.settings) setTimeoutSec(overview.settings.timeoutSec);
  }, [overview]);

  const saveTimeout = (sec) =>
    guard(async () => {
      setTimeoutSec(Number(sec));
      setCfgSaving(true);
      try {
        const s = await api('/api/sessiontasks/setting', {
          method: 'PATCH',
          body: { timeout: Number(sec) },
        });
        setTimeoutSec(s.timeoutSec);
        toast(`等待超时已配置为 ${s.timeoutSec} 秒`);
      } finally {
        setCfgSaving(false);
      }
    });

  // 默认选中：优先等待中的，否则第一个；用户已选且仍存在则保留
  useEffect(() => {
    if (!topics.length) {
      setActiveKey(null);
      return;
    }
    if (activeKey && topics.some((t) => t.key === activeKey)) return;
    const w = topics.find((t) => t.waiting) || topics[0];
    setActiveKey(w.key);
  }, [topics, activeKey]);

  const active = topics.find((t) => t.key === activeKey) || null;

  const submit = () =>
    guard(async () => {
      const body = text.trim();
      if (!body) {
        toast('请输入任务内容');
        return;
      }
      if (!active) {
        toast('请先选择一个主题（工作目录）');
        return;
      }
      setSaving(true);
      try {
        const r = await api('/api/sessiontasks', {
          method: 'POST',
          body: { cwd: active.cwd, text: body },
        });
        setText('');
        toast(r.delivered ? '已返回给等待中的 agent' : '已排入该主题队列，等待 agent 下一次 wait');
        await load();
      } finally {
        setSaving(false);
      }
    });

  const remove = (id) =>
    guard(async () => {
      await api('/api/sessiontasks/item', {
        method: 'DELETE',
        body: { cwd: active.cwd, id },
      });
      toast('已删除');
      await load();
    });

  const tasks = active ? active.tasks.slice().reverse() : [];

  return (
    <>
      <div className="card" style={{ padding: '10px 14px' }}>
        <div className="muted" style={{ fontSize: 12 }}>
          agent 用法：完成当前任务后，把
          <code> nx-kv sessiontask wait --cwd "&lt;工作目录&gt;" --summary "&lt;当前现状&gt;" --json </code>
          作为本轮<strong>最后一个动作</strong>调用——工作目录即<strong>主题</strong>、主题拥有任务队列，
          同目录共用队列、不同目录互不串，任务可在队列里堆积；命令阻塞并自动打开浏览器弹窗，
          用户回填后解除阻塞、返回新任务；超时未回填则返回 <code>status:"timeout"</code>，agent 收尾结束本轮。
        </div>
      </div>

      <div className="card" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>等待超时</span>
        <select
          value={timeoutSec}
          disabled={cfgSaving}
          onChange={(e) => saveTimeout(e.target.value)}
          style={{ font: 'inherit', padding: '5px 8px' }}
        >
          <option value={60}>1 分钟</option>
          <option value={120}>2 分钟</option>
          <option value={180}>3 分钟（推荐）</option>
          <option value={240}>4 分钟</option>
          <option value={300}>5 分钟</option>
          <option value={600}>10 分钟（最大）</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>
          agent wait 未带 --timeout 时使用此值；推荐 3 分钟、最大 10 分钟。
        </span>
      </div>

      <div className="colhead">
        <h3>主题总览（按工作目录）</h3>
        <span className="muted">{overview ? `${topics.length} 个 · 等待中 ${overview.waiting}` : ''}</span>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {topics.length ? (
          topics.map((t) => {
            const isActive = t.key === activeKey;
            return (
              <button
                key={t.key}
                onClick={() => setActiveKey(t.key)}
                className="card"
                style={{
                  textAlign: 'left',
                  width: 270,
                  padding: '10px 12px',
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'inherit',
                  border: isActive ? '1px solid var(--ink,#14161a)' : '1px solid transparent',
                  boxShadow: isActive
                    ? '0 0 0 2px rgba(20,22,26,.12)'
                    : '0 1px 2px rgba(20,22,26,.06), 0 6px 16px rgba(20,22,26,.05)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.name || '（未命名）'}</div>
                <div
                  className="mono muted"
                  title={t.cwd}
                  style={{ fontSize: 11, wordBreak: 'break-all', marginBottom: 6, minHeight: 15 }}
                >
                  {t.cwd || '（旧数据，无目录）'}
                </div>
                {t.summary && (
                  <div className="muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                    现状：{t.summary}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {t.waiting ? (
                    <span className="tag strong">{countdown(t.waitingUntil)}</span>
                  ) : (
                    <span className="tag">已结束</span>
                  )}
                  <span className="muted" style={{ fontSize: 11 }}>
                    待领取 {t.pending}/{t.total}
                  </span>
                </div>
              </button>
            );
          })
        ) : (
          <div className="card muted" style={{ padding: '20px 16px', width: '100%', textAlign: 'center' }}>
            （暂无主题；agent 调用 sessiontask wait 后会出现在这里）
          </div>
        )}
      </div>

      {active && (
        <>
          <div className="toolbar">
            <span style={{ fontWeight: 700, maxWidth: 240 }} title={active.cwd}>
              {active.name}
            </span>
            <span className="sep"></span>
            <textarea
              style={{ flex: 1, minWidth: 240, minHeight: 40, resize: 'vertical' }}
              spellCheck="false"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={`向主题「${active.name}」的队列回填下一条任务（Enter 提交，Shift+Enter 换行）`}
            />
            <button className="btn" onClick={submit} disabled={saving}>
              {saving ? '提交中…' : '回填新任务'}
            </button>
          </div>

          <div className="colhead">
            <h3>该主题的任务队列</h3>
            <span className="muted">待领取 {active.pending} · 共 {active.total} 条</span>
          </div>

          <div className="card" style={{ padding: 4 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>任务</th>
                  <th style={{ width: 80 }}>状态</th>
                  <th style={{ width: 160 }}>时间</th>
                  <th style={{ width: 76 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length ? (
                  tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">#{t.id}</td>
                      <td style={{ whiteSpace: 'pre-wrap' }}>{t.text}</td>
                      <td>
                        {t.status === 'consumed' ? (
                          <span className="tag strong">已领取</span>
                        ) : (
                          <span className="tag">待领取</span>
                        )}
                      </td>
                      <td className="mono">{t.consumedAt || t.createdAt}</td>
                      <td className="ops">
                        <button className="btn small ghost" onClick={() => remove(t.id)}>删除</button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="muted" style={{ textAlign: 'center', padding: '22px 0' }}>
                      （暂无任务，在上方回填第一条）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <CliHints module="sessiontask" />
    </>
  );
}
