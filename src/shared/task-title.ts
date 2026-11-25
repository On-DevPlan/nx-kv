// 任务标题提取的**唯一实现**（#200 对抗审查收拢：此前 7 份拷贝口径不一）。
//
// 两种口径，按调用场景选：
//   taskTitleOf   正文首个非空行去 #（ topics 列表/附件资源用——标题就是「第一行写的什么」）
//   taskHeadingOf 首个 `#` 标题优先、否则首行（队列卡片/组页用——用户起的标题优先展示）
//
// 历史包袱已清：frontmatter 剥离逻辑删除（#197 起正文只存 markdown，无任何头部块）。

const MAX = 80;

/** 去掉前导 #（一个或多个）后的文本。 */
function stripHeading(s: string): string {
  return s.replace(/^#{1,6}\s+/, '').trim();
}

/** 任务标题 = 正文首个非空行去前导 #，截 80 字（超长加省略号）。 */
export function taskTitleOf(text: unknown): string {
  const first = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || '';
  const title = stripHeading(first).slice(0, MAX);
  return title;
}

/** 任务标题 = 首个 `#` 标题优先（任何行），否则首个非空行；截 80 字（超长加省略号）。 */
export function taskHeadingOf(text: unknown): string {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l));
  const line = stripHeading(heading ?? lines[0] ?? '');
  return line.length > MAX ? line.slice(0, MAX) + '…' : line;
}
