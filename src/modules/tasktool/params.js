// tasktool/params.js —— **外部参数（平面扩展）**的解析（任务 #62）。
//
// 领取任务的引擎（get / wait）支持往交付模板的 ctx 里塞**任意**外部参数：
//   nx-kv localtask wait --cwd "<dir>" --param lane=payment --param retry=2
//
// 模板里两种取法都能用：
//   {{lane}}        平铺（顶层）——外部参数直接占一个键
//   {{params.lane}} 归拢（params 子树）——与内建字段（task/goal/source…）不打架
//
// 内建同名键**不被外部参数覆盖**（否则一条 --param task=… 就能把任务正文顶掉）。
//
// 解析口径：'k=v' 列表（可重复给、可逗号分隔）；没有 '=' 的项忽略；键与值都去空白；
// 值可以为空（k= → 空串）。
/**
 * 外部参数列表 → 普通对象。
 * @param {string[]|string|undefined|null} list 'k=v' 列表（可重复 / 逗号分隔）
 * @returns {Record<string, string>} 参数表
 */
export function parseParams(list) {
  const out = {};
  const items = Array.isArray(list) ? list : list === undefined || list === null ? [] : [list];
  for (const item of items) {
    for (const part of String(item).split(',')) {
      const s = part.trim();
      if (!s) continue;
      const i = s.indexOf('=');
      if (i <= 0) continue; // 没有键（= 开头）或没有 '=' 的项忽略
      const k = s.slice(0, i).trim();
      if (!k) continue;
      out[k] = s.slice(i + 1).trim();
    }
  }
  return out;
}
