// MD 面板同构入口：对外口径（import 面）不变——实现按职责拆到
//   md-render.js  渲染器（markdown → HTML、标题锚点、目录抽取）
//   md-blocks.js  块模型（split/join、空块编码、附件片段插入）
// 本文件只留「任务语义」部分：标题/文件名、出厂模板、进度卡映射，以及
// frontmatter 三件套的同构再导出。
//
// 任务 frontmatter（工作组语义）**共用模块内同一份实现**：CLI（node）与面板（浏览器）
// 各写一套正则，必然出现「面板认得出、CLI 认不出」这种最难查的分叉。
import type { LocalTask } from '../../types.js';
import { parseFrontmatter, stripFrontmatter } from '../../../../shared/frontmatter.js';
export { parseFrontmatter, stripFrontmatter };

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

export function titleFromMd(body: string, fallback = '未命名任务'): string {
  const lines = stripFrontmatter(body).split('\n');
  for (const line of lines) {
    const m = line.match(/^#\s+(.+)$/);
    if (m) return (m[1] ?? '').trim();
    if (line.trim()) return line.trim().slice(0, 48);
  }
  return fallback;
}

export function slugName(title?: string | null): string {
  const base = (title || 'untitled').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48);
  return base.endsWith('.md') ? base : `${base}.md`;
}

// #137：这里曾经有一份「新建任务骨架」的出厂文本（NEW_TEMPLATE / NEW_TEMPLATE_VALUES），
// 与后端 seed 的出厂骨架同构。现在**只有一份内置**：新建任务模板「ref 生成」
// （后端 core/db/seed-templates.js 的 NEWTASK_REF_BODY）——前端不再自带第二份副本，
// 否则两处出厂文本迟早漂移。面板没有可用模板时从空稿开始（用户自己写问题）。

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
/** 并发进程卡的展示形状（taskToProgress 的出站契约；进程面板再加定位字段）。 */
export interface ProgressCard {
  id: number;
  title: string;
  status: string;
  detail: string;
  receivedAt: string;
  [k: string]: any;
}

export function taskToProgress(t: LocalTask): ProgressCard {
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
