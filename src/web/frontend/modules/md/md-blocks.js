// MD 块模型：正文 ↔ 块数组的双向变换（实时预览的落盘形态），以及附件片段插入。
// 纯函数、零 DOM——单测直接跑，组件层只管把结果回填到受控值。
//
// 空块编码是这里的核心不变量：空块在正文里用 ZWSP 独占一行占位（join/split 可往返），
// 编辑态按空串处理；纯空白块（用户敲的空格是内容）用 ZWSP+空白 落盘，防止被当成
// 块分隔符（markdown 语义：空行 = 段落分隔）。
import { parseFrontmatter } from '../../../../shared/frontmatter.js';

/** 空块占位（ZWSP）：join/split 可往返，渲染与编辑按空串处理 */
export const EMPTY_BLOCK = '\u200b';

/**
 * 剥掉正文里的**幻影空块**（ZWSP 独占行），收敛剥落后留下的连续空行。
 *
 * 为什么要在落库边界做（2026-11-07 #92「每次打开多一段空白」）：块编辑器把
 * 「空块」编码成 ZWSP 行落盘——编辑会话里它是回车后的工作状态（占住光标）；
 * 但落库正文里它只会渲染成一块莫名空白——markdown 语义里空行是分隔符，
 * **不能是「一段空白」**。保存/同步时剥掉：编辑器内不受影响，下次打开不再
 * 出现幻影块；已有脏数据在下次保存时自愈。
 *
 * 纯空白块（ZWSP+空格，#21 保空格）**不是**幻影——用户敲的空格是内容，保留。
 */
