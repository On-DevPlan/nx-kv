// schema 版本与 Node 版本下限（唯一权威）。
//
// 两个数字都只在这里出现，其它地方一律 import，避免「一处改了、另一处没改」——
// 这类漂移的表现是「库比程序新」的误判，很难看出来。

/**
 * 当前程序认识的 schema 版本（`PRAGMA user_version` 的期望值）。
 *
 * v2（2026-11-08）：新增 attachments / task_attach / ref_attach，删除 task_refs /
 * ref_relations；旧 manifest.json 与正文 fileId 引用在迁移阶段落库。
 *
 * v3（2026-11-09）：templates 加 scope（可见域 JSON 数组，默认 '["*"]'）与
 * origin_topic（创建来源主题，默认 ''）——存量行原地升为全局可见，零破坏。
 *
 * v4（2026-11-09）：参考仓库绑定从仓库级升到**组级**（group_refs）；组的成员仓库
 * 共享组上的参考仓库，不做继承/覆盖。旧 ext_linked 绑定由 v4-data.js 搬运。
 *
 * v5（2026-11-12）：attachments 重建，新增 kind='mdfile'（本地 md 文件指针）与
 * storage='external'；新增 abs_path / anchor_dir / missing_at / last_seen_at 四列
 * 与路径部分唯一索引。纯 DDL 迁移，无数据搬运。
 *
 * v6（2026-11-12）：refs 升级为「文档本体」——新增 rel（逻辑名，唯一）/ origin /
 * body_bytes；正文进 ref_bodies（1:1，CASCADE）；ref_attach 的 role 增 'source'
 * （外部 md 文件同步来源）。盘上 docs 树正文一次性入库，逐篇 sha256 回读比对。
 *
 * v7（2026-11-12）：refs 增加 desc（短描述）。ref 不再当实体文件，列表与提示词
 * 模板以 desc 作为快速定位标签；不新增任何路径 / 文件名字段。
 */
export const CURRENT_SCHEMA_VERSION = 7;

/**
 * 运行时最低 Node 版本。
 *
 * `node:sqlite` 22.5.0 起才有，且 22.5–22.12 要加 `--experimental-sqlite` 标志，
 * **22.13.0 起免标志** —— 所以下限只能定在 22.13.0。
 */
export const REQUIRED_NODE_VERSION = '22.13.0';

/** Node 版本检查结果。 */
export interface NodeVersionCheck {
  ok: boolean;
  version: string;
  message: string;
}

/**
 * 比较两个 `x.y.z` 版本串。
 * @returns {number} a<b 返回负数，相等 0，a>b 正数
 */
export function compareVersions(a: unknown, b: unknown): number {
  const pa = String(a || '0').split('.').map((n) => Number(n) || 0);
  const pb = String(b || '0').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 检查当前（或给定）Node 版本是否够用。
 *
 * 为什么要在**业务代码 import 之前**检查：否则用户看到的是
 * `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` 加一段栈，
 * 完全指不出「你的 Node 太老」这个真因。
 *
 * @param {string} [version] 默认 `process.versions.node`
 * @returns {{ok: boolean, version: string, message: string}}
 */
export function checkNodeVersion(version: string = process.versions.node): NodeVersionCheck {
  const cur = String(version || '0.0.0');
  if (compareVersions(cur, REQUIRED_NODE_VERSION) >= 0) {
    return { ok: true, version: cur, message: '' };
  }
  return {
    ok: false,
    version: cur,
    message:
      `nx-kv 需要 Node >= ${REQUIRED_NODE_VERSION}（当前 ${cur}）。\n` +
      '原因：存储层使用 Node 内置 SQLite；22.13 起不再需要 --experimental-sqlite 标志。',
  };
}
