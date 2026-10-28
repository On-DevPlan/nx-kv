// Markdown 极简解析（原型落地）：标题 / 列表 / 引用 / 代码 / 图片。
// 不引入 marked 等依赖，面板包体保持轻量。

export function titleFromMd(body, fallback = '未命名任务') {
  const lines = String(body || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
    if (line.trim()) return line.trim().slice(0, 48);
  }
  return fallback;
}

export function slugName(title) {
  const base = (title || 'untitled').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48);
  return base.endsWith('.md') ? base : `${base}.md`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/**
 * @param {string} src
 * @param {{name:string,url?:string,type?:string,size?:string}[]} [attachments]
 */
export function renderMarkdownHtml(src, attachments = []) {
  const imgMap = {};
  for (const a of attachments) {
    if (a.type === 'image' && a.url) imgMap[a.name] = a.url;
  }
  const lines = String(src || '').split('\n');
  let html = '';
  let inUl = false;
  const flush = () => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
  };
  for (const line of lines) {
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      flush();
      const raw = imgMap[img[2]] || img[2];
      const safe = /^(data:|blob:|https?:|#)/.test(raw) ? raw : '';
      html += safe
        ? `<p><img src="${safe}" alt="${esc(img[1])}"></p>`
        : `<p><code>![${esc(img[1])}](${esc(img[2])})</code></p>`;
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      html += `<blockquote>${inline(line.slice(2))}</blockquote>`;
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      html += `<h2>${inline(line.slice(3))}</h2>`;
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      html += `<h1>${inline(line.slice(2))}</h1>`;
      continue;
    }
    const m = line.match(/^-\s+(\[[ xX]\])?\s*(.*)$/);
    if (m) {
      if (!inUl) {
        html += '<ul>';
        inUl = true;
      }
      const done = m[1] && /x/i.test(m[1]);
      if (m[1]) {
        const mark = done ? '☑' : '☐';
        html += `<li class="${done ? 'done' : 'todo'}"><span class="mdw-cb" aria-hidden="true">${mark}</span>${inline(m[2])}</li>`;
      } else {
        html += `<li>${inline(m[2])}</li>`;
      }
      continue;
    }
    flush();
    if (!line.trim()) continue;
    html += `<p>${inline(line)}</p>`;
  }
  flush();
  const files = attachments.filter((a) => a.type !== 'image');
  if (files.length) {
    html += files
      .map(
        (a) =>
          `<div class="mdw-attach-chip">${esc(a.name)}<span class="sz">${esc(a.size || '')}</span></div>`
      )
      .join('');
  }
  return html || '<p class="mdw-empty">（空文档）</p>';
}

export const NEW_TEMPLATE = `## 背景

（一句话说清要改什么）

## 验收
- [ ] …

## 约束
- …

## 附件
`;

/** 把 MD 切成块（空行 / 标题起新块），供一体化实时预览就地编辑 */
export function splitMdBlocks(src) {
  const lines = String(src ?? '').split('\n');
  const blocks = [];
  let cur = [];
  const flush = () => {
    while (cur.length && cur[cur.length - 1] === '') cur.pop();
    if (cur.length) blocks.push(cur.join('\n'));
    cur = [];
  };
  for (const line of lines) {
    if (!line.trim() && cur.length) {
      flush();
      continue;
    }
    if (/^#{1,3}\s/.test(line) && cur.length) flush();
    cur.push(line);
  }
  flush();
  return blocks.length ? blocks : [''];
}

export function joinMdBlocks(blocks) {
  return (blocks || []).map((b) => String(b ?? '').replace(/\s+$/g, '')).join('\n\n');
}

export const STAGE_LABELS = ['接收', '解析', '执行', '验证', '回填'];

/** 把 localtask 状态映射到并发进程卡 */
export function taskToProgress(t) {
  const text = t.text || '';
  const title = titleFromMd(text, String(t.id));
  if (t.deletedAt) {
    return { id: t.id, title, status: 'done', pct: 100, stageIdx: 4, detail: '已删除', receivedAt: t.createdAt };
  }
  if (t.migratedTo) {
    return { id: t.id, title, status: 'done', pct: 100, stageIdx: 4, detail: `已迁移 → ${t.migratedTo}`, receivedAt: t.createdAt };
  }
  if (t.status === 'consumed') {
    return {
      id: t.id,
      title,
      status: 'done',
      pct: 100,
      stageIdx: 4,
      detail: t.roundSummary ? String(t.roundSummary).slice(0, 48) : '已回填',
      receivedAt: t.createdAt,
      finishedAt: t.updatedAt || t.createdAt,
    };
  }
  // pending / 进行中：有 waiting 语境时偏 wait，否则 run
  const waiting = !!t.from; // agent 领取后通常带 from；未领取纯 pending
  if (waiting) {
    return {
      id: t.id,
      title,
      status: 'run',
      pct: 55,
      stageIdx: 2,
      detail: '执行中 / 待回填',
      receivedAt: t.createdAt,
    };
  }
  return {
    id: t.id,
    title,
    status: 'wait',
    pct: 12,
    stageIdx: 0,
    detail: '待领取',
    receivedAt: t.createdAt,
  };
}
