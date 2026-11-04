// 任务正文里的「类 markdown 附件嵌入」——解析与生成的**唯一实现**。
//
// 纯函数、零依赖（不 import node: 也不 import 任何 core/）：Node 侧的 service.js
// 与浏览器侧的 view/markdown 共用**同一份**，避免两端各写一套正则 —— 一处改了
// 另一处没改，就会得到「面板认得出、CLI 认不出」这种最难查的分叉。
//
// 语法就是标准 markdown，不发明新方言：
//   图片  ![说明](fileId)
//   其他  [文件名](fileId)
// 其中 fileId 是后端图床的不透明 id：32 位 hex，原文件名带后缀时后端会接上
// `.<ext>`（如 `3f2a…9c.docx`），所以还要接受可选扩展名。
//
// 判定刻意收窄：URL（含 ://）、以 `/` 开头的站点路径、以 `.` 开头的相对路径
// 一律按**普通 markdown** 原样保留、不做改写 —— 否则任务里写一条普通链接
// 就会被当成附件（然后预览 404、同步时白跑一趟网络）。

const FILE_ID_RE = /^[0-9a-fA-F]{16,}(\.[A-Za-z0-9]{1,8})?$/;

/** 这个 token 像不像后端返回的附件 id（而不是 URL / 相对路径）。 */
export function looksLikeFileId(token) {
  return FILE_ID_RE.test(String(token ?? '').trim());
}

// 一次扫出 `!?[文字](目标)`：`!` 前缀决定是图片还是普通链接。
// 用单条正则而不是「先扫图片再扫链接」——后者会让 ![...] 里的 [...] 被重复匹配。
const COMBINED_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * 把正文切成「纯文本 / 嵌入」片段，供渲染用。
 * 不是嵌入的 markdown 原样留在 text 片段里（渲染端不做 markdown，只做嵌入）。
 */
export function parseEmbeds(text) {
  const src = String(text ?? '');
  if (!src) return [];
  const out = [];
  let last = 0;
  let m;
  COMBINED_RE.lastIndex = 0;
  while ((m = COMBINED_RE.exec(src)) !== null) {
    const target = m[3];
    if (!looksLikeFileId(target)) continue;
    if (m.index > last) out.push({ type: 'text', value: src.slice(last, m.index) });
    out.push({
      type: m[1] === '!' ? 'image' : 'file',
      alt: m[2],
      id: target.trim(),
      raw: m[0],
    });
    last = m.index + m[0].length;
  }
  if (!out.length) return [{ type: 'text', value: src }];
  if (last < src.length) out.push({ type: 'text', value: src.slice(last) });
  return out;
}

/** 正文引用的全部附件 id（去重、保序）。 */
export function attachmentIds(text) {
  const seen = new Set();
  const out = [];
  for (const seg of parseEmbeds(text)) {
    if (seg.type === 'text' || seen.has(seg.id)) continue;
    seen.add(seg.id);
    out.push(seg.id);
  }
  return out;
}

/**
 * 正文引用的附件（去重，同一 id 取**首次出现**的说明文字）——
 * 说明文字会被当作本地文件名，所以第一次写下的那个名字最有信息量。
 */
export function attachmentRefs(text) {
  const seen = new Map();
  for (const seg of parseEmbeds(text)) {
    if (seg.type === 'text' || seen.has(seg.id)) continue;
    seen.set(seg.id, { id: seg.id, kind: seg.type, alt: seg.alt || '' });
  }
  return [...seen.values()];
}

/** 生成嵌入语法。kind === 'image' 用图片语法，否则用链接语法。 */
export function embedMarkdown({ name, id, kind = 'file' } = {}) {
  const label = String(name || id || '').replace(/[[\]]/g, '');
  if (!id) return '';
  return kind === 'image' ? `![${label}](${id})` : `[${label}](${id})`;
}

/** 去掉嵌入，只留纯文字 —— 用于列表摘要等不需要贴图的场合。 */
export function stripEmbeds(text) {
  return parseEmbeds(text)
    .filter((s) => s.type === 'text')
    .map((s) => s.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
