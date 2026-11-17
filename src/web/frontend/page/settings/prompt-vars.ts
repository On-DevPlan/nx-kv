// 提示词变量目录的「分组 + 过滤」纯函数（设置页与单测共用，无 React 依赖）。
//
// 为什么单独成文件：附件一段有近百个变量（6 种 kind 各有子对象），平铺就是一堵墙。
// 分组规则与 schema-bridge 的 `[]` 记法一一对应：
//   `attach.list[].file.localPath` → 组 `attach.list[]`、模板里写 `{{file.localPath}}`
//   （在 `{{#each attach.list}}` 内部是相对域）。
// 放在这里而不是组件里，是为了能用单测钉住「目录记法 ↔ 模板写法」这条对应关系。

/** 一条可展示的变量：rel 是模板里实际怎么写，full 是目录里的完整键。 */
export interface VarRow {
  full: string;
  rel: string;
  label: string;
  desc?: string;
  kind: string;
}

/** 目录里的一条字段声明（= GET /api/prompt/registry 的 plugins[].fields 项）。 */
export interface FieldLike {
  key: string;
  kind: string;
  label: string;
  desc?: string;
}

export interface VarGroup {
  /** 数组元素域的完整前缀（`attach.list[]`）；普通段为 ''。 */
  group: string;
  rows: VarRow[];
}

/**
 * 按数组元素域分组 + 关键词过滤（对 key / label / desc 三个字段做子串匹配）。
 * 组顺序：普通段在前，`[]` 域在后（先看 attach.count，再看 each 内部的字段）。
 */
export function varGroupsOf(fields: readonly FieldLike[], q = ''): VarGroup[] {
  const kw = q.trim().toLowerCase();
  const groups = new Map<string, VarRow[]>();
  for (const f of fields) {
    const at = f.key.indexOf('[]');
    const group = at >= 0 ? f.key.slice(0, at + 2) : '';
    const rel = at >= 0 ? f.key.slice(at + 3) : f.key;
    const hit =
      !kw ||
      f.key.toLowerCase().includes(kw) ||
      String(f.label || '').toLowerCase().includes(kw) ||
      String(f.desc || '').toLowerCase().includes(kw);
    if (!hit) continue;
    const rows = groups.get(group) || [];
    rows.push({ full: f.key, rel, label: f.label, desc: f.desc, kind: f.kind });
    groups.set(group, rows);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([group, rows]) => ({ group, rows }));
}
