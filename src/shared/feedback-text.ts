// 评论 / 反馈回写的正文拼装原语 —— 服务端与面板共用同一份（#79）。
//
// 为什么要有这一份：段名（## 反馈修改 / ## 验收反馈 / ## 上一轮完成总结）、
// 锚定引用格式（> 锚定：）、逐行加粗口径，此前只在面板 modules/board/reopen-text
// 有一份；服务端要把反馈**追加**到盘上正文（#79：面板会话 doc 可能过期，拿旧正文
// 拼回去就是「评论一次丢一次」），两处各写一套，段名与格式迟早分叉——收口到这里。
//
// 纯函数、零依赖：node 单测直接 import，vite 打包进前端，服务端 src/modules 共用。

/** 上轮 ack 完成总结段标题 */
export const ACK_SUMMARY_HEADING = '## 上一轮完成总结';
/** 验收反馈段标题（ack 场景：已完成任务的重做） */
export const FEEDBACK_HEADING = '## 验收反馈';
/** 普通反馈段标题（非 ack 场景：任务没完成时的「反馈修改」） */
export const PLAIN_FEEDBACK_HEADING = '## 反馈修改';

/**
 * 反馈逐行加粗（用户口径：重开的任务要携带着反馈文字在正文中，最好加粗）。
 * 空行不加粗（`**` 会渲染成一行空的粗体）。
 */
export function boldFeedback(text: unknown): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => (line.trim() ? `**${line}**` : line))
    .join('\n');
}

/** 划选原文 → 锚定引用块（面板与服务端共用一种格式）；空选区返回空串 */
export function quoteBlock(quote: unknown): string {
  const q = String(quote ?? '').trim();
  if (!q) return '';
  return `> 锚定：\n> ${q.replace(/\n/g, '\n> ')}`;
}

/** feedbackSection / appendFeedback 的公共入参。 */
export interface FeedbackSectionOpts {
  heading?: string;
  quote?: string;
  feedback?: string;
  bold?: boolean;
}

/**
 * 反馈段：段名 +（可选）锚定引用 + 反馈正文（bold 时逐行加粗）。
 * 反馈与选区都空 → 返回空串（调用方据此不追加）。
 */
export function feedbackSection({ heading, quote, feedback, bold = false }: FeedbackSectionOpts = {}): string {
  const fb = String(feedback ?? '').trim();
  if (!fb) return '';
  const body = bold ? boldFeedback(fb) : fb;
  const anchor = quoteBlock(quote);
  return `${String(heading ?? PLAIN_FEEDBACK_HEADING)}\n\n${anchor ? `${anchor}\n\n` : ''}${body}`;
}

/**
 * 把反馈段**追加**到一份完整正文末尾（#79 服务端评论回写的拼装口径）：
 * 第一个区块永远是完整的之前的任务，接着才是引用字符和评论。
 * base 空 → 只返回反馈段；反馈段空 → base 原样返回（带收尾换行规整）。
 */
export function appendFeedback({ base, heading, quote, feedback, bold = false }: FeedbackSectionOpts & { base?: string } = {}): string {
  const b = String(base ?? '').trimEnd();
  const sec = feedbackSection({ heading, quote, feedback, bold });
  if (b && !sec) return `${b}\n`;
  if (!b && !sec) return '';
  return `${b ? `${b}\n\n` : ''}${sec}\n`;
}

// ─── 轮次 callout（#144 反馈功能优化）────────────────────────────────
//
// 旧段名「## 上一轮完成总结」在多轮正文里说不清是**哪**一轮（每对段都叫上一轮）；
// 改成带轮次号的 callout 块（#144：层级一眼看清）：
//
//   > [!NOTE] 第 1 轮 · 完成总结
//   > ack 内容……
//
//   > [!WARNING] 第 1 轮 · 验收反馈
//   > **反馈内容……**
//
// 面板 md 渲染器（modules/md/md-parse）认 `[!TYPE]` 标记渲染成醒目色块；
// 纯文本（CLI / agent 读正文）也自然可读。旧段名的历史正文仍被 ack-nodes /
// 渲染器认得——只增不改，老任务页不受影响。

/** 完成总结 callout 类型 */
export const ACK_CALLOUT_TYPE = 'NOTE';
/** 验收反馈 callout 类型 */
export const FEEDBACK_CALLOUT_TYPE = 'WARNING';

// ─── 语义判据统一（#混用治理）─────────────────────────────────────────
//
// 此前重排 / 定位轨 / 去重都靠**标题文本**（完成总结 / 验收反馈）判定语义，
// callout 的 `[!NOTE]` / `[!WARNING]` 只是给渲染器看的装饰。于是「琥珀色警告
// 块在结构上被当成上轮总结」这类分叉无人能拦。现在收口到一处：
//   类型为主判据（NOTE=完成总结 / WARNING=验收反馈），标题文本只在类型不认识
//   时回退（兼容自定义类型与历史手工正文）。视觉色块与结构语义由同一常量决定。

/** 一轮 callout 的语义角色：summary=上轮完成总结 / feedback=验收反馈 */
export type CalloutRole = 'summary' | 'feedback';

