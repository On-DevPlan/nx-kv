// key 归一化纯函数（core 层）：只剩文档路径 slug 相关的 localKeyOf / groupKeyOf。
//
// normalizeKey / keyFromRemote 已下沉到 **shared/repo-key**：前端（添加仓库时
// 自动填充）也要用同一份规则，而 web 不允许依赖 core。core 反过来也不允许依赖
// shared（见 layering.test），所以 core 内不再转发这两个函数；需要它们的
// 文件（repos/service、docs/paths、docs/refs）直接引 shared/repo-key。

// 文档路径的 slug：local/<slug>（slug 保留可读性，中文也行）。
// **不再用于给仓库生成 key**：仓库 key 必须显式给出，或由远程地址归一化而来。
// 保留此函数是因为 docs 的路径口径（boardSeg / 旧 local/ 文档目录）仍复用它。
export function localKeyOf(name: unknown): string {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f/]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return 'local/' + (slug || 'repo');
}

// 仓库组（旧 boards）的 key：`group/<slug(初始 name)>`。
//
// **一旦生成就冻结**：name 之后可以改，key 不变。理由与 repos.key 完全一样 ——
// key 是身份（导出/导入、成员边、队列的 group_key 都指它），跟着显示名漂会让
// 所有外部引用在改名那一刻全断，而且不报错。
//
// slug 复用 localKeyOf 的规则（同一套口径），只把 `local/` 前缀换成 `group/`：
// 两处各写一份 slug 规则的话，「登记的是 A、文档路径算出 B」迟早会发生。
export function groupKeyOf(name: unknown): string {
  return 'group/' + localKeyOf(name).slice('local/'.length);
}
