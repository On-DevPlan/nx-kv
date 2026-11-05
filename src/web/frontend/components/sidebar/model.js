// 侧边栏数据模型（纯函数，不碰 DOM/网络）：
//   - rows: 数据行（仓库登记 + 看板 + 本机任务队列的合并）
//   - out: 渲染序的扁平行列表（看板行 + 仓库行交错），搜索过滤后同样适用
//
// **数据源只有一个**：仓库登记（repo）与看板（board）。
// 侧边栏不再自建分组体系——以前「分组」存在浏览器 localStorage 里（prefs.groups），
// 与仓库页的看板是**两套互不相干的东西**：换浏览器分组就没了，看板改了侧边栏也不知道。
// 现在：仓库 = 目录行，看板 = 分组行，归属关系就是看板的成员表。
// 侧边栏只保留**纯 UI 偏好**：排序、隐藏、折叠——它们是显示态，不是数据。
//
// 「可见序 = 渲染序」是键盘导航的前提：↑↓ 走的就是这份扁平序。
import { stripFrontmatter } from '../../modules/md/md-parse.js';

export const GLOBAL_KEY = '__GLOBAL__';

/**
 * 构建侧边栏行模型。
 * @param repos   开发仓库（type != ref），每条带 id / name / key / path / boards[]
 * @param boards  看板，每条带 id / name / desc / repos[]
 * @param topics  本机任务队列（按 cwd 匹配仓库），每条可带 repo
 * @param prefs   UI 偏好（order / hidden / folded）
 * @param kw      搜索关键词（'' = 不过滤）
 * @returns {{rows: Array, matchCount: number}}
 */
