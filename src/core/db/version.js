// schema 版本与 Node 版本下限（唯一权威）。
//
// 两个数字都只在这里出现，其它地方一律 import，避免「一处改了、另一处没改」——
// 这类漂移的表现是「库比程序新」的误判，很难看出来。

/** 当前程序认识的 schema 版本（`PRAGMA user_version` 的期望值）。 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * 运行时最低 Node 版本。
 *
 * `node:sqlite` 22.5.0 起才有，且 22.5–22.12 要加 `--experimental-sqlite` 标志，
 * **22.13.0 起免标志** —— 所以下限只能定在 22.13.0。
 */
export const REQUIRED_NODE_VERSION = '22.13.0';

/**
 * 比较两个 `x.y.z` 版本串。
 * @returns {number} a<b 返回负数，相等 0，a>b 正数
 */
export function compareVersions(a, b) {
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
export function checkNodeVersion(version = process.versions.node) {
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
