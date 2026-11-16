// 模板生成的任务 → 编辑器里哪些块是「模板骨架（只读）」、哪些是「插槽（可编辑）」。
//
// 判定依据只有两样，都在正文里，不依赖前端内存：
//   1. frontmatter 的 `template: <id>`（templateIdOf）——这条任务由哪个模板生成
//   2. 该模板当下的正文（templates 表）——骨架长什么样
//
// 为什么要比对而不是在正文里插标记：正文会被交付给 agent（{{task.text}}）、
// 会被 CLI 侧编辑、会被复制成新任务——任何不可见标记都会跟着跑，或在某一环被剥掉。
// 比对是**纯派生**：模板改了，锁定范围自然跟着变，不产生第二份真相。
//
// 块粒度与编辑器一致（liveBodyBlocks：剥首个 H1、frontmatter 自成一块），
// 下标可以直接喂给 .mdw-lp-block[data-i]。
import { liveBodyBlocks } from './md-blocks.js';

const SLOT_SRC = '\\{\\{\\s*[^{}\\s][^{}]*?\\s*\\}\\}';
const SLOT_RE_G = new RegExp(SLOT_SRC, 'g');
const SLOT_RE = new RegExp(SLOT_SRC);

/** 块比较口径：只剥 ZWSP 与首尾空白（内部换行/缩进必须逐字相同才算骨架）。 */
function norm(b: unknown): string {
  return String(b ?? '').replace(/\u200b/g, '').trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 模板块 → 正文块判定器：含槽位的块，槽位位置可任意（那是用户填的内容）。 */
function matcherOf(templateBlock: string): (block: string) => boolean {
  const t = norm(templateBlock);
  if (!SLOT_RE.test(t)) return (b) => norm(b) === t;
  const parts = t.split(SLOT_RE_G).map(escapeRe);
  const re = new RegExp(`^${parts.join('[\\s\\S]*?')}$`);
  return (b) => re.test(norm(b));
}

/** 整块只有槽位（去掉槽位后没有实质文字）——这块本身就是「填这里」。 */
function isPureSlot(templateBlock: string): boolean {
  const t = norm(templateBlock);
  if (!SLOT_RE.test(t)) return false;
  return t.replace(SLOT_RE_G, '').trim() === '';
}

export interface TemplateLocks {
  /** 模板骨架块（未含槽位）：只读 */
  locked: Set<number>;
  /** 插槽块（模板块里声明了 {{槽位}}）：可编辑，但视觉上标出来 */
  slots: Set<number>;
}

const EMPTY: TemplateLocks = { locked: new Set(), slots: new Set() };

/**
 * 任务正文块 vs 模板正文 → 锁定/插槽块下标。
 *
 * 顺序匹配（双指针）：模板块按原顺序在正文里找第一个对得上的块；对不上的正文块
 * 视为用户新增（可编辑）。骨架块被用户删掉/改写过 → 它不再匹配，自然解锁——
 * 只读只保护「原样还在的骨架」，不会把用户已经改动的内容锁死。
 */
export function computeTemplateLocks(taskBody: string, templateBody: string): TemplateLocks {
  if (!String(templateBody ?? '').trim()) return EMPTY;
  // 没有槽位的模板不锁：只读的前提是「有可编辑的出口」，否则整篇锁死、任务没法写。
  if (!SLOT_RE.test(String(templateBody))) return EMPTY;
  const tpl = liveBodyBlocks(templateBody);
  const blocks = liveBodyBlocks(taskBody);
  if (!tpl.length || !blocks.length) return EMPTY;

  const locked = new Set<number>();
  const slots = new Set<number>();
  let j = 0; // 模板游标
  let i = 0; // 正文游标
  while (j < tpl.length && i < blocks.length) {
    const t = tpl[j] ?? '';
    if (!norm(t)) {
      j += 1; // 模板里的空块不参与对齐（splitMdBlocks 正常不会产出，ZWSP 块才会）
      continue;
    }
    // 纯槽位块：正常情况它就占正文当前位置（顺序语义），不去后面搜索——
    // 否则「万能匹配」会吃掉下一块骨架（如分隔线），把只读判成可编辑。
    // 例外：用户把这块删了（当前位置已经是下一块骨架）→ 跳过它、不占位。
    if (isPureSlot(t)) {
      const nextTpl = tpl[j + 1];
      if (nextTpl && matcherOf(nextTpl)(blocks[i] ?? '')) {
        j += 1;
        continue;
      }
      slots.add(i);
      j += 1;
      i += 1;
      continue;
    }
    const hit = matcherOf(t);
    // 在正文里往后找第一个对得上的块（允许用户在前面插入新块）
    let k = i;
    for (; k < blocks.length; k += 1) {
      if (hit(blocks[k] ?? '')) break;
    }
    if (k >= blocks.length) break; // 骨架已被改到对不上：剩下的不再锁定
    if (SLOT_RE.test(norm(t))) slots.add(k);
    else locked.add(k);
    j += 1;
    i = k + 1;
  }
  return { locked, slots };
}
