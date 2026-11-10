// MD 面板同构入口：对外口径（import 面）不变——实现按职责拆到
//   md-render.js  渲染器（markdown → HTML、标题锚点、目录抽取）
//   md-blocks.js  块模型（split/join、空块编码、附件片段插入）
// 本文件只留「任务语义」部分：标题/文件名、出厂模板、进度卡映射，以及
// frontmatter 三件套的同构再导出。
//
// 任务 frontmatter（工作组语义）**共用模块内同一份实现**：CLI（node）与面板（浏览器）
// 各写一套正则，必然出现「面板认得出、CLI 认不出」这种最难查的分叉。
import { parseFrontmatter, stripFrontmatter, withFrontmatter } from '../../../../shared/frontmatter.js';
export { parseFrontmatter, stripFrontmatter, withFrontmatter };

export { headingAnchorId, extractMdHeadings, renderMarkdownHtml } from './md-render.js';
export {
  EMPTY_BLOCK,
  stripPhantomEmptyLines,
  isEmptyBlock,
  normalizeBlockText,
  stripTitleHeading,
  splitMdBlocks,
  joinMdBlocks,
  liveBodyBlocks,
  isFrontmatterBlock,
  frontmatterEndOffset,
  insertAttachmentSnippet,
} from './md-blocks.js';

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

// 与后端出厂文本（core/db/seed-templates.js 的 BUILTIN_BODY） / BUILTIN_VALUES 同构。
// 出厂骨架是**文字**（任务 #87：「直接文字就是模板」——不再用 {{槽位名}} 骨架）。
// 老模板（库里还留着 {{背景}} 这类标记）仍按 NEW_TEMPLATE_VALUES 渲染后再进任务正文——
// **禁止**把标记原样塞进任务正文（验收反馈：用户不知何意）。
export const NEW_TEMPLATE = `## 背景

（一句话说清要改什么）

## 验收
- [ ] …

## 约束
- …

## 附件
`;

/** 内置槽位默认值（与后端出厂值（core/db/seed-templates.js 的 BUILTIN_VALUES）同构） */
export const NEW_TEMPLATE_VALUES = {
  背景: '（一句话说清要改什么）',
  验收: '…',
  约束: '…',
  附件: '',
};

/**
 * 把 localtask 状态映射到并发进程卡。
 *
 * 三种状态（与用户口径一致）：**待领取 / 执行中 / 已完成回填**。曾经还有一套
 * 「接收 → 解析 → 执行 → 验证 → 回填」的五段流水线（阶段芯片 + 按阶段序号算的
 * 假百分比），那是推断出来的、不是真实进度——面板上让人莫名其妙，已删掉（任务 #60）。
 *
 * 两条容易搞错的判据：
 *   - 「已领取」看 `status === 'claimed' / 'done'`（或有领取时刻），**不看 `t.from`**——
 *     `from` 是**来源标记**（云端迁入才有 'cloud'），拿它判领取会让本地已领的
 *     任务显示成「待领取」、云端迁入还没人领的显示成「执行中」。
 *   - 时间起点是**领取时刻**（consumedAt）：在队列里排了多久不算「跑了多久」；
 *     还没被领取的没有起点，不计时；已完成回填的按口径不实现时间计算。
 */
export function taskToProgress(t) {
  const text = t.text || '';
  const title = titleFromMd(text, String(t.id));
  // claimed / done 都算「已经被领走过」：done 是 claimed 之后的下一个状态，
  // 它的 consumedAt 一定在（卡片要按领取时刻计时）。
  const claimed = t.status === 'claimed' || t.status === 'done' || !!t.consumedAt;
  const receivedAt = claimed ? String(t.consumedAt || '') : '';
  if (t.deletedAt) {
    return { id: t.id, title, status: 'done', detail: '已删除', receivedAt };
  }
  if (t.migratedTo) {
    return { id: t.id, title, status: 'done', detail: `已迁移 → ${t.migratedTo}`, receivedAt };
  }
  if (t.completedAt) {
    // 已完成的回填：done 总结落在 roundSummary；不再计时（finishedAt 不给）。
    return {
      id: t.id,
      title,
      status: 'done',
      detail: t.roundSummary ? String(t.roundSummary).slice(0, 48) : '已回填',
      receivedAt,
    };
  }
  if (claimed) {
    // 已领取、未回填 = 执行中：计时从领取时刻起。
    return {
      id: t.id,
      title,
      status: 'run',
      detail: '执行中 / 待回填',
      receivedAt,
    };
  }
  // 待领取：没有起点（不计时）。
  return {
    id: t.id,
    title,
    status: 'wait',
    detail: '待领取',
    receivedAt: '',
  };
}
