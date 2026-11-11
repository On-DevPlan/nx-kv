// 队列的外部寻址串（topic key）：**(cwd, group) 的纯函数派生值**。
//
// 为什么需要它：CLI 的 `--key`、面板路由、SSE 频道、token 派生都要一个**字符串**
// id，而库里的内部身份是 `topics.id`（INTEGER PK，所有外键只指它）。
// 两者分工与「自增主键 + 对外 UUID」完全同类：
//   id  → 给外键和 JOIN 用，不外露
//   key → 给人用，不出现在任何外键里
//
// **没有任何写入入口**：想「改 key」只有一条路 —— 改 cwd 或改 group，而那在语义上
// 就是「这条队列搬到了别的上下文」，应当是一条新队列（派生模型），不是 UPDATE。
//
// 旧版 key = `sha1(目录**名**)`，语义本身就是错的（同名目录共用一条队列，
// 最后写入者赢，面板上的路径会跟着变）。新版改用完整 cwd，两者不可互相推算，
// 因此**旧 key 一律失效、不做别名解析**：给错误语义做兼容 = 把错误固化下来。
// 迁移时旧 key 只写进 `topics.ext.ext_legacy_key` 作取证，不参与任何查询。
import crypto from 'node:crypto';

/** 全局池的固定 key：跨目录共享队列，cwd 恒为空串。 */
export const GLOBAL_TOPIC_KEY = '__GLOBAL__';

/** 全局池的 cwd（`ux_topics_cwd_group` 里 `cwd COLLATE NOCASE` → 空串只容得下一行）。 */
export const GLOBAL_TOPIC_CWD = '';

/**
 * `(cwd, groupKey)` → 外部寻址串。
 *
 * 大小写折叠（`toLowerCase`）与 schema 里 `ux_topics_cwd_group` 的 `COLLATE NOCASE`
 * 同口径：D:/Work/Web 与 D:/work/web 必须算出同一个 key，否则「同一条队列两个名字」。
 *
 * @param cwd 本机目录（全局池传空串）
 * @param groupKey 组上下文 key（无组上下文传空串/null）
 * @returns 全局池恒为 `__GLOBAL__`；其余为 16 位 sha1 前缀
 */
export function topicKeyOf(cwd: unknown, groupKey: unknown = ''): string {
  const dir = String(cwd ?? '');
  if (dir === '') return GLOBAL_TOPIC_KEY;
  const group = String(groupKey ?? '');
  return crypto
    .createHash('sha1')
    .update(group + '|' + dir.toLowerCase(), 'utf8')
    .digest('hex')
    .slice(0, 16);
}
