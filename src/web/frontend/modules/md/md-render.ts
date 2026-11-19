// Markdown 渲染器（编排层）：按**语法注册表**跑四个阶段，不认识任何具体语法。
//
// 架构（任务 #239 重构 / #243 补语法）：具体语法住在 components/md/model/<syntax>/，
// 各导出一条规则；本文件只负责「取数据 + 建上下文 + 按表执行 + 拼 HTML」。
// 新增语法 = 加一个 model 目录 + 在 registry 注册一次。
//
// 四个阶段（见 registry 的表）：
//   1. DOC_RULES       抽走定义行（脚注 / 引用式链接），登记查表
//   2. INLINE_PRE_RULES 改原始文本（转义、脚注标记、引用式链接展开）
//   3. BLOCK_RULES     逐行块级匹配；未命中的连续行合成**一个**段落
//   4. INLINE_RULES    作用在已转义 HTML 上（强调 / 高亮 / 公式 / 尖括号链接）
//
// 不引入 marked 等依赖，面板包体保持轻量（零第三方 markdown/数学库）。
// 双链 [[目标|显示]] 与 shared/wikilink.js 同一套正则与归一（收在同构层防两端漂移）。
import { normalizeWikiTarget } from '../../../../shared/wikilink.js';
import { looksLikeFileId } from '../../../../shared/attach.js';
import { stripFrontmatter } from '../../../../shared/frontmatter.js';
import type { Attachment } from '../../components/md/attach-common.js';
import {
  BLOCK_RULES,
  DOC_RULES,
  INLINE_PRE_RULES,
  INLINE_RULES,
} from '../../components/md/model/registry.js';
import { paragraphHtml } from '../../components/md/model/paragraph/index.js';
import { restoreEscapes } from '../../components/md/model/escape/index.js';
import { restoreFootnotes } from '../../components/md/model/footnote/index.js';
import type { BlockCtx, DocCtx, InlineEnv } from '../../components/md/model/types.js';

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
 *
 * 渲染支持 h1–h6（见 model/heading），但**目录只收 1–3**：长文里 4 级以下会淹没
 * 导航，这是目录的取舍，不是渲染能力的限制。
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

/**
 * 外链锚点（#142）：`http(s)` 一律**新标签打开**，带 noopener。
 */
function externalAnchor(href: string, label: string): string {
  return `<a class="md-link" href="${href}" target="_blank" rel="noopener noreferrer" title="${href}">${label}</a>`;
}

// 裸 URL 的边界：遇空白 / 引号 / 尖括号 / 中英文标点 / 右括号即止。
const BARE_URL_RE = /https?:\/\/[^\s<>"'`，。；：！？、）)】\]]+/g;
const URL_TAIL = /[.,;:!?]+$/;

/** 把一段**纯文本**（已 HTML 转义）里的裸 URL 变成可点链接。 */
function linkifyText(text: string): string {
  return text.replace(BARE_URL_RE, (raw) => {
    const href = raw.replace(URL_TAIL, '');
    if (!href) return raw;
    const tail = raw.slice(href.length);
    return externalAnchor(href, href) + tail;
  });
}

/**
 * 只处理**文本节点**的自动链接（#142）——按标签切分，跳过标签本身与
 * `<a>` / `<code>` 内部。
 */
function autolinkHtml(html: string): string {
  const parts = html.split(/(<[^>]*>)/);
  const out: string[] = [];
  let skip = 0; // >0 = 在 <a> / <code> 内部，文本不处理
  for (const p of parts) {
    if (p.startsWith('<')) {
      const tag = /^<(\/?)\s*([a-zA-Z][\w-]*)/.exec(p);
      const name = (tag && tag[2] ? tag[2] : '').toLowerCase();
      if (name === 'a' || name === 'code') {
        if (tag && tag[1] === '/') skip = Math.max(0, skip - 1);
        else if (!p.endsWith('/>')) skip += 1;
      }
      out.push(p);
      continue;
    }
    out.push(skip > 0 ? p : linkifyText(p));
  }
  return out.join('');
}

/**
 * 行内渲染：预处理（转义/脚注/引用式链接）→ 转义 → 代码/粗体 →
 * 附件/内部链接/外链/双链 → 语法规则（强调/高亮/公式/尖括号链接）→ 自动链接。
 */
function inline(
  s: string,
  knownNames: Set<string> | null,
  refTitles: Map<string, string>,
  env: InlineEnv,
): string {
  const pre = INLINE_PRE_RULES.reduce((acc, rule) => rule(acc, env), s);
  const base = esc(pre)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
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
  const withInternal = withAtt.replace(/\[([^\]]+)\]\((nxkv:\/\/[^)\s]+)\)/g, (m, text, target) => {
    if (!/^nxkv:\/\/(?:task|ref)\//i.test(target)) return m;
    const label = refTitleOf(target, text, refTitles);
    return `<a class="md-wl" data-nxkv="${target}" title="内部资源：${target}">${label}</a>`;
  });
  const withExternal = withInternal.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (_m, text: string, href: string) => externalAnchor(href, text),
  );
  const withWiki = withExternal.replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, target, label) => {
    const t = target.trim();
    const text = (label || target).trim();
    const miss = knownNames && !wikiKnown(t, knownNames);
    return `<a class="md-wl${miss ? ' md-wl-miss' : ''}" data-wl="${esc(t)}" title="${miss ? '未解析：' : '双链：'}${esc(t)}">${esc(text)}</a>`;
  });
  // 语法规则（强调 / 高亮 / 行内公式 / 尖括号链接）作用在链接与代码已就位的 HTML 上
  const withSyntax = INLINE_RULES.reduce((acc, rule) => rule(acc), withWiki);
  // 最后一遍：剩下的**裸 URL** 也变成可点链接（#142）；再还原 `\x` 转义的字面字符
  return restoreEscapes(autolinkHtml(withSyntax), esc);
}

