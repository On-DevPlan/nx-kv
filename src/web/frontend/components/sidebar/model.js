// 侧边栏数据模型（纯函数，不碰 DOM/网络）。
//
// **两种东西必须分清**——这是本文件存在的理由：
//
//   资产（asset）：**项目（repo）** 与 **项目组（board）**。
//     两者是**并列**的一等条目，不是父子关系。项目组内部装的是「开发仓库 + 参考仓库」
//     （那是数据，看 board.repos），但侧边栏**不**把项目组画成仓库的父目录——
//     一条仓库不会因为它属于某个项目组就被塞进那个组下面消失。
//
//   收纳盒（group，左侧的「组」）：**纯显示态的格子**，用来把资产摆在一起，
//     像抽屉/压缩包。它只活在 prefs（浏览器本地），不写 store、不进导出、
//     与项目组的成员表毫无关系。同一条资产最多放进一个收纳盒。
//
// 历史教训（2026-10-29 → 10-30）：
//   第一版把「分组」做成 localStorage 的假数据（与看板重复，换浏览器就没了）；
//   第二版矫枉过正，把看板当成侧边栏的容器——于是项目组既是资产又是目录，
//   读起来就是「移动」而不是「并列」。现在的分工是：
//     **数据归属**（谁属于哪个项目组）= store 里看板的成员表，行菜单改；
//     **显示编排**（摆在哪个收纳盒、什么顺序）= prefs，拖拽改。
//
// 排序：prefs.order 存 itemId（'board:<id>' / 'repo:<key>'），一条全局序列，
// 每层按它过滤排序；没编过序的按「收纳盒 → 项目组 → 项目」再按名称。

export const GLOBAL_KEY = '__GLOBAL__';

/** 资产在侧边栏里的稳定标识（排序/隐藏/收纳盒归属都用它） */
export function itemIdOf(row) {
  if (!row) return '';
  if (row.type === 'board') return 'board:' + row.id;
  if (row.type === 'repo') return 'repo:' + (row.key || row.id);
  return '';
}

export const boardItemId = (id) => 'board:' + id;
export const repoItemId = (key) => 'repo:' + key;

// 顶层条目的默认次序（没被 order 编过的部分）：收纳盒 → 项目组 → 项目
const TYPE_RANK = { group: 0, board: 1, repo: 2, global: -1 };

