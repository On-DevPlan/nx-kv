// 任务搜索（#181）：目录任务页顶部搜索框的匹配规则。纯函数、零 DOM / 零 IO，可单测。
//
// 口径（用户：**"把内容也作为搜索的 target，模糊搜索"**）：
//   1. 空格分词，每个词都要命中（AND）——「侧边栏 分页」＝两个词都得出现
//   2. 词在**标题 + 正文**里找（正文先剥掉 frontmatter，否则搜 board/project
//      这类元数据会把整页任务全部命中）
//   3. 显式通配 `a*b`：按段顺序命中，段内连续
//   4. `#12` / `12`：编号等值或前缀优先（敲编号是在点名某条任务），
//      其余按子串命中
//   5. 大小写不敏感
//
// 与进程面板的 progress-search 是两套口径：那边搜的是「某一轮的进展卡片」，
// 编号有特殊语义（#127/#129）；这里搜的是任务本体，正文必须参与，故单独一份。
// 仍然是纯函数 + 单测，别把匹配规则散进组件里。

/** 搜索需要读到的最小任务形状。 */
export interface SearchableTask {
  id?: unknown;
  text?: string;
}

/** 去掉正文头部的 frontmatter 块（`---` 起、`---` 止）。 */
export function bodyOf(text: unknown): string {
  return String(text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/** 标题：正文（剥掉 frontmatter 后）第一行非空行，去掉行首 `#`——与侧栏 taskLabel 同一取法。 */
export function titleOf(text: unknown): string {
  const line = bodyOf(text)
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  return String(line || '').replace(/^#+\s*/, '').trim();
}

/** 单词语义：编号 / 通配 / 子串。 */
function hitToken(tok: string, hay: string, id: string): boolean {
  const bare = tok.startsWith('#') ? tok.slice(1) : tok;
  if (!bare) return true;
  if (/^\d+$/.test(bare)) {
    return id === bare || id.startsWith(bare) || hay.includes(bare);
  }
  if (bare.includes('*')) {
    const segs = bare.split('*').filter(Boolean);
    if (!segs.length) return true;
    let at = 0;
    for (const seg of segs) {
      const i = hay.indexOf(seg, at);
      if (i < 0) return false;
      at = i + seg.length;
    }
    return true;
  }
  return hay.includes(bare);
}

/**
 * 任务是否命中查询串（空串视为全命中）。
 * @param task 任务行（只读 id 与 text）
 * @param q 用户原样输入
 */
export function hitTaskQuery(task: SearchableTask | null | undefined, q: unknown): boolean {
  const raw = String(q ?? '').trim().toLowerCase();
  if (!raw) return true;
  if (!task) return false;
  // 正文（已剥 frontmatter）里本就含标题行，命中面直接用这一份，别再把标题拼一遍
  // ——拼两遍会让「页*边栏」这类跨段通配误命中（同一段文字被看了两次）。
  const hay = bodyOf(task.text).toLowerCase();
  const id = String(task.id ?? '');
  return raw.split(/\s+/).filter(Boolean).every((tok) => hitToken(tok, hay, id));
}

/** 列表过滤（保持原序：调用方传入的已是显示序）。 */
export function filterTasks<T extends SearchableTask>(tasks: T[] | null | undefined, q: unknown): T[] {
  const list = Array.isArray(tasks) ? tasks : [];
  const raw = String(q ?? '').trim();
  if (!raw) return list;
  return list.filter((t) => hitTaskQuery(t, raw));
}

export default hitTaskQuery;
