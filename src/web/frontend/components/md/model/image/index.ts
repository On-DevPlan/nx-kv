// 整行图片语法：`![说明](目标)` 独占一行 → 段落包裹的图片。
//
// 目标命中 fileId（图床附件）→ 走面板内容端点直出；否则按附件清单的 name→url
// 映射兜底（v1 老数据）；都不命中 → 降级成行内代码，原样可见。
import type { BlockMatch, BlockRule } from '../types.js';
import { looksLikeFileId } from '../../../../../../shared/attach.js';

const IMG_RE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/;

export const imageSyntax: BlockRule = {
  id: 'image',
  priority: 18,
  match(lines, i, ctx): BlockMatch | null {
    const m = IMG_RE.exec(lines[i] ?? '');
    if (!m) return null;
    const alt = m[1] ?? '';
    const target = (m[2] ?? '').trim();
    if (looksLikeFileId(target)) {
      return {
        html: `<p><img class="md-att-img" src="/api/file/content/${target}" alt="${ctx.esc(alt)}"></p>`,
        next: i + 1,
      };
    }
    const raw = ctx.imgMap[m[2] ?? ''] || m[2] || '';
    const safe = /^(data:|blob:|https?:|#)/.test(raw) ? raw : '';
    const html = safe
      ? `<p><img src="${safe}" alt="${ctx.esc(alt)}"></p>`
      : `<p><code>![${ctx.esc(alt)}](${ctx.esc(m[2] ?? '')})</code></p>`;
    return { html, next: i + 1 };
  },
};