export function buildTree(repos, boards, topics, prefs, kw = '') {
  const q = String(kw || '').trim().toLowerCase();
  const hidden = new Set(prefs.hidden || []);

  // 仓库 → 任务队列：按路径归位。topic.repo 由服务端按 cwd 匹配登记得到；
  // 没匹配上的（目录没登记）不单独成行——它不属于任何仓库，也不该有自己的入口。
  const topicsOf = new Map();
  for (const t of topics || []) {
    if (t.isGlobal) continue;
    const rid = t.repo && t.repo.id;
    if (!rid) continue;
    if (!topicsOf.has(rid)) topicsOf.set(rid, []);
    topicsOf.get(rid).push(t);
  }

  // 仓库行：任务数 = 该仓库下所有 topic 的待领取之和
  //
  // **两种 key 别混**：
  //   key      = 仓库身份（归一化远程地址派生）——排序、隐藏、看板归属都用它；
  //   topicKey = 任务队列主题的 key（sha1(目录名)）——工作台深链 #/dir/<topicKey> 用它。
  // 两者不是一回事：仓库 key 跨机稳定，topic key 是本机队列的身份。
  const repoRows = (repos || [])
    .filter((r) => !hidden.has(r.key || r.id))
    .map((r) => {
      const ts = topicsOf.get(r.id) || [];
      return {
        type: 'repo',
        key: r.key || r.id,
        repoId: r.id,
        topicKey: ts.length ? ts[0].key : '',
        name: r.name,
        icon: r.icon || '',        // 项目图标（emoji/单字符；空 = 默认文件夹图标）
        cwd: r.path || '',
        desc: r.desc || '',
        boards: r.boards || [],
        summary: ts.map((t) => t.summary).filter(Boolean).join(' / '),
        pending: ts.reduce((n, t) => n + (t.pending || 0), 0),
        waiting: ts.some((t) => t.waiting),
        topics: ts,
      };
    });
  const byKey = new Map(repoRows.map((r) => [r.key, r]));

  // 命中：仓库名 / key / 路径 / 描述 / 任务现状
  const hit = (r) =>
    !q ||
    String(r.name || '').toLowerCase().includes(q) ||
    String(r.key || '').toLowerCase().includes(q) ||
    String(r.cwd || '').toLowerCase().includes(q) ||
    String(r.desc || '').toLowerCase().includes(q) ||
    String(r.summary || '').toLowerCase().includes(q);

  const matched = repoRows.filter(hit);

  const rows = [];
  const boardList = boards || [];

  // 看板行（分组）：**组是叶子，不再铺成员子行**（2026-11-03 语义化改版）。
  // 侧栏操作的对象是「工作组」，不是组下的某个文件——成员清单与项目切换
  // 收进组详情面板（#/group/<id>，面板内下拉选项目）。组行徽标 = 组内待领取总数。
  for (const b of boardList) {
    // 看板成员按 key 存；本地未拥有的占位成员没有登记，不成行（只占组里的位置）
    const members = (b.repos || [])
      .map((m) => byKey.get(m.key))
      .filter(Boolean);
    // 搜索时：命中成员也算命中这个组（组行代表它的全部成员）
    const memberHit = members.some(hit);
    if (q && !hit(b) && !memberHit) continue;
    rows.push({
      type: 'board',
      id: b.id,
      key: b.key || b.id,
      name: b.name,
      desc: b.desc || '',
      count: (b.repos || []).length,
      pending: members.reduce((n, m) => n + (m.pending || 0), 0),
      waiting: members.some((m) => m.waiting),
      members: (b.repos || []).map((m) => m.key),
    });
  }

  // **分组是逻辑组**（任务 #61）：看板是给项目贴的标签，不是容器——
  // 每个项目在左边都**单独成行**（能直接进去单干），组行只做聚合入口与归拢。
  // 一个项目可以属于多个组：它只出现一次，行上标出它属于哪些组。
  //
  // （2026-11-03 曾把成员收进组行当叶子——那样组里的项目在左边点不到，
  //   也就没法「按单项目」干活；这里恢复单项目入口。）
  const firstGroupOf = new Map(); // repoKey -> 首个组 id（决定行落在哪个桶）
  const groupNamesOf = new Map(); // repoKey -> 它所属的组名（可多个）
  for (const b of boardList) {
    for (const m of b.repos || []) {
      if (!firstGroupOf.has(m.key)) firstGroupOf.set(m.key, b.id);
      if (!groupNamesOf.has(m.key)) groupNamesOf.set(m.key, []);
      const names = groupNamesOf.get(m.key);
      if (!names.includes(b.name)) names.push(b.name);
    }
  }
  for (const r of matched) {
    rows.push({
      ...r,
      groupId: firstGroupOf.get(r.key) || '',
      groupNames: groupNamesOf.get(r.key) || [],
    });
  }

  // 排序：用户编过的顺序在前（order 存 key），其余按名称自然序
  //
  // **分组要读成组**：看板的成员行紧跟在该看板行下面，不跟未归组的仓库混在
  // 全局名称序里——否则「nx 一类」看着只是一堆缩进的行，组不成类。
  // 桶 = 看板（行与成员同桶，成员在看板行之后）；未归组的仓库排在所有桶之后。
  const orderIdx = new Map((prefs.order || []).map((k, i) => [k, i]));
  const bucketOf = new Map(); // boardId -> 桶序号
  boardList.forEach((b, i) => bucketOf.set(b.id, i));
  const looseBucket = boardList.length; // 未归组的仓库
  const bucketOfRow = (r) => {
    if (r.type === 'board') return bucketOf.has(r.id) ? bucketOf.get(r.id) : looseBucket;
    if (r.groupId) return bucketOf.has(r.groupId) ? bucketOf.get(r.groupId) : looseBucket;
    return looseBucket;
  };
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ia = orderIdx.has(rKey(a.r)) ? orderIdx.get(rKey(a.r)) : Infinity;
      const ib = orderIdx.has(rKey(b.r)) ? orderIdx.get(rKey(b.r)) : Infinity;
      if (ia !== ib) return ia - ib;
      const ka = bucketOfRow(a.r);
      const kb = bucketOfRow(b.r);
      if (ka !== kb) return ka - kb;
      // 同一桶内：看板行在前（它包着成员），再按名称
      const ga = a.r.type === 'board' ? 0 : 1;
      const gb = b.r.type === 'board' ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return String(a.r.name || '').localeCompare(String(b.r.name || ''));
    })
    .map((x) => x.r);

  // 全局池恒顶（不受排序影响）
  const globalRow = (topics || []).find((t) => t.isGlobal);
  const out = [];
  if (globalRow) {
    out.push({
      type: 'global',
      key: GLOBAL_KEY,
      name: globalRow.name || '全局任务',
      topic: globalRow,
      pending: globalRow.pending || 0,
      waiting: !!globalRow.waiting,
      topics: (globalRow.tasks || []).filter((t) => !t.deletedAt),
    });
  }
  out.push(...sorted);

  // 搜索计数按**可见行**算：组行（代表全体成员）+ 未归组仓库行——
  // 成员子行已不渲染，把它算进「N 个匹配」会数出看不见的行（全局池行也不算）。
  return { rows: out, matchCount: q ? out.filter((r) => r.type === 'board' || (r.type === 'repo' && !r.groupId)).length : 0 };
}

// 排序用的稳定标识：仓库行用全局唯一的 key，看板行用看板 id
export function rKey(row) {
  return row.type === 'board' ? 'board:' + row.id : row.key;
}

/** 任务正文抽一行标题（给侧栏子行用）；带 frontmatter 的任务先剥掉再取 */
export function taskLabel(t) {
  const text = stripFrontmatter(String(t?.text || ''));
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 40);
  const line = text.split('\n').find((l) => l.trim());
  return (line || `#${t?.id}`).trim().slice(0, 40);
}