export function stripPhantomEmptyLines(src) {
  const text = String(src ?? '');
  if (!text.includes(EMPTY_BLOCK)) return text;
  const lines = text.split('\n').filter((l) => l !== EMPTY_BLOCK);
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

export function isEmptyBlock(b) {
  const s = String(b ?? '').replace(/\u200b/g, '').trim();
  return !s;
}

/**
 * 块的**编辑态原文**：只剥 ZWSP（空块标记），**不动空白**。
 *
 * 为什么不能把「纯空白块」折成空串（2026-11-03 任务 #21「无法输入空格」）：
 * 用户在空块里敲的空格会**当场消失**——敲进去 → 折成 '' → textarea 被重置成空
 * → 空格永远打不出来。空白是用户输入的一部分，编辑态必须原样留着。
 *
 * 「这块看起来是空的」是**渲染层**的判断，交给 isEmptyBlock（它按 trim 判）。
 */
export function normalizeBlockText(b) {
  return String(b ?? '').replace(/\u200b/g, '');
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
    // 折叠成 '' 的旧做法会把「纯空白块」的内容抹掉（敲进去的空格就没了）——
    // 编辑态原文一律保留，空白块靠 ZWSP 打头在正文里占位（见 joinMdBlocks）。
    blocks.push(normalizeBlockText(text));
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

/**
 * 块数组 → 正文（实时预览的落盘形态）。
 *
 * **尾随空格必须保留**（2026-11-03 任务 #21「无法输入空格」的根因）：
 * 实时预览里每个空格都是**打在行尾**的，而旧实现对每个块做 `/\s+$/` 去尾随
 * 空白——于是「块 → 正文 → 块」往返一趟，刚敲下的那个空格就被吃掉了：
 * 空格永远打不出来（行中打字能进去，正是因为它不在行尾）。
 */
export function joinMdBlocks(blocks) {
  return (blocks || [])
    .map((b) => {
      const s = normalizeBlockText(b).replace(/[\r\n]+$/g, '');
      if (!s) return EMPTY_BLOCK; // 空块 → ZWSP 占位
      if (!s.trim()) return EMPTY_BLOCK + s; // 纯空白块 → ZWSP 打头，空白留住
      return s; // 其余原样（尾随空格也留着）
    })
    .join('\n\n');
}

/** 实时预览用的正文块：剥掉首个 H1（标题栏单独管），frontmatter 仍保留。 */
export function liveBodyBlocks(body) {
  const blocks = splitMdBlocks(body);
  const i = blocks.findIndex((b) => /^# (?!#)/.test(String(b).trim()));
  return i < 0 ? blocks : blocks.filter((_, k) => k !== i);
}

/** 块是否是文档头部 frontmatter（`---`…`---` 且含 key: value）。 */
export function isFrontmatterBlock(text) {
  return Object.keys(parseFrontmatter(String(text ?? ''))).length > 0;
}

/**
 * 正文头部 frontmatter 结束后的字符偏移；没有有效 frontmatter → 0。
 * 贴图/嵌入禁止落在 FM 内部——插进去会在保存时被 stripFrontmatter 剥掉，
 * 并可能把 `board:` 撕成残留键（用户案例：`d: b_…`）。
 */
export function frontmatterEndOffset(src) {
  const text = String(src ?? '');
  if (!Object.keys(parseFrontmatter(text)).length) return 0;
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? m[0].length : 0;
}

function recomposeLiveBody(liveBlocks, titleBlock) {
  if (!titleBlock) return joinMdBlocks(liveBlocks);
  const out = [];
  let start = 0;
  if (liveBlocks[0] && isFrontmatterBlock(liveBlocks[0])) {
    out.push(liveBlocks[0]);
    start = 1;
  }
  out.push(titleBlock);
  out.push(...liveBlocks.slice(start));
  return joinMdBlocks(out);
}

/**
 * 把附件 markdown 片段插进正文（图片 `![…](fileId)` / 文件 `[…](fileId)`）。
 *
 * 两条坐标：
 *   - `mode:'edit'` + `insertAt`：源码编辑器的**全文**光标偏移；
 *   - `mode:'live'` + `focusIndex`/`caretInBlock`：实时预览的**块内**坐标
 *     （与 liveBodyBlocks 同空间——切勿把块内偏移当全文偏移，那会插进 FM）。
 *
 * 落点落在 frontmatter 内时改插到 FM 闭合之后（或下一内容块开头）。
 *
 * @returns {{ body: string, insertAt: number }} insertAt = 片段起始偏移（便于重设光标）
 */
export function insertAttachmentSnippet(body, snippet, opts = {}) {
  const snip = String(snippet || '');
  const src = String(body || '');
  if (!snip) return { body: src, insertAt: src.length };

  if (opts.mode === 'live') {
    const all = splitMdBlocks(src);
    const titleIdx = all.findIndex((b) => /^# (?!#)/.test(String(b).trim()));
    const title = titleIdx >= 0 ? all[titleIdx] : null;
    const live = liveBodyBlocks(src);
    let fi = opts.focusIndex;

    if (fi == null || fi < 0 || !live.length) {
      const trimmed = snip.replace(/^\n+/, '').replace(/\n+$/, '');
      live.push(trimmed);
      const next = recomposeLiveBody(live, title);
      return { body: next, insertAt: Math.max(0, next.length - trimmed.length) };
    }

    fi = Math.min(fi, live.length - 1);
    if (isFrontmatterBlock(live[fi])) {
      const content = snip.replace(/^\n+/, '').replace(/\n+$/, '');
      if (fi + 1 < live.length) {
        live[fi + 1] = content + (live[fi + 1] ? `\n${live[fi + 1]}` : '');
      } else {
        live.push(content);
      }
      const next = recomposeLiveBody(live, title);
      return { body: next, insertAt: frontmatterEndOffset(next) };
    }

    const block = live[fi] || '';
    const caret = opts.caretInBlock;
    const at = caret == null ? block.length : Math.min(Math.max(0, caret), block.length);
    live[fi] = block.slice(0, at) + snip + block.slice(at);
    const next = recomposeLiveBody(live, title);
    // 近似：FM(+标题)之后再累加此前块；够用在编辑器重设光标
    const prefixBlocks = [];
    if (title && live[0] && isFrontmatterBlock(live[0])) {
      prefixBlocks.push(live[0], title, ...live.slice(1, fi));
    } else if (title) {
      prefixBlocks.push(title, ...live.slice(0, fi));
    } else {
      prefixBlocks.push(...live.slice(0, fi));
    }
    const prefix = prefixBlocks.length ? `${joinMdBlocks(prefixBlocks)}\n\n` : '';
    return { body: next, insertAt: prefix.length + at };
  }

  let at = opts.insertAt;
  if (at == null || at < 0) {
    return { body: src + snip, insertAt: src.length };
  }
  at = Math.min(Math.max(0, at), src.length);
  const fmEnd = frontmatterEndOffset(src);
  if (at < fmEnd) at = fmEnd;
  return { body: src.slice(0, at) + snip + src.slice(at), insertAt: at };
}
