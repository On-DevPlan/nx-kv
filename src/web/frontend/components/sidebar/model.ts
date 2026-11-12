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
import { projectPending, isPendingRow, taskInBoard } from '../../modules/board/board-view.js';
import type { BoardRow, LocalTask, LocalTopic, Prefs, RepoRow } from '../../types.js';

export const GLOBAL_KEY = '__GLOBAL__';

/**
 * 侧栏一行（仓库 / 看板 / 全局池）。字段按 type 选择性出现：
 * 仓库行带 topicKey/cwd/topics；看板行带 count/members；全局行带 topic。
 * 值全部来自 /api 的登记与队列数据，故按「可选 + 宽松」收。
 */
export interface SideRow {
  type: 'repo' | 'board' | 'global';
  /** 行身份（仓库 key / 看板 id / GLOBAL_KEY） */
  key: string;
  id?: string;
  repoId?: string;
  /** 任务队列主题 key（工作台深链 #/dir/<topicKey>） */
  topicKey?: string;
  name: string;
  icon?: string;
  cwd?: string;
  desc?: string;
  boards?: Array<{ key?: string; id?: string }>;
  summary?: string;
  /** 待领取数（按走向重数；每行都有） */
  pending: number;
  /** 有 agent 等待回填（每行都有） */
  waiting: boolean;
  /**
   * 等待窗口的截止时刻（epoch ms；#182 侧栏倒计时用）。
   * 一行可能挂着多个队列的等待 —— 取**最早**结束的那个，它最先需要处理。
   * 0 / 缺省 = 没有在等（或数据太旧拿不到截止时刻）。
   */
  waitingDeadlineMs?: number;
  /** 看板成员数 */
  count?: number;
  members?: string[];
  /** 归属看板 id（仓库行平铺时为空串） */
  groupId?: string;
  topics?: LocalTopic[];
  topic?: LocalTopic;
  tasks?: LocalTask[];
}

/** buildTree 的返回面。 */
export interface SideTree {
  rows: SideRow[];
  matchCount: number;
}

// 兄弟模块类型桥：board-view 尚未类型化（`tasks = []` 默认值把形参推成 never[]），
// 这里按实际契约声明一次——它毕业成强类型后此桥退化为恒等。
const projectPendingBridge = projectPending as unknown as (tasks: LocalTask[] | undefined) => number;

// ─── 等待窗口（#182：侧栏等待标记要显示时间）─────────────────────────
//
// 服务端 topic 上已经有两个真相：`waiting`（僵尸标志已抹平，见 task-view.ts 的
// isLiveWaiting）与 `waitingUntilMs`（毫秒精度截止时刻；老数据只有 waitingUntil 字符串）。
// 这里只做「取数 / 取最早 / 格式化」，**不自己判定等待是否还活着**——那是后端的事，
// 前端再判一遍必然与它分叉。
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/** `"YYYY-MM-DD HH:mm:ss"`（本地时区）→ epoch ms；解析不了返回 0。 */
function stampMs(v: unknown): number {
  const m = STAMP_RE.exec(String(v ?? '').trim());
  if (!m) return 0;
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime();
}

/** 一个主题的等待截止时刻（epoch ms）；没在等 / 拿不到 → 0。 */
function topicDeadlineMs(t: LocalTopic | null | undefined): number {
  if (!t || !t.waiting) return 0;
  const ms = Number(t.waitingUntilMs) || 0;
  if (ms > 0) return ms;
  return stampMs(t.waitingUntil);
}

/** 一组截止时刻里**最早**的那个（0 = 一个都没有）。 */
function earliestDeadline(list: unknown[]): number {
  let min = 0;
  for (const v of list) {
    const d = Number(v) || 0;
    if (d > 0 && (!min || d < min)) min = d;
  }
  return min;
}

/**
 * 等待倒计时的人读文本（侧栏等待标记）：`剩 4:32` / `剩 1:02:03`；
 * 已过截止 → `已超时`（服务端通常已把 waiting 抹平，这里只是兜底一帧）。
 *
 * @param deadlineMs 截止时刻（epoch ms）
 * @param nowMs      当前时刻（组件每秒推进）
 */