/**
 * 逐行块级渲染；**未命中任何规则的连续行合成一个段落**（行间 `<br>`）。
 *
 * 段落合并修的是「每行一个 <p>」的老毛病：块模型里同一块的多行是用户在一个块内
 * 打的换行，渲染成多个独立段落会让段间距突然变大。
 */
function renderBlocks(lines: string[], ctx: BlockCtx): string {
  let html = '';
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) {
      html += paragraphHtml(para, ctx);
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      flush();
      continue;
    }
    let matched = false;
    for (const rule of BLOCK_RULES) {
      const hit = rule.match(lines, i, ctx);
      if (!hit) continue;
      flush();
      html += hit.html;
      // 规则必须前进（next > i）；写错时兜底 +1，避免死循环
      i = Math.max(hit.next, i + 1) - 1;
      matched = true;
      break;
    }
    if (!matched) para.push(line);
  }
  flush();
  return html;
}

/**
 * @param src
 * @param attachments 附件清单（图片按名字内嵌、ref 条目提供标题映射）
 * @param knownNames 双链已解析名集合（normalizeWikiTarget 口径，含 path 与文件名）
 */
export function renderMarkdownHtml(
  src: string,
  attachments: Attachment[] = [],
  knownNames: Set<string> | null = null,
): string {
  const imgMap: Record<string, string> = {};
  // ref 标题映射（#168）：附件清单里 kind=ref 的条目 → refId → 文档标题。
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
  const doc: DocCtx = { footnotes: new Map(), refLinks: new Map(), esc };
  // 1) 定义行先抽走（脚注正文、引用式链接目标），剩下的正文才逐行渲染
  const lines = DOC_RULES.reduce(
    (acc, rule) => rule.collect(acc, doc),
    stripFrontmatter(src).split('\n'),
  );
  const env: InlineEnv = { footnotes: doc.footnotes, refLinks: doc.refLinks };
  const usedIds = new Set<string>();
  const inlineFn = (t: string): string => inline(t, knownNames, refTitles, env);
  const ctx: BlockCtx = {
    block: (ls) => renderBlocks(ls, ctx),
    doc,
    inline: inlineFn,
    esc,
    headingId: (t, used) => headingAnchorId(t, used),
    imgMap,
    usedIds,
  };

  let html = renderBlocks(lines, ctx);

  // 文件附件 chip 只作兜底（#118 / #183）：正文未内联引用的真文件才挂。
  const isFileAttachment = (a: Attachment | null | undefined): boolean =>
    !!a && a.type !== 'image' && a.kind !== 'ref' && a.kind !== 'task' && a.kind !== 'url';
  const files = attachments.filter((a) => isFileAttachment(a) && !html.includes(String(a.id)));
  if (files.length) {
    html += files
      .map(
        (a) =>
          `<div class="mdw-attach-chip">${esc(a.name)}<span class="sz">${esc(a.size || '')}</span></div>`,
      )
      .join('');
  }
  // 2) 脚注：引用点上标 + 文末列表（没有脚注时原样返回）
  html = restoreFootnotes(html, doc, inlineFn);
  return html || '<p class="mdw-empty">（空文档）</p>';
}
