// Markdown 渲染器（原型落地）：标题 / 列表 / 引用 / 代码 / 图片 / fenced code / 双链。
// 不引入 marked 等依赖，面板包体保持轻量。
//
// 双链 [[目标|显示文本]] 与 shared/wikilink.js 同一套正则与归一（后端解析、这里渲染，
// 收在同构层防两端漂移）。knownNames 是双链索引里的名字/路径集合（docs/index），
// 不在其中 → 未解析态（虚线红）；不传 knownNames → 全部按已解析渲染（模板预览等场景）。
import { normalizeWikiTarget } from '../../../../shared/wikilink.js';
import { looksLikeFileId } from '../../../../shared/attach.js';
import { stripFrontmatter } from '../../../../shared/frontmatter.js';
import type { Attachment } from '../../components/md/attach-common.js';

/** 一个可跳转的标题（extractMdHeadings 的产出）。 */
export interface MdHeading {
  level: number;
  text: string;
  id: string;
}

/** 标题锚点 id：同文多同名自动 -2/-3… */
export function headingAnchorId(text: string, used?: Set<string> | null): string {
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
export function extractMdHeadings(src: string | null | undefined): MdHeading[] {
  const out: MdHeading[] = [];
  const used = new Set<string>();
  let inCode = false;
  for (const line of String(src || '').split('\n')) {
    if (line.startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (!m) continue;
    const text = (m[2] ?? '').trim();
    out.push({ level: (m[1] ?? '').length, text, id: headingAnchorId(text, used) });
  }
  return out;
}

// HTML 转义表（键集合与下面 esc 的正则一一对应）
const ESC_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c] ?? c);
}

// 双链目标是否在索引里：完整路径（剥 .md）或文件名（末段）命中都算已解析
function wikiKnown(target: string, knownNames: Set<string>): boolean {
  const norm = normalizeWikiTarget(target);
  if (!norm) return true;
  const leaf = norm.split('/').pop() ?? '';
  return knownNames.has(norm) || knownNames.has(leaf);
}

/**
 * ref 链接的显示名（#168）：优先**文档标题**（refId → title 的映射，来自附件
 * 清单——服务端读盘补的正文首行 # 标题），没有映射才用链接原文。
 */
function refTitleOf(target: string, text: string, refTitles: Map<string, string>): string {
  if (!refTitles || !refTitles.size) return text;
  const m = String(target || '').match(/^nxkv:\/\/ref\/([^)\s]+)$/i);
  if (!m) return text;
  const t = refTitles.get(m[1] ?? '');
  return t ? esc(t) : text;
}

function inline(s: string, knownNames: Set<string> | null, refTitles: Map<string, string>): string {
  const base = esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 图床附件嵌入（2026-11-03 任务 #8）：图片 `![说明](fileId)`、文件 `[名字](fileId)`。
  // fileId 判定与 shared/attach 同一套（looksLikeFileId）——普通 URL / 相对路径
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
  // 内部资源链接（attachments 表里的 task / ref）：保持可点，但明确标成内部资源，
  // 不让它落到「普通 markdown 链接」而被当外链。
  const withInternal = withAtt.replace(/\[([^\]]+)\]\((nxkv:\/\/[^)\s]+)\)/g, (m, text, target) => {
    if (!/^nxkv:\/\/(?:task|ref)\//i.test(target)) return m;
    // #168：ref 引用显示**文档标题**（用户在文档里填的那行 # 标题），没有标题才用原文
    const label = refTitleOf(target, text, refTitles);
    return `<a class="md-wl" data-nxkv="${target}" title="内部资源：${target}">${label}</a>`;
  });
  return withInternal.replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, target, label) => {
    const t = target.trim();
    const text = (label || target).trim();
    const miss = knownNames && !wikiKnown(t, knownNames);
    return `<a class="md-wl${miss ? ' md-wl-miss' : ''}" data-wl="${esc(t)}" title="${miss ? '未解析：' : '双链：'}${esc(t)}">${esc(text)}</a>`;
  });
}

/**
 * @param src
 * @param attachments 附件清单（图片按名字内嵌、ref 条目提供标题映射）
 * @param knownNames 双链已解析名集合（normalizeWikiTarget 口径，含 rel/path 与文件名）
 */
