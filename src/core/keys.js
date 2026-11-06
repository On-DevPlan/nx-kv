// key 归一化纯函数（core 层）。
//
// 从 repos/service.js 下沉而来（模块分层规则：跨模块共享的纯逻辑落 core）——
// docs 模块的文档路径 slug（docSeg/boardSeg）与 repos 的 key 派生必须是同一套
// 口径，否则「登记的是 A、文档路径算出 B」。repos/service.js 仍转发导出，
// 模块内外的既有调用点（keys.js / ref.js / transfer.js …）全部不变。

// 自定义 key 归一：允许中文与 `/`（像命名空间），其余空白/非法字符压成 -。
// 空 key 不合法——key 是身份，不能空（由调用方校验）。
export function normalizeKey(k) {
  const s = String(k || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"\\|?*\x00-\x1f]/g, '-')
    .replace(/\.git$/i, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .slice(0, 160);
  return s.toLowerCase();
}

// 无 remote 时的兜底 key：local/<slug>。slug 保留可读性（中文也行）。
export function localKeyOf(name) {
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
export function groupKeyOf(name) {
  return 'group/' + localKeyOf(name).slice('local/'.length);
}
