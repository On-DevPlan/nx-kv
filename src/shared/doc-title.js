// 文档标题口径（#168）：**标题 = 正文第一行的 `# 标题`**，其余一律不算。
//
// 为什么不用「首个 # 行」或「首个非空行」：
//   · 首个 # 行 —— 正文中间插一行 # 就会改标题（标题不该被正文结构牵动）；
//   · 首个非空行 —— 正文第一行是普通文字时，标题被**正文首行顶替**（#168 bug 2：
//     「正文第一行会影响标题」）。标题是文档自己的字段，只有首行 # 才作数。
//
// 纯函数、无依赖：前后端共用（前端文档页取标题 / 后端读盘给 ref 标注标题）。
// 任务标题另有口径（titleFromMd：首个非空行也可以），两者刻意不合并。

/** 去 frontmatter 后的正文首行（trim 后）。没有正文行 → ''。 */
function firstLineOf(body) {
  const text = String(body ?? '');
  // 去掉 frontmatter（--- … ---），标题只看正文部分
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?/);
  const rest = m ? s.slice(m[0].length) : s;
  for (const line of rest.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

/**
 * 文档标题：正文**首行**是 `# 标题` 时取其文字，否则空串（调用方决定回落）。
 * @param {string} body 文档正文
 * @returns {string}
 */
export function docTitleFromMd(body) {
  const first = firstLineOf(body);
  const m = first.match(/^#\s+(.+)$/);
  return m ? m[1].trim() : '';
}

/**
 * 文档正文是否以 `# 标题` 开头（编辑标题时用来判断「改首行」还是「补首行」）。
 * @param {string} body
 * @returns {boolean}
 */
export function hasDocTitleLine(body) {
  return !!docTitleFromMd(body);
}

/**
 * 改写文档正文的标题行：首行是 # 标题就替换它，否则在文首补一行。
 * 返回新正文（不改动原字符串）。
 * @param {string} body
 * @param {string} title 新标题（空 → 用「未命名文档」）
 * @returns {string}
 */
export function setDocTitleInMd(body, title) {
  const text = String(body ?? '');
  const t = String(title || '').trim() || '未命名文档';
  const s = text.replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = m ? s.slice(0, m[0].length) : '';
  const rest = m ? s.slice(m[0].length) : s;
  const lines = rest.split('\n');
  // 找到第一个非空行
  const idx = lines.findIndex((l) => l.trim());
  if (idx < 0) {
    return `${front}# ${t}\n`;
  }
  if (/^#\s+/.test(lines[idx].trim())) {
    lines[idx] = `# ${t}`;
  } else {
    lines.splice(idx, 0, `# ${t}`);
  }
  return `${front}${lines.join('\n')}`;
}