/** callout 首行的解析结果 */
export interface CalloutHead {
  /** 类型标记（大写归一，如 NOTE / WARNING / TIP） */
  type: string;
  /** 类型标记后的标题文本 */
  title: string;
  /** 标题里的「第 N 轮」，没有为 0 */
  round: number;
}

const ROUND_NUM_RE = /第\s*(\d+)\s*轮/;
const CALLOUT_HEAD_RE = /^>\s*\[!([A-Za-z][\w-]*)\][ \t]*(.*)$/;
const SUMMARY_TITLE_RE = /完成总结/;
const FEEDBACK_TITLE_RE = /反馈/;

const ROLE_OF_TYPE: Record<string, CalloutRole> = {
  [ACK_CALLOUT_TYPE.toUpperCase()]: 'summary',
  [FEEDBACK_CALLOUT_TYPE.toUpperCase()]: 'feedback',
};

/** 解析 callout 首行 → { type, title, round }；不是 callout 返回 null */
export function parseCalloutHead(line: unknown): CalloutHead | null {
  const m = String(line ?? '').match(CALLOUT_HEAD_RE);
  if (!m) return null;
  const title = String(m[2] ?? '').trim();
  const r = title.match(ROUND_NUM_RE);
  return {
    type: String(m[1] ?? '').toUpperCase(),
    title,
    round: r ? (Number(r[1]) || 0) : 0,
  };
}

function roleOfTitle(title: string): CalloutRole | null {
  if (SUMMARY_TITLE_RE.test(title)) return 'summary';
  if (FEEDBACK_TITLE_RE.test(title)) return 'feedback';
  return null;
}

/** 语义角色：类型为主判据，标题文本为回退（类型不认识时才看标题） */
export function calloutRoleOf(head: CalloutHead | null | undefined): CalloutRole | null {
  if (!head) return null;
  return ROLE_OF_TYPE[head.type] ?? roleOfTitle(head.title);
}

/**
 * 类型与标题语义是否冲突（守卫用）：正常正文恒为 false。
 * 冲突时 calloutRoleOf 以类型为准——渲染色块与结构语义保持一致，
 * 不会被「写着 WARNING 却是完成总结」这类正文悄悄带偏。
 */
export function calloutTypeTitleConflict(head: CalloutHead | null | undefined): boolean {
  if (!head) return false;
  const byType = ROLE_OF_TYPE[head.type];
  const byTitle = roleOfTitle(head.title);
  return !!byType && !!byTitle && byType !== byTitle;
}

/** ack callout 标题：`第 N 轮 · 完成总结` */
export function ackCalloutTitle(round: unknown): string {
  return `第 ${Number(round) || 1} 轮 · 完成总结`;
}

/** 反馈 callout 标题：`第 N 轮 · 验收反馈` */
export function feedbackCalloutTitle(round: unknown): string {
  return `第 ${Number(round) || 1} 轮 · 验收反馈`;
}

/** 多行内容 → callout 逐行（`> ` 前缀；空行给裸 `>` 保持块连续） */
function calloutBody(text: unknown): string {
  return String(text ?? '')
    .split('\n')
    .map((l) => (l.trim() ? `> ${l}` : '>'))
    .join('\n');
}

/** 完成总结 callout 块；ack 空 → 空串 */
export function ackCalloutSection({ round, ack }: { round?: number; ack?: string } = {}): string {
  const a = String(ack ?? '').trim();
  if (!a) return '';
  return `> [!${ACK_CALLOUT_TYPE}] ${ackCalloutTitle(round)}\n${calloutBody(a)}`;
}

/** 验收反馈 callout 块（锚定引用并进同一块）；反馈空 → 空串 */
export function feedbackCalloutSection({ round, quote, feedback, bold = false }: { round?: number; quote?: string; feedback?: string; bold?: boolean } = {}): string {
  const fb = String(feedback ?? '').trim();
  if (!fb) return '';
  const body = bold ? boldFeedback(fb) : fb;
  const anchor = quoteBlock(quote);
  const inner = anchor ? `${anchor.replace(/^> ?/gm, '')}\n\n${body}` : body;
  return `> [!${FEEDBACK_CALLOUT_TYPE}] ${feedbackCalloutTitle(round)}\n${calloutBody(inner)}`;
}

/** 正文里已有多少轮 ack：旧段名各算一轮；callout 以类型判角色，标题带轮次号时取最大号（防手工删段后编号回退） */
export function countAckRounds(base: unknown): number {
  const text = String(base ?? '');
  let n = 0;
  let max = 0;
  const legacy = text.match(/^## 上一轮完成总结\s*$/gm);
  n += legacy ? legacy.length : 0;
  for (const line of text.split('\n')) {
    const head = parseCalloutHead(line);
    if (!head || calloutRoleOf(head) !== 'summary') continue;
    n += 1;
    if (head.round) max = Math.max(max, head.round);
  }
  return Math.max(n, max);
}

/** 下一轮的轮次号：已有轮数 + 1 */
export function nextRoundOf(base: unknown): number {
  return countAckRounds(base) + 1;
}

/** 正文里是否已有同一份 ack 总结（旧段名与 callout 两种形态都认）——防连点两次重复追加 */
export function bodyHasAck(base: unknown, ack: unknown): boolean {
  const b = String(base ?? '');
  const a = String(ack ?? '').trim();
  if (!a || !b) return false;
  if (b.includes(`${ACK_SUMMARY_HEADING}\n\n${a}`)) return true;
  const lines = b.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const head = parseCalloutHead(lines[i] ?? '');
    if (!head || calloutRoleOf(head) !== 'summary') continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length && (lines[j] ?? '').startsWith('>'); j++) {
      body.push((lines[j] ?? '').replace(/^>[ \t]?/, ''));
    }
    if (body.join('\n').trim() === a) return true;
  }
  return false;
}