export function fmtWaitLeft(deadlineMs: unknown, nowMs: number = Date.now()): string {
  const d = Number(deadlineMs) || 0;
  if (!d) return '';
  const left = d - nowMs;
  if (left <= 0) return '已超时';
  const s = Math.ceil(left / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `剩 ${h}:${String(m).padStart(2, '0')}:${ss}` : `剩 ${m}:${ss}`;
}

/** 截止时刻的钟点（tooltip 用）：`10:31:02`；拿不到 → ''。 */
export function fmtDeadlineClock(deadlineMs: unknown): string {
  const d = Number(deadlineMs) || 0;
  if (!d) return '';
  const t = new Date(d);
  return [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * 构建侧边栏行模型。
 * @param repos   开发仓库（type != ref），每条带 id / name / key / path / boards[]
 * @param boards  看板，每条带 id / name / desc / repos[]
 * @param topics  本机任务队列（按 cwd 匹配仓库），每条可带 repo
 * @param prefs   UI 偏好（order / hidden / folded）
 * @param kw      搜索关键词（'' = 不过滤）
 * @returns {{rows: Array, matchCount: number}}
 */
export function buildTree(
  repos: RepoRow[] | null | undefined,
  boards: BoardRow[] | null | undefined,
  topics: LocalTopic[] | null | undefined,
  prefs: Partial<Prefs>,
  kw = ''
): SideTree {
  const q = String(kw || '').trim().toLowerCase();
  const hidden = new Set<string>(prefs.hidden || []);

  // 仓库 → 任务队列：按路径归位。topic.repo 由服务端按 cwd 匹配登记得到；
  // 没匹配上的（目录没登记）不单独成行——它不属于任何仓库，也不该有自己的入口。
  const topicsOf = new Map<string, LocalTopic[]>();
  for (const t of topics || []) {
    if (t.isGlobal) continue;
    const rid = t.repo && t.repo.id;
    if (!rid) continue;
    const bucket = topicsOf.get(rid);
    if (bucket) bucket.push(t);
    else topicsOf.set(rid, [t]);
  }

  // 仓库行：任务数 = 该仓库下所有 topic 的待领取之和
  //
  // **两种 key 别混**：
  //   key      = 仓库身份（归一化远程地址派生）——排序、隐藏、看板归属都用它；
  //   topicKey = 任务队列主题的 key（sha1(目录名)）——工作台深链 #/dir/<topicKey> 用它。
  // 两者不是一回事：仓库 key 跨机稳定，topic key 是本机队列的身份。
  const repoRows: SideRow[] = (repos || [])
    .filter((r) => !hidden.has(r.key || r.id))
    .map((r) => {
      const ts = topicsOf.get(r.id) || [];
      // 仓库行默认指向第一个队列主题（ts 非空时必存在）
      const first = ts[0];
      return {
        type: 'repo',
        key: r.key || r.id,
        repoId: r.id,
        topicKey: first ? first.key : '',
        name: r.name,
        icon: r.icon || '',        // 项目图标（emoji/单字符；空 = 默认文件夹图标）
        cwd: r.path || '',
        desc: r.desc || '',
        boards: r.boards || [],
        summary: ts.map((t) => t.summary).filter(Boolean).join(' / '),
        // 仓库行徽标 = **项目走向**的待领取之和（#85：组任务走组页，不在项目侧
        // 计数。服务端 topic.pending 是队列真相、含组任务——面板侧按走向重数）
        pending: ts.reduce((n, t) => n + projectPendingBridge(t.tasks), 0),
        waiting: ts.some((t) => t.waiting),
        // 等待标记的倒计时用它（多队列取最早结束的那个窗口）
        waitingDeadlineMs: earliestDeadline(ts.map(topicDeadlineMs)),
        topics: ts,
      };
    });
  const byKey = new Map<string, SideRow>(repoRows.map((r): [string, SideRow] => [r.key, r]));

  // 命中：仓库名 / key / 路径 / 描述 / 任务现状
  // 入参放宽到「带这些字段的行」：仓库行与看板行（BoardRow）都走同一套命中判定
  const hit = (r: { name?: string; key?: string; cwd?: string; desc?: string; summary?: string }) =>
    !q ||
    String(r.name || '').toLowerCase().includes(q) ||
    String(r.key || '').toLowerCase().includes(q) ||
    String(r.cwd || '').toLowerCase().includes(q) ||
    String(r.desc || '').toLowerCase().includes(q) ||
    String(r.summary || '').toLowerCase().includes(q);

  const matched = repoRows.filter(hit);

  const rows: SideRow[] = [];
  const boardList = boards || [];

  // 看板行（分组）：**组是叶子，不再铺成员子行**（2026-11-03 语义化改版）。
  // 侧栏操作的对象是「工作组」，不是组下的某个文件——成员清单与项目切换
  // 收进组详情面板（#/group/<id>，面板内下拉选项目）。
  // 组行徽标 = 成员队列里**指向本组**的组任务的待领取数（#85 两种走向，与组页
  // 「本组任务」同口径）。以前按成员队列整队求和：把成员项目的纯项目任务也算成
  // 「组内待领取」，同一仓库属于两组时还会被两组重复计数。
  for (const b of boardList) {
    // **显示编排**：隐藏的项目组也不出行（之前只过滤了仓库行——
    // 于是「勾掉项目组」在侧栏看着完全没反应，任务 #61 验收反馈实测）。
    if (hidden.has(b.key || b.id)) continue;
    // 外部数据边界：/api/boards 的成员表（{key,id}），形状由后端 schema 决定
    const memberRepos = (b.repos || []) as Array<{ key?: string; id?: string }>;
    // 看板成员按 key 存；本地未拥有的占位成员没有登记，不成行（只占组里的位置）
    const members = memberRepos
      .map((m) => (m.key ? byKey.get(m.key) : undefined))
      .filter((m): m is SideRow => !!m);
    // 搜索时：命中成员也算命中这个组（组行代表它的全部成员）
    const memberHit = members.some(hit);
    if (q && !hit(b) && !memberHit) continue;
    rows.push({
      type: 'board',
      id: b.id,
      key: b.key || b.id,
      name: b.name,
      desc: b.desc || '',
      count: memberRepos.length,
      pending: members.reduce(
        (n, m) =>
          n + (m.topics || []).reduce((k, t) => k + (t.tasks || []).filter((x) => taskInBoard(x, b)).filter(isPendingRow).length, 0),
        0
      ),
      waiting: members.some((m) => m.waiting),
      // 组行的等待标记看成员的窗口（取最早结束的那个）
      waitingDeadlineMs: earliestDeadline(members.map((m) => m.waitingDeadlineMs)),
      members: memberRepos.map((m) => m.key ?? ''),
    });
  }

  // **仓库是独立的模块，项目组只是指向它的指针**（任务 #61 反馈）：
  //   - 组行 = 指针（聚合入口），**不铺成员**：组下面不列它指向的仓库；
  //   - 仓库行 = 模块：**每个仓库一行**，且**永远不因为被组链接就消失**。
  // 所以仓库行平铺（不进任何组的桶、不缩进），组行仍是叶子。
  //
  // 「显示哪些」由设置面板「侧栏显示」一栏编排（隐藏清单走 prefs.hidden）。
  for (const r of matched) {
    rows.push({ ...r, groupId: '' });
  }

  // 排序：用户编过的顺序在前（order 存 key），其余按名称自然序
  //
  // **分组要读成组**：看板的成员行紧跟在该看板行下面，不跟未归组的仓库混在
  // 全局名称序里——否则「nx 一类」看着只是一堆缩进的行，组不成类。
  // 桶 = 看板（行与成员同桶，成员在看板行之后）；未归组的仓库排在所有桶之后。
  const orderIdx = new Map<string, number>(
    (prefs.order || []).map((k, i): [string, number] => [k, i])
  );
  const bucketOf = new Map<string, number>(); // boardId -> 桶序号
  boardList.forEach((b, i) => bucketOf.set(b.id, i));
  const looseBucket = boardList.length; // 未归组的仓库
  const bucketOfRow = (r: SideRow): number => {
    if (r.type === 'board') return bucketOf.get(r.id ?? '') ?? looseBucket;
    if (r.groupId) return bucketOf.get(r.groupId) ?? looseBucket;
    return looseBucket;
  };
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ia = orderIdx.has(rKey(a.r)) ? (orderIdx.get(rKey(a.r)) ?? Infinity) : Infinity;
      const ib = orderIdx.has(rKey(b.r)) ? (orderIdx.get(rKey(b.r)) ?? Infinity) : Infinity;
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
  const out: SideRow[] = [];
  if (globalRow) {
    out.push({
      type: 'global',
      key: GLOBAL_KEY,
      name: globalRow.name || '全局任务',
      topic: globalRow,
      pending: globalRow.pending || 0,
      waiting: !!globalRow.waiting,
      waitingDeadlineMs: topicDeadlineMs(globalRow),
      // 历史形态：全局池行把任务数组放在 topics 上（TaskChildren 读的是 tasks）——
      // 此处只做形状收口，不改数据落点，免得顺手改了侧栏的可见行为。
      topics: (globalRow.tasks || []).filter((t) => !t.deletedAt) as unknown as LocalTopic[],
    });
  }
  out.push(...sorted);

  // 搜索计数按**可见行**算：组行（代表全体成员）+ 未归组仓库行——
  // 成员子行已不渲染，把它算进「N 个匹配」会数出看不见的行（全局池行也不算）。
  return { rows: out, matchCount: q ? out.filter((r) => r.type === 'board' || (r.type === 'repo' && !r.groupId)).length : 0 };
}

// 排序用的稳定标识：仓库行用全局唯一的 key，看板行用看板 id
export function rKey(row: SideRow): string {
  return row.type === 'board' ? 'board:' + String(row.id) : row.key;
}

/** 任务正文抽一行标题（给侧栏子行用）；带 frontmatter 的任务先剥掉再取 */
export function taskLabel(t: LocalTask | null | undefined): string {
  const text = stripFrontmatter(String(t?.text || ''));
  const m = text.match(/^#\s+(.+)$/m);
  if (m && m[1]) return m[1].trim().slice(0, 40);
  const line = text.split('\n').find((l) => l.trim());
  return (line || `#${t?.id}`).trim().slice(0, 40);
}
