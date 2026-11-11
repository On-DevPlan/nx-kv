// 进程面板的搜索匹配（#127 → #129）：纯函数，无 DOM、无 IO，可单测。
//
// #127 定的口径：用户说的「楼数」就是任务编号 #xxx（不是重开轮次 round），
// 搜索框按编号或标题过滤。#129 的验收反馈把这条口径补细了——
// 「比如输入 12，应该显示 12、120-129、1*2 这些」，于是匹配规则从
// 「编号等值 + 标题子串」扩成三档：
//
//   1. 纯数字（12 / #12）
//      · 编号等值命中：#12
//      · 编号前缀命中：12 → #120、#121 … #129（用户说的「120-129」这一段）
//      · 标题按「数字逐位通配」命中：12 ≡ 1*2 ——「1」在前、「2」在后，
//        中间夹什么都行（用户说的「1*2」那种标题）
//   2. 带 * 的通配（1*2 / 12* / *2）
//      · 按 * 切段，每段在标题（或编号）里按顺序出现，段内连续
//   3. 普通文本
//      · 标题子串匹配（不区分大小写），与附件弹窗的搜索同一口径
//
// 编号在前缀命中上放宽、在标题上按逐位通配，是因为卡片右侧显示的就是
// #id：用户敲 12 时脑子里是「12 号以及 12x 号」这一串。
//
// 注意：普通文本**不**做逐位通配——不然「fix」会命中「f-i-x」这种噪声，
// 模糊到没边。逐位通配只给数字与显式 * 用。
//
// 卡片结构（taskToProgress，见 modules/md/md-parse.js）：
//   { id, title, ... }         —— 目录模式：id 是数字编号
//   { id, taskId, title, ... } —— 组模式：taskId 是数字编号，id 同值

/** 搜索只读到的卡片字段（taskToProgress 产物 / 组模式补充字段的超集）。 */
export interface SearchCard {
  id?: unknown;
  taskId?: unknown;
  title?: string;
}

/** 编号：优先 taskId（组模式显式给的），退回 id。 */
export function cardIdOf(card?: SearchCard | null): string {
  const raw = card && card.taskId !== undefined && card.taskId !== null ? card.taskId : card && card.id;
  return String(raw ?? '');
}

/**
 * 按顺序的段匹配：每段在 text 里都要出现，且位置依次靠后（段内连续）。
 * segments 为空 → 视为通配全部（`*` 单独一个）。
 */
export function matchSegments(text: unknown, segments?: string[] | null): boolean {
  const t = String(text ?? '').toLowerCase();
  const segs = (segments || []).map((s) => String(s).toLowerCase()).filter(Boolean);
  if (!segs.length) return true;
  let at = 0;
  for (const seg of segs) {
    const i = t.indexOf(seg, at);
    if (i < 0) return false;
    at = i + seg.length;
  }
  return true;
}

/** 逐位匹配：q 的每个字符依次出现在 text 里（可夹任意字符）——「12 ≡ 1*2」。 */
export function matchCharsInOrder(text: unknown, q: unknown): boolean {
  const t = String(text ?? '').toLowerCase();
  const chars = String(q ?? '').toLowerCase().split('');
  let at = 0;
  for (const ch of chars) {
    const i = t.indexOf(ch, at);
    if (i < 0) return false;
    at = i + 1;
  }
  return true;
}

/**
 * 卡片是否命中查询串。
 * @param card 进程卡片（taskToProgress 的产物）
 * @param q 查询串（用户原样输入）
 */
export function hitQuery(card: SearchCard | null | undefined, q: unknown): boolean {
  const raw = String(q ?? '').trim().toLowerCase();
  if (!raw) return true;
  const body = raw.startsWith('#') ? raw.slice(1).trim() : raw;
  if (!body) return true;

  const id = cardIdOf(card);
  const title = String((card && card.title) || '').toLowerCase();

  // 2) 显式通配：1*2 / 12* / *2 —— 段按顺序命中，标题与编号都算
  if (body.includes('*')) {
    const segs = body.split('*').filter(Boolean);
    if (matchSegments(title, segs)) return true;
    return matchSegments(id, segs);
  }

  // 1) 纯数字：编号等值 / 前缀 + 标题逐位通配
  if (/^\d+$/.test(body)) {
    if (id === body) return true;
    if (id.startsWith(body)) return true;
    return matchCharsInOrder(title, body);
  }

  // 3) 普通文本：标题子串
  return title.includes(body);
}

/**
 * 查询串是不是「精确编号」（12 / #12）且与卡片编号**等值**命中。
 *
 * #172：进程面板把反馈链的旧轮次折叠了（只留链尖），但「我要找 #87」这种
 * 明确点名必须还能找到——所以旧轮次只按**编号等值**召回，标题模糊 / 前缀命中
 * 不召回（一召回就把几十条旧轮次重新堆回屏上，等于没折叠）。
 */
export function hitExactId(card: SearchCard | null | undefined, q: unknown): boolean {
  const raw = String(q ?? '').trim().toLowerCase();
  const body = raw.startsWith('#') ? raw.slice(1).trim() : raw;
  if (!body || !/^\d+$/.test(body)) return false;
  return cardIdOf(card) === body;
}

export default hitQuery;