/**
 * 构建侧边栏行模型。
 * @param repos   开发仓库（type != ref），每条带 id / name / key / path / boards[]
 * @param boards  项目组，每条带 id / name / desc / repos[]（成员含本地未拥有的占位）
 * @param topics  本机任务队列（按 cwd 匹配仓库），每条可带 repo
 * @param prefs   UI 偏好（order / hidden / groups / groupOpen）
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

  // ── 资产池：项目 ──
  //
  // **两种 key 别混**：
  //   key      = 仓库身份（归一化远程地址派生）——排序、隐藏、项目组成员都用它；
  //   topicKey = 任务队列主题的 key（sha1(目录名））——深链 #/dir/<topicKey> 用它。
  // hidden 里可能存着老版本的裸 key（'repo:' 前缀是后加的），两种都认。
  const repoRows = (repos || [])
    .map((r) => {
      const key = r.key || r.id;
      const ts = topicsOf.get(r.id) || [];
      return {
        type: 'repo',
        itemId: repoItemId(key),
        key,
        repoId: r.id,
        topicKey: ts.length ? ts[0].key : '',
        name: r.name,
        cwd: r.path || '',
        desc: r.desc || '',
        // 描述文档（仓库内 md 的相对路径）：tooltip 里列出来，点「编辑」进详情页
        docs: r.docs || [],
        boards: r.boards || [],
        summary: ts.map((t) => t.summary).filter(Boolean).join(' / '),
        pending: ts.reduce((n, t) => n + (t.pending || 0), 0),
        waiting: ts.some((t) => t.waiting),
        topics: ts,
      };
    })
    .filter((r) => !hidden.has(r.itemId) && !hidden.has(r.key));

  // ── 资产池：项目组 ──
  // 成员里可能有「本地未拥有」的占位（导入时对方有、本地没 clone），
  // 所以 count（总数）之外再给 missing（还没落到本地的），一眼看出组是不是虚的。
  const localRepoKeys = new Set((repos || []).map((r) => r.key || r.id));
  const boardRows = (boards || [])
    .map((b) => {
      const members = (b.repos || []).map((m) => m.key || m.id).filter(Boolean);
      return {
        type: 'board',
        itemId: boardItemId(b.id),
        id: b.id,
        key: b.key || b.id,
        name: b.name,
        desc: b.desc || '',
        count: members.length,
        missing: members.filter((k) => !localRepoKeys.has(k)).length,
        members,
      };
    })
    .filter((b) => !hidden.has(b.itemId) && !hidden.has(b.id));

  // 命中：名称 / key / 路径 / 描述 / 任务现状
  const hit = (r) =>
    !q ||
    String(r.name || '').toLowerCase().includes(q) ||
    String(r.key || '').toLowerCase().includes(q) ||
    String(r.cwd || '').toLowerCase().includes(q) ||
    String(r.desc || '').toLowerCase().includes(q) ||
    String(r.summary || '').toLowerCase().includes(q);

  const assets = [...boardRows, ...repoRows];
  const byItem = new Map(assets.map((a) => [a.itemId, a]));
  const matched = assets.filter(hit);

  // ── 收纳盒（纯显示层）──
  // members 里指向已删资产 / 已隐藏资产的 id 直接跳过（不清理数据，读时忽略即可）。
  const groups = (prefs.groups || []).map((g) => ({ ...g, members: g.members || [] }));
  const inGroup = new Set();
  for (const g of groups) for (const id of g.members) inGroup.add(id);

  const orderIdx = new Map((prefs.order || []).map((k, i) => [k, i]));
  const openMap = prefs.groupOpen || {};
  const idxOf = (row) => {
    if (orderIdx.has(row.itemId)) return orderIdx.get(row.itemId);
    if (row.key && orderIdx.has(row.key)) return orderIdx.get(row.key); // 老数据：裸 key
    return Infinity;
  };
  const cmp = (a, b) => {
    const ia = idxOf(a);
    const ib = idxOf(b);
    if (ia !== ib) return ia - ib;
    const ga = TYPE_RANK[a.type] ?? 9;
    const gb = TYPE_RANK[b.type] ?? 9;
    if (ga !== gb) return ga - gb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  };

  const rows = [];

  // 顶层 = 收纳盒 + 未进盒的资产；同一个 order 序列过滤出本层条目
  const topGroups = groups.map((g) => {
    const members = g.members.map((id) => byItem.get(id)).filter(Boolean);
    const shown = q ? members.filter(hit) : members;
    const groupHit = !q || String(g.name || '').toLowerCase().includes(q) || shown.length > 0;
    return { g, members, shown, groupHit };
  });

  for (const { g, members, shown, groupHit } of topGroups) {
    if (!groupHit) continue;
    // 搜索时展开命中项（否则搜到的东西藏在折叠的盒子底下）
    // 没记过展开态的盒子按 defaultGroupFolded 走（缺省展开——刚建的盒子应该是开的）
    const open = q ? true : (g.id in openMap ? !!openMap[g.id] : !prefs.defaultGroupFolded);
    rows.push({
      type: 'group',
      id: g.id,
      itemId: 'group:' + g.id,
      name: g.name,
      open,
      count: members.length,
      members: members.map((m) => m.itemId),
    });
    if (open) {
      for (const m of shown.slice().sort(cmp)) {
        rows.push({ ...m, groupId: g.id, nested: true });
      }
    }
  }

  const loose = matched.filter((r) => !inGroup.has(r.itemId));
  for (const r of loose.slice().sort(cmp)) rows.push({ ...r, groupId: '' });

  // 顶层整体排序：编过序的按 order，没编过的按「盒子 → 项目组 → 项目 → 名称」
  // 收纳盒的 order 标识是 'group:<id>'，与资产的 itemId 同一套序列。
  // 嵌套行跟随它所在的收纳盒位置（不动它们之间的相对序）。
  const topSorted = [];
  const nestedOf = new Map();
  for (const r of rows) {
    if (r.nested) {
      if (!nestedOf.has(r.groupId)) nestedOf.set(r.groupId, []);
      nestedOf.get(r.groupId).push(r);
    } else {
      topSorted.push(r);
    }
  }
  topSorted.sort(cmp);
  const out = [];
  for (const r of topSorted) {
    out.push(r);
    const kids = r.type === 'group' ? nestedOf.get(r.id) : null;
    if (kids) out.push(...kids);
  }

  // 全局池恒顶（不受排序影响）
  const globalRow = (topics || []).find((t) => t.isGlobal);
  if (globalRow) {
    out.unshift({
      type: 'global',
      itemId: GLOBAL_KEY,
      key: GLOBAL_KEY,
      name: globalRow.name || '全局任务',
      topic: globalRow,
      pending: globalRow.pending || 0,
      waiting: !!globalRow.waiting,
      topics: (globalRow.tasks || []).filter((t) => !t.deletedAt),
    });
  }

  return { rows: out, matchCount: q ? matched.length : 0 };
}

// 排序用的稳定标识（收纳盒用它自己，资产用 itemId）
export function rKey(row) {
  if (row.type === 'group') return 'group:' + row.id;
  return itemIdOf(row);
}

/** 任务正文抽一行标题（给侧栏子行用） */
export function taskLabel(t) {
  const text = String(t?.text || '');
  const m = text.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 40);
  const line = text.split('\n').find((l) => l.trim());
  return (line || `#${t?.id}`).trim().slice(0, 40);
}
