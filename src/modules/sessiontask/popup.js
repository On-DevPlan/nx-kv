// 阻塞 wait 时由内嵌服务器直出的独立弹窗页面（不依赖 vite 构建，npx 也能开）。
//
// 注意：本文件返回的是一整段 HTML 字符串，内联 <script> 刻意只用单/双引号与
// 字符串拼接（不用模板字符串、不用 ${}），以免与外层模板串冲突；内联脚本里
// 出现的反斜杠在此外层模板中需双写（如换行正则写成 /\\n/g）。
import { basename } from 'node:path';

export function renderPopupPage({ key, cwd, summary, timeoutMs }) {
  const name = (cwd && basename(cwd)) || '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>nx-kv · 实时任务</title>
<style>
  :root {
    --ink: #14161a;
    --paper: #fff;
    --soft: #f5f6f7;
    --soft-2: #ebedf0;
    --mid: #8b9096;
    --radius: 12px;
    --radius-sm: 8px;
    --shadow: 0 1px 2px rgba(20,22,26,.06), 0 6px 16px rgba(20,22,26,.05);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 13.5px; line-height: 1.55;
    color: var(--ink); background: #fbfbfc;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 880px; margin: 0 auto; padding: 20px 18px 32px; }
  .top { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
  .brand { font-weight: 800; letter-spacing: .3px; }
  .brand .sub { font-weight: 400; color: var(--mid); margin-left: 8px; }
  .meta { margin-left: auto; color: var(--mid); font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
  .meta .pill { background: var(--soft-2); border-radius: 5px; padding: 1px 7px; color: var(--ink); }

  .topic {
    background: var(--paper); border-radius: var(--radius); box-shadow: var(--shadow);
    padding: 10px 14px; margin-bottom: 10px;
  }
  .topic .topic-label { font-size: 11px; color: var(--mid); letter-spacing: 1px; margin-bottom: 3px; }
  .topic .topic-name { font-size: 14px; font-weight: 800; }
  .topic .topic-cwd { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; color: var(--mid); word-break: break-all; margin-top: 2px; }

  .state {
    background: var(--paper); border-radius: var(--radius); box-shadow: var(--shadow);
    border-left: 3px solid var(--ink); padding: 11px 14px; margin-bottom: 12px;
  }
  .state .state-label { font-size: 11px; color: var(--mid); letter-spacing: 1px; margin-bottom: 3px; }
  .state .state-text { font-size: 15px; font-weight: 700; white-space: pre-wrap; }

  .statusbar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    background: var(--paper); border-radius: var(--radius); box-shadow: var(--shadow);
    padding: 10px 14px; margin-bottom: 12px;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ink); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
  #clock { font-family: ui-monospace, Consolas, monospace; font-weight: 700; }
  .statusbar .hint { color: var(--mid); font-size: 11.5px; }

  .composer { background: var(--paper); border-radius: var(--radius); box-shadow: var(--shadow); padding: 12px 14px; margin-bottom: 12px; transition: opacity .2s; }
  textarea {
    width: 100%; min-height: 76px; resize: vertical;
    font: inherit; color: var(--ink); background: var(--paper);
    border: 1px solid var(--soft-2); border-radius: var(--radius-sm);
    padding: 9px 11px; transition: border-color .15s, box-shadow .15s;
  }
  textarea::placeholder { color: #b3b8bd; }
  textarea:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 3px rgba(20,22,26,.07); }
  .composer .row { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
  .composer .hint { color: var(--mid); font-size: 11.5px; margin-left: auto; }

  .btn { font: inherit; cursor: pointer; padding: 6px 14px; border: 0; border-radius: var(--radius-sm); background: var(--ink); color: var(--paper); transition: opacity .15s; }
  .btn:hover { opacity: .86; }
  .btn.ghost { background: var(--soft); color: var(--ink); }
  .btn.ghost:hover { background: var(--soft-2); opacity: 1; }
  .btn.small { padding: 3px 9px; font-size: 12px; border-radius: 7px; }

  .banner { display: none; border-radius: var(--radius-sm); padding: 9px 13px; margin-bottom: 12px; font-size: 12.5px; }
  .banner.show { display: block; }
  .banner.good { background: var(--soft); color: var(--ink); }
  .banner.bad { background: #f3e3e2; color: #b3261e; }

  .card { background: var(--paper); border-radius: var(--radius); box-shadow: var(--shadow); padding: 6px 12px 10px; }
  .colhead { display: flex; align-items: baseline; gap: 8px; margin: 8px 2px; }
  h3 { font-size: 13px; margin: 0; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 10px; vertical-align: top; }
  th { color: var(--mid); font-weight: 600; font-size: 11.5px; }
  tbody tr:hover { background: var(--soft); }
  tbody tr + tr td { box-shadow: inset 0 1px 0 var(--soft); }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }
  .round-sum { margin-top: 5px; padding-top: 5px; border-top: 1px dashed var(--soft-2); color: var(--mid); font-size: 11px; white-space: pre-wrap; }
  td.text { min-width: 200px; }
  td.time { white-space: nowrap; color: var(--mid); }
  td.ops { white-space: nowrap; }
  .muted { color: var(--mid); }
  td.empty { text-align: center; padding: 22px 10px; }
  .tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--mid); white-space: nowrap; }
  .tag.strong { background: var(--ink); color: var(--paper); }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div class="brand">nx-kv<span class="sub">实时任务输入</span></div>
    <div class="meta"><span class="pill">回填后立即返回 agent</span></div>
  </div>

  <div class="topic">
    <div class="topic-label">主题（工作目录）</div>
    <div class="topic-name" id="topicName"></div>
    <div class="topic-cwd" id="topicCwd"></div>
  </div>

  <div class="state">
    <div class="state-label">当前现状</div>
    <div class="state-text" id="summary"></div>
  </div>

  <div class="statusbar" id="statusbar">
    <span class="dot"></span>
    <span>agent 正在等待你针对上述现状回填 · 剩余</span>
    <span id="clock">--:--</span>
    <span class="hint">超时未回填则本轮自动结束</span>
  </div>

  <div class="composer" id="composer">
    <textarea id="input" autofocus spellcheck="false"
      placeholder="输入要交给 agent 的下一条任务（Enter 提交，Shift+Enter 换行）"></textarea>
    <div class="row">
      <button class="btn" id="submit">回填任务</button>
      <span class="hint">Enter 提交 · Shift+Enter 换行</span>
    </div>
  </div>

  <div class="banner" id="banner"></div>

  <div class="card">
    <div class="colhead"><h3>本主题的任务队列</h3><span class="muted" id="count"></span></div>
    <table>
      <thead><tr><th style="width:54px">#</th><th>任务</th><th style="width:78px">状态</th><th style="width:150px">时间</th><th style="width:70px">操作</th></tr></thead>
      <tbody id="list"></tbody>
    </table>
  </div>
</div>

<script>
  var KEY = ${JSON.stringify(key)};
  var CWD = ${JSON.stringify(cwd || '')};
  var TOPIC_NAME = ${JSON.stringify(name || '')};
  var SUMMARY = ${JSON.stringify(summary)};
  var TIMEOUT_MS = ${JSON.stringify(timeoutMs)};
  var delivered = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  el('topicName').textContent = TOPIC_NAME || '（未命名）';
  el('topicCwd').textContent = CWD || '（旧数据，无目录）';
  el('summary').textContent = SUMMARY;
  var deadline = Date.now() + TIMEOUT_MS;
  function tickClock() {
    if (delivered) return;
    var left = deadline - Date.now();
    el('clock').textContent = fmtClock(left);
    if (left <= 0 && !delivered) showBanner('等待已结束（超时未回填），本窗口可关闭。', true);
  }
  setInterval(tickClock, 250);
  tickClock();

  function showBanner(msg, bad) {
    var b = el('banner');
    b.textContent = msg;
    b.className = 'banner show ' + (bad ? 'bad' : 'good');
  }

  function render(topic) {
    el('count').textContent = '待领取 ' + topic.pending + ' · 共 ' + topic.tasks.length;
    var tasks = topic.tasks.slice().reverse();
    var rows = '';
    if (!tasks.length) {
      rows = '<tr><td colspan="5" class="muted empty">（暂无任务，在上方回填第一条）</td></tr>';
    }
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var status = t.status === 'consumed'
        ? '<span class="tag strong">已领取</span>'
        : '<span class="tag">待领取</span>';
      var body = esc(t.text).replace(/\\n/g, '<br>');
      if (t.roundSummary) {
        body += '<div class="round-sum" title="该任务所回应的 agent 上一轮完成总结">上一轮完成：' +
          esc(t.roundSummary).replace(/\\n/g, '<br>') + '<\/div>';
      }
      rows += '<tr><td class="mono">#' + t.id + '</td><td class="text">' + body + '<\/td><td>' + status +
        '</td><td class="mono time">' + esc(t.consumedAt || t.createdAt || '') +
        '</td><td class="ops"><button class="btn small ghost" data-id="' + t.id + '">删除</button></td></tr>';
    }
    el('list').innerHTML = rows;
  }

  function refresh() {
    if (delivered) return;
    fetch('/api/sessiontasks', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        var topic = null;
        for (var i = 0; i < j.data.topics.length; i++) {
          if (j.data.topics[i].key === KEY) { topic = j.data.topics[i]; break; }
        }
        if (topic) render(topic);
      })
      .catch(function () { /* 交付后服务器关闭，静默 */ });
  }

  function submit() {
    var input = el('input');
    var text = input.value.trim();
    if (!text) { input.focus(); return; }
    fetch('/api/sessiontasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { showBanner(j.error || '提交失败', true); return; }
        input.value = '';
        input.focus();
        if (j.data.delivered) {
          delivered = true;
          showBanner('已回填给 agent，正在返回，本窗口可关闭。', false);
          el('composer').style.opacity = '0.5';
          // agent 已领取：不再显示倒计时（倒计时只在「等待回填」时有意义）
          el('statusbar').style.display = 'none';
          refresh();
        } else {
          showBanner('已排入主题队列，agent 下一次 wait 会取走。', false);
          refresh();
        }
      })
      .catch(function (e) { showBanner('提交失败：' + e, true); });
  }

  el('submit').addEventListener('click', submit);
  el('input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  el('list').addEventListener('click', function (e) {
    var b = e.target;
    if (b && b.dataset && b.dataset.id) {
      fetch('/api/sessiontasks/item', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(b.dataset.id) })
      })
        .then(function (r) { return r.json(); })
        .then(function () { refresh(); });
    }
  });

  refresh();
  setInterval(function () { if (!delivered) refresh(); }, 1000);
</script>
</body>
</html>
`;
}
