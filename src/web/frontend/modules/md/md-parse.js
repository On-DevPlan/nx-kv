// Markdown 极简解析（原型落地）：标题 / 列表 / 引用 / 代码 / 图片 / fenced code / 双链。
// 不引入 marked 等依赖，面板包体保持轻量。
//
// 双链 [[目标|显示文本]] 与 core/wikilink.js 同一套正则与归一（后端解析、这里渲染，
// 收在 core 防两端漂移）。knownNames 是双链索引里的名字/路径集合（docs/index），
// 不在其中 → 未解析态（虚线红）；不传 knownNames → 全部按已解析渲染（模板预览等场景）。
import { normalizeWikiTarget } from '../../../../modules/docs/wikilink.js';
import { looksLikeFileId } from '../../../../modules/todo/attach.js';
// 任务 frontmatter（工作组语义）**共用模块内同一份实现**：CLI（node）与面板（浏览器）
// 各写一套正则，必然出现「面板认得出、CLI 认不出」这种最难查的分叉。
import { parseFrontmatter, stripFrontmatter, withFrontmatter } from '../../../../modules/localtask/frontmatter.js';
export { parseFrontmatter, stripFrontmatter, withFrontmatter };

export function titleFromMd(body, fallback = '未命名任务') {
  const lines = stripFrontmatter(body).split('\n');
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

/** 标题锚点 id：同文多同名自动 -2/-3… */
export function headingAnchorId(text, used) {
  const base = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .slice(0, 48) || 'h';
  let id = base;
  let n = 2;
  while (used && used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  if (used) used.add(id);
  return id;
}

/**
 * 从 markdown 抽 h1–h3（跳过 fenced code），供右侧滚动目录。
 * @returns {{ level:number, text:string, id:string }[]}
 */
export function extractMdHeadings(src) {
  const out = [];
  const used = new Set();
  let inCode = false;
  for (const line of String(src || '').split('\n')) {
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (!m) continue;
    const text = m[2].trim();
    out.push({ level: m[1].length, text, id: headingAnchorId(text, used) });
  }
  return out;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * frontmatter → **属性卡** HTML（无 frontmatter 返回空串）。
 *
 * 为什么要单独渲染：任务头部的 frontmatter（board/project/介绍引用）是结构化字段，
 * 此前在实时预览里被无声吞掉、在编辑态里与首行内容并进同一个块——用户看到的是
 * 「frontmatter 合并在第一行中」。现在它永远是独立的可视单元：键值卡片。
 */
export function frontmatterHtml(src) {
  const fm = parseFrontmatter(src);
  const keys = Object.keys(fm);
  if (!keys.length) return '';
  const rows = keys
    .map((k) => `<div class="mdw-fm-row"><span class="mdw-fm-k">${esc(k)}</span><span class="mdw-fm-v">${esc(fm[k])}</span></div>`)
    .join('');
  return `<div class="mdw-fm">${rows}</div>`;
}

// 双链目标是否在索引里：完整路径（剥 .md）或文件名（末段）命中都算已解析
function wikiKnown(target, knownNames) {
  const norm = normalizeWikiTarget(target);
  if (!norm) return true;
  return knownNames.has(norm) || knownNames.has(norm.split('/').pop());
}

function inline(s, knownNames) {
  const base = esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 图床附件嵌入（2026-11-03 任务 #8）：图片 `![说明](fileId)`、文件 `[名字](fileId)`。
  // fileId 判定与 modules/todo/attach.js 同一套（looksLikeFileId）——普通 URL / 相对路径
  // 原样保留，不误伤普通 markdown 链接。base 已 esc，捕获组直接用，不再二次转义。
  const withAtt = base
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, target) => {
      const t = String(target ?? '').trim();
      if (!looksLikeFileId(t)) return m;
      return `<img class="md-att-img" src="/api/file/content/${t}" alt="${alt}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, target) => {
      const t = String(target ?? '').trim();
      if (!looksLikeFileId(t)) return m;
      return `<a class="md-att" href="/api/file/content/${t}" download="${text}" title="附件：${text}">${text}</a>`;
    });
  return withAtt.replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, target, label) => {
    const t = target.trim();
    const text = (label || target).trim();
    const miss = knownNames && !wikiKnown(t, knownNames);
    return `<a class="md-wl${miss ? ' md-wl-miss' : ''}" data-wl="${esc(t)}" title="${miss ? '未解析：' : '双链：'}${esc(t)}">${esc(text)}</a>`;
  });
}

/**
 * @param {string} src
 * @param {{name:string,url?:string,type?:string,size?:string}[]} [attachments]
 * @param {Set<string>} [knownNames] 双链已解析名集合（normalizeWikiTarget 口径，含 rel/path 与文件名）
 */
export function renderMarkdownHtml(src, attachments = [], knownNames = null) {
  const imgMap = {};
  for (const a of attachments) {
    if (a.type === 'image' && a.url) imgMap[a.name] = a.url;
  }
  // frontmatter 属性卡置顶（键值见 frontmatterHtml；无 frontmatter 时为空串）
  const fmCard = frontmatterHtml(src);
  const lines = stripFrontmatter(src).split('\n');
  let html = fmCard;
  let inUl = false;
  let inCode = false;
  const usedIds = new Set();
  const flush = () => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
  };
  for (const line of lines) {
    // fenced code：整块原样输出（不跑 inline/双链——代码里的 [[示例]] 不是链接）
    if (line.startsWith('```')) {
      if (inCode) {
        html += '</code></pre>';
        inCode = false;
      } else {
        flush();
        html += '<pre class="mdw-code"><code>';
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      html += `${esc(line)}\n`;
      continue;
    }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      flush();
      const target = img[2].trim();
      // 整行图片嵌入走图床时（![说明](fileId)）直接用面板内容端点直出——
      // 不依赖 attachments 列表（localStorage 时代的 name→dataURL 映射）。
      if (looksLikeFileId(target)) {
        html += `<p><img class="md-att-img" src="/api/file/content/${target}" alt="${esc(img[1])}"></p>`;
        continue;
      }
      const raw = imgMap[img[2]] || img[2];
      const safe = /^(data:|blob:|https?:|#)/.test(raw) ? raw : '';
      html += safe
        ? `<p><img src="${safe}" alt="${esc(img[1])}"></p>`
        : `<p><code>![${esc(img[1])}](${esc(img[2])})</code></p>`;
      continue;
    }
    if (line.startsWith('> ')) {
      flush();
      html += `<blockquote>${inline(line.slice(2), knownNames)}</blockquote>`;
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      {
        const text = line.slice(4);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h3 id="${esc(id)}">${inline(text, knownNames)}</h3>`;
      }
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      {
        const text = line.slice(3);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h2 id="${esc(id)}">${inline(text, knownNames)}</h2>`;
      }
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      {
        const text = line.slice(2);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h1 id="${esc(id)}">${inline(text, knownNames)}</h1>`;
      }
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
        html += `<li class="${done ? 'done' : 'todo'}"><span class="mdw-cb" aria-hidden="true">${mark}</span>${inline(m[2], knownNames)}</li>`;
      } else {
        html += `<li>${inline(m[2], knownNames)}</li>`;
      }
      continue;
    }
    flush();
    if (!line.trim()) continue;
    html += `<p>${inline(line, knownNames)}</p>`;
  }
  if (inCode) html += '</code></pre>';
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

/** 空块占位（ZWSP）：join/split 可往返，渲染与编辑按空串处理 */
export const EMPTY_BLOCK = '\u200b';

export function isEmptyBlock(b) {
  const s = String(b ?? '').replace(/\u200b/g, '').trim();
  return !s;
}

export function normalizeBlockText(b) {
  const s = String(b ?? '');
  if (isEmptyBlock(s)) return '';
  return s.replace(/\u200b/g, '');
}

/**
 * 去掉正文里的**首个一级标题行**——那是文档标题，由标题栏单独编辑与渲染，
 * 正文（实时预览块 / 阅读视图）不再重复渲染它。
 *
 * 为什么要专门做：标题既出现在面板头部的标题栏，又出现在正文第一行，
 * 两侧都渲染等于**标题显示两遍**（阅读视图里尤其明显）。
 * 只剥**首个** H1：正文里的第二个 H1 是正经内容，仍要作为块渲染。
 */
export function stripTitleHeading(src) {
  const text = String(src ?? '');
  const m = text.match(/^[ \t]*# (?!#)(.*)$/m);
  if (!m) return text;
  const start = m.index;
  const end = start + m[0].length;
  return (text.slice(0, start) + text.slice(end)).replace(/^\n+/, '');
}

/** 把 MD 切成块（frontmatter / 空行 / 标题起新块），供一体化实时预览就地编辑 */
export function splitMdBlocks(src) {
  const raw = String(src ?? '');
  if (!raw) return [''];
  const lines = raw.split('\n');
  const blocks = [];
  let cur = [];
  const flushCur = () => {
    while (cur.length && cur[cur.length - 1] === '') cur.pop();
    if (!cur.length) return;
    const text = cur.join('\n');
    blocks.push(isEmptyBlock(text) ? '' : normalizeBlockText(text));
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ZWSP 独占一行 = 显式空块（回车换行往返）
    if (line === EMPTY_BLOCK) {
      if (cur.length) flushCur();
      blocks.push('');
      continue;
    }
    // 普通空行只分隔块，不制造空块
    if (!line.trim()) {
      if (cur.length) flushCur();
      continue;
    }
    // **文档头部的 frontmatter 自成一块**（只在第一个块位置认）：不加这条，
    // 「---\nboard: …\n---\n①目标：…」之间没有空行，FM 会和首行内容并进同一个
    // 块——编辑态里 frontmatter 糊在第一行上。没有闭合 `---` 的是普通分割线，
    // 仍按普通文本处理。正文后部的 `---` 是 thematic break，不在此列。
    if (!blocks.length && !cur.length && line.trim() === '---') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '---') j += 1;
      if (j < lines.length) {
        const fmText = lines.slice(i, j + 1).join('\n');
        blocks.push(isEmptyBlock(fmText) ? '' : normalizeBlockText(fmText));
        i = j;
        continue;
      }
    }
    // 标题**自成一块**（markdown/Obsidian 语义）：标题行后紧跟的正文、列表都是
    // 独立块，不并进标题。此前只「遇到标题才开新块」，标题后的行仍留在标题块里——
    // 于是「# 标题\n正文」渲染成一个标题（标题与正文融合），点正文也整块进编辑态。
    const isHeading = /^#{1,3}\s/.test(line);
    if (isHeading && cur.length) flushCur();
    cur.push(line);
    if (isHeading) flushCur();
  }
  if (cur.length) flushCur();
  return blocks.length ? blocks : [''];
}

export function joinMdBlocks(blocks) {
  return (blocks || [])
    .map((b) => {
      const s = normalizeBlockText(b).replace(/\s+$/g, '');
      return s === '' ? EMPTY_BLOCK : s;
    })
    .join('\n\n');
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