/**
 * ack 场景的整段追加（#144 的拼装口径）：base + 本轮完成总结 callout + 验收反馈 callout。
 * ack 已在正文里（bodyHasAck）不重复追加；轮次号缺省按正文已有轮数 + 1。
 * base 与 ack、反馈全空 → 空串；只有 base → base 原样（规整尾换行）。
 */
export function appendAckFeedback({ base, ack, quote, feedback, bold = true, round }: { base?: string; ack?: string; quote?: string; feedback?: string; bold?: boolean; round?: number } = {}): string {
  const b = String(base ?? '').trimEnd();
  const r = Number(round) || nextRoundOf(b);
  const parts: string[] = [];
  if (b) parts.push(b);
  const a = String(ack ?? '').trim();
  if (a && !bodyHasAck(b, a)) parts.push(ackCalloutSection({ round: r, ack: a }));
  const sec = feedbackCalloutSection({ round: r, quote, feedback, bold });
  if (sec) parts.push(sec);
  if (!parts.length) return '';
  return `${parts.join('\n\n')}\n`;
}

// ─── 交付侧上下文重排（#157「倒序聚焦 + 历史精简」）──────────────────
//
// 正文里的轮次 callout 按时间**正序**追加在末尾——agent 收到的提示词里最新
// 一轮的验收反馈被压在最底，而 LLM 对首尾内容的注意力最高；历史轮次的总结
// 保留全文占大量 token 且干扰当前决策。交付渲染时重排为：
//
//   1. 任务骨架（frontmatter + 原始需求等非轮次内容，保持原位）
//   2. 最新一轮**完整内容**：验收反馈（当前要改什么）→ 完成总结（上轮做到哪）
//   3. 历史轮次各一行摘要（反馈「…」；总结「…」——仅供追溯）
//
// 纯函数、零依赖；无轮次段时原样返回（老任务 / 单轮任务零影响）。

const truncLine = (s: unknown, n = 60): string => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** callout 块里剥掉标题行 / `>` 前缀 / 加粗记号后的首个非空行（历史摘要用） */
function firstContentLine(block: unknown): string {
  const line = String(block || '')
    .split('\n')
    .filter((l) => l.trim() && !parseCalloutHead(l))
    .map((l) => l.replace(/^>\s?/, '').replace(/\*\*/g, '').trim())
    .find((l) => l);
  return line || '';
}

interface RoundBlocks {
  ack?: string;
  fb?: string;
}

export function reorderRoundsForDelivery(body: unknown): string {
  const text = String(body ?? '');
  if (!text) return text;
  const blocks = text.split(/\n{2,}/);
  const rounds = new Map<number, RoundBlocks>(); // n → { ack, fb }
  const plain: string[] = [];
  for (const b of blocks) {
    const head = parseCalloutHead(String(b).split('\n')[0]);
    const role = calloutRoleOf(head);
    if (head && head.round && role) {
      const r: RoundBlocks = rounds.get(head.round) || {};
      if (role === 'summary') r.ack = b;
      else r.fb = b;
      rounds.set(head.round, r);
      continue;
    }
    plain.push(b);
  }
  if (!rounds.size) return text;
  const nums = [...rounds.keys()].sort((a, b) => a - b);
  const latest = nums[nums.length - 1];
  if (latest === undefined) return text;
  const out: string[] = [];
  if (plain.length) out.push(plain.join('\n\n'));
  const lr: RoundBlocks = rounds.get(latest) || {};
  // 最新一轮：反馈（当前要改什么）在前，总结（上轮做到哪）随后
  if (lr.fb) out.push(lr.fb);
  if (lr.ack) out.push(lr.ack);
  const older = nums.filter((n) => n !== latest);
  if (older.length) {
    const lines = older.map((n) => {
      const r: RoundBlocks = rounds.get(n) || {};
      const parts: string[] = [];
      if (r.fb) parts.push(`反馈「${truncLine(firstContentLine(r.fb))}」`);
      if (r.ack) parts.push(`总结「${truncLine(firstContentLine(r.ack))}」`);
      return `· 第 ${n} 轮 ${parts.join('；') || '（空）'}`;
    });
    out.push(`—— 历史轮次（已按最新反馈推进，仅供追溯）——\n${lines.join('\n')}`);
  }
  return `${out.join('\n\n')}\n`;
}