export function renderMarkdownHtml(
  src: string,
  attachments: Attachment[] = [],
  knownNames: Set<string> | null = null,
): string {
  const imgMap: Record<string, string> = {};
  // ref 标题映射（#168）：附件清单里 kind=ref 的条目 → refId → 文档标题，
  // 渲染 ref 链接时用标题当显示名（用户填了标题，编辑器里就该看到标题）。
  const refTitles = new Map<string, string>();
  for (const a of attachments) {
    if (!a) continue;
    if (a.type === 'image' && a.url) imgMap[a.name ?? ''] = a.url;
    if (a.kind === 'ref') {
      const id = String(a.refId || a.targetKey || a.targetRef || '');
      const title = String(a.docTitle || a.title || a.name || '');
      if (id && title) refTitles.set(id, title);
    }
  }
  // frontmatter **不再渲染成属性卡**（#113）：board/project 这些是投递元数据，
  // 摆在一堆任务正文上方纯属噪音——正文里剥掉即可（编辑态仍能点开原 YAML 看）。
  const lines = stripFrontmatter(src).split('\n');
  let html = '';
  let inUl = false;
  let inCode = false;
  const usedIds = new Set<string>();
  const flush = () => {
    if (inUl) {
      html += '</ul>';
      inUl = false;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
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
      const target = (img[2] ?? '').trim();
      // 整行图片嵌入走图床时（![说明](fileId)）直接用面板内容端点直出——
      // 不依赖 attachments 列表（localStorage 时代的 name→dataURL 映射）。
      if (looksLikeFileId(target)) {
        html += `<p><img class="md-att-img" src="/api/file/content/${target}" alt="${esc(img[1])}"></p>`;
        continue;
      }
      const raw = imgMap[img[2] ?? ''] || img[2] || '';
      const safe = /^(data:|blob:|https?:|#)/.test(raw) ? raw : '';
      html += safe
        ? `<p><img src="${safe}" alt="${esc(img[1])}"></p>`
        : `<p><code>![${esc(img[1])}](${esc(img[2])})</code></p>`;
      continue;
    }
    // 引用 / callout（#144）：连续的 `>` 行合成**一个块**——callout 块必须整体渲染。
    // 首行带 `[!TYPE] 标题` 标记（GFM/Obsidian 口径）→ 渲染成醒目色块；
    // 无标记 → 普通 blockquote（多行合并，锚定引用不再拆成 N 个散框）。
    if (line.startsWith('>')) {
      flush();
      const q: string[] = [];
      let j = i;
      while (j < lines.length && (lines[j] ?? '').startsWith('>')) {
        q.push((lines[j] ?? '').replace(/^>[ \t]?/, ''));
        j += 1;
      }
      i = j - 1; // 外层循环再 ++，回到最后一条被消费的引用行
      const firstQ = q[0];
      const cm = firstQ ? firstQ.match(/^\[!([A-Za-z][\w-]*)\][ \t]*(.*)$/) : null;
      if (cm) {
        // callout：正文按空行分段（段间 <br><br> 有段落间隔）、段内 <br> 连行
        // （反馈以短行为主，够用且轻）
        const type = String(cm[1] || '').toLowerCase();
        const title = String(cm[2] || '').trim();
        const paras: string[][] = [];
        let curPara: string[] = [];
        for (const l of q.slice(1)) {
          if (!l.trim()) {
            if (curPara.length) {
              paras.push(curPara);
              curPara = [];
            }
            continue;
          }
          curPara.push(l);
        }
        if (curPara.length) paras.push(curPara);
        const bodyHtml = paras
          .map((p) => p.map((l) => inline(l, knownNames, refTitles)).join('<br>'))
          .join('<br><br>');
        html += `<div class="md-callout md-callout-${esc(type)}">`
          + (title ? `<div class="md-callout-t">${inline(title, knownNames, refTitles)}</div>` : '')
          + `<div class="md-callout-b">${bodyHtml}</div></div>`;
        continue;
      }
      html += `<blockquote>${q.map((l) => inline(l, knownNames, refTitles)).join('<br>')}</blockquote>`;
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      {
        const text = line.slice(4);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h3 id="${esc(id)}">${inline(text, knownNames, refTitles)}</h3>`;
      }
      continue;
    }
    if (line.startsWith('## ')) {
      flush();
      {
        const text = line.slice(3);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h2 id="${esc(id)}">${inline(text, knownNames, refTitles)}</h2>`;
      }
      continue;
    }
    if (line.startsWith('# ')) {
      flush();
      {
        const text = line.slice(2);
        const id = headingAnchorId(text.trim(), usedIds);
        html += `<h1 id="${esc(id)}">${inline(text, knownNames, refTitles)}</h1>`;
      }
      continue;
    }
    const m = line.match(/^-\s+(\[[ xX]\])?\s*(.*)$/);
    if (m) {
      if (!inUl) {
        html += '<ul>';
        inUl = true;
      }
      const box = m[1];
      const done = !!box && /x/i.test(box);
      const body = m[2] ?? '';
      if (box) {
        const mark = done ? '☑' : '☐';
        html += `<li class="${done ? 'done' : 'todo'}"><span class="mdw-cb" aria-hidden="true">${mark}</span>${inline(body, knownNames, refTitles)}</li>`;
      } else {
        html += `<li>${inline(body, knownNames, refTitles)}</li>`;
      }
      continue;
    }
    flush();
    if (!line.trim()) continue;
    html += `<p>${inline(line, knownNames, refTitles)}</p>`;
  }
  if (inCode) html += '</code></pre>';
  flush();
  // 文件附件 chip 只作**兜底**：列正文里没有内联引用的那些（#118——内联
  // `[名](fileId)` 已渲染成 a.md-att，整表再拼一份就是重复；且实时面板是逐块
  // 调本函数的，整表下发会让每个块都拖一份 chip 出来）。v1 老数据的文件附件
  // 没有内联表示，仍靠它可见。
  //
  // #183：**只兜底真文件**。ref / task / url 三类是「绑定」，归属在附件区
  // （role=attach|doc），正文里从来没有它们的占位符——此前它们也进了这个
  // filter，于是每个块底部都挂一条同名 chip（文档页里一句话后面跟一条
  // 「设计笔记」，看着像正文被污染），且「块编辑器与 ref 不同步」。
  const isFileAttachment = (a: Attachment | null | undefined): boolean =>
    !!a && a.type !== 'image' && a.kind !== 'ref' && a.kind !== 'task' && a.kind !== 'url';
  const files = attachments.filter((a) => isFileAttachment(a) && !html.includes(String(a.id)));
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
