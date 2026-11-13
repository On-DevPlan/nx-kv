// 布局解析（兼容 v2）：JSON → 归一化 layout 对象。
// key 只认两个来源：布局里显式写的，或远程地址归一化。
import { badInput } from '../../../core/errors.js';
import { sanitizeDocRef, withLinkMeta } from '../../docs/docref.js';
import * as service from '../service.js';

export const clean = (v: unknown): string => String(v || '').trim();
const boardKey = (name: string): string => service.boardKeyOf(name);

/** 布局里的仓库条目（归一化后）。 */
export interface LayoutRepo {
  key: string;
  keyCustom: boolean;
  name: string;
  desc: string;
  type: string;
  doc?: any;
  docLinks?: any[];
  remote?: string;
  remotes?: string[];
  notes?: string;
}

/** 布局里看板的成员条目（导入文件里可能带 name/remote/desc/type 线索，归一化只留 key/note）。 */
export interface LayoutBoardRepoEntry {
  key: string;
  note: string;
  name?: string;
  remote?: string;
  desc?: string;
  type?: string;
}

/** 布局里的看板条目（归一化后）。 */
export interface LayoutBoard {
  key: string;
  name: string;
  desc: string;
  repos: LayoutBoardRepoEntry[];
  doc?: any;
  docLinks?: any[];
  repoDocs?: Record<string, any>;
}

/** 关系的目标端：ref → 组（board）或 ref → 单个开发仓库（repo）。 */
export interface LayoutLinkTarget {
  repo?: string;
  board?: string;
  note?: string;
}

/** 一条参考关系：ref key → 多个目标。 */
export interface LayoutLink {
  ref: string;
  to: LayoutLinkTarget[];
}

/** 布局里被引用的 ref 元数据（v8：没有 rel / 路径，只有 id + locator + desc）。 */
export interface LayoutRef {
  refId: string;
  origin: string;
  locator: string;
  desc: string;
}

/** 归一化布局（v5：refs 数组 + 文档绑定只认 refId；字段透传）。 */
export interface Layout {
  version?: number;
  repos: LayoutRepo[];
  boards: LayoutBoard[];
  links: LayoutLink[];
  refs?: LayoutRef[];
  warnings?: string[];
  [field: string]: unknown;
}

export function parseLayout(json: unknown): Layout {
  let data: any;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw badInput('布局 JSON 解析失败（请给 repo export 的完整输出）');
  }
  const incoming = Array.isArray(data?.repos) ? data.repos : null;
  if (!incoming) throw badInput('JSON 里没有 repos 数组 —— 认 repo export 的 v3 / v2 格式');
  return normalizeLayout(data);
}

// v2 → v3：没有 key 的条目用 remote/name 现算，让老导出文件也能导入。
// v3 → v4：文档绑定字段做形状归一（非法形状丢弃；note/tag 注解原样保留）。
const refOf = (raw: unknown): any => {
  const d = sanitizeDocRef(raw);
  if (!d) return null;
  // sanitizeDocRef 通过即说明 raw 是 DocRef 形状对象（note/tag 注解原样带出）
  return withLinkMeta(d, raw as { note?: unknown; tag?: unknown });
};

function normalizeLayout(data: any): Layout {
  const repos: LayoutRepo[] = (data.repos || []).map((r: any): LayoutRepo => {
    const remote = clean(r.remote);
    const name = clean(r.name);
    // key 只认两个来源：布局里显式写的，或远程地址归一化。
    // **不再按 name 生成 local/<name>** —— 导入是最需要身份稳定的场景，
    // 按名字猜出来的 key 一旦和本地已有登记撞上，就会被当成同一个仓库覆盖。
    const key = clean(r.key) || service.deriveKey({ name, remote });
    if (!key) {
      throw badInput(
        `导入布局里的仓库「${name || '(未命名)'}」缺少 key：没有远程地址时必须显式补上 key（有远程地址会自动归一化为 host/owner/repo）`
      );
    }
    const out: LayoutRepo = {
      key,
      keyCustom: r.keyCustom === true,
      name,
      desc: clean(r.desc),
      type: r.type === 'ref' ? 'ref' : 'dev',
    };
    const doc = refOf(r.doc);
    if (doc) out.doc = doc;
    const repoLinks = (Array.isArray(r.docLinks) ? r.docLinks : []).map(refOf).filter(Boolean);
    if (repoLinks.length) out.docLinks = repoLinks;
    if (remote) out.remote = remote;
    if (Array.isArray(r.remotes)) out.remotes = r.remotes.map(clean).filter(Boolean);
    if (r.notes) out.notes = clean(r.notes);
    return out;
  });

  // key 是全局身份：同一个导入包里出现两次，后续 addRepo 一条会失败、一条会覆盖，
  // 必须在 diff 阶段就拒绝并点名两个仓库，而不是让用户看到半截导入结果。
  const repoKeyByName = new Map<string, string>();
  const seenKeys = new Map<string, LayoutRepo>();
  for (const r of repos) {
    const prev = seenKeys.get(r.key);
    if (prev) {
      throw badInput(`导入布局里有重复 key「${r.key}」：仓库「${prev.name || '(未命名)'}」和「${r.name || '(未命名)'}」——同一个 key 只能对应一个仓库，请先改其中一条`);
    }
    seenKeys.set(r.key, r);
    if (r.name) repoKeyByName.set(r.name, r.key);
  }

  const boardsIn: LayoutBoard[] = (data.boards || []).map((b: any): LayoutBoard => {
    const name = clean(b?.name);
    const out: LayoutBoard = {
      key: clean(b?.key) || boardKey(name),
      name,
      desc: clean(b?.desc),
      repos: (Array.isArray(b?.repos) ? b.repos : [])
        .map((e: any, idx: number): LayoutBoardRepoEntry => {
          const entry = typeof e === 'string' ? { key: clean(e) } : e;
          const rawKey = clean(entry?.key);
          const byRemote = entry?.remote ? service.keyFromRemote(clean(entry.remote)) : '';
          // 只有名字的成员：如果布局里恰好有同名仓库，就沿用它显式声明的 key；
          // 否则没有身份可用 → 拒绝（不按名字猜 local/<name>，否则会悄悄造 key）。
          const key = rawKey || byRemote || repoKeyByName.get(clean(entry?.name)) || '';
          if (!key) {
            throw badInput(
              `导入布局里看板「${name || '(未命名)'}」的第 ${idx + 1} 个成员缺少 key/远程地址：请在该仓库条目或成员上写明 key`
            );
          }
          return { key, note: clean(entry?.note) };
        })
        .filter(Boolean),
    };
    const doc = refOf(b?.doc);
    if (doc) out.doc = doc;
    const docLinks = (Array.isArray(b?.docLinks) ? b.docLinks : []).map(refOf).filter(Boolean);
    if (docLinks.length) out.docLinks = docLinks;
    const repoDocs: Record<string, any> = {};
    for (const [rk, ref] of Object.entries(b?.repoDocs || {})) {
      const d = refOf(ref);
      if (d) repoDocs[rk] = d;
    }
    if (Object.keys(repoDocs).length) out.repoDocs = repoDocs;
    return out;
  }).filter((b: LayoutBoard) => b.name);

  // 关系：v2 用 remote 引用，v3 用 key
  const keyByRemote = new Map(repos.filter((r) => r.remote).map((r): [string, string] => [service.keyFromRemote(r.remote), r.key]));
  const resolveRef = (v: unknown): string => {
    const s = clean(v);
    if (!s) return '';
    const byKey = repos.find((r) => r.key === service.normalizeKey(s));
    if (byKey) return byKey.key;
    const rk = service.keyFromRemote(s);
    if (rk && keyByRemote.has(rk)) return keyByRemote.get(rk)!;
    return service.normalizeKey(s);
  };
  const boardKeyByName = new Map<string, string>((data.boards || []).map((b: any): [string, string] => [clean(b?.name), clean(b?.key) || boardKey(clean(b?.name))]));

  const links: LayoutLink[] = (Array.isArray(data.links) ? data.links : []).map((l: any): LayoutLink | null => {
    const ref = resolveRef(l?.ref);
    if (!ref) return null;
    const to: LayoutLinkTarget[] = (Array.isArray(l.to) ? l.to : []).map((t: any): LayoutLinkTarget | null => {
      if (t?.repo) return t.note ? { repo: resolveRef(t.repo), note: clean(t.note) } : { repo: resolveRef(t.repo) };
      if (t?.board) {
        const bk = boardKeyByName.get(clean(t.board)) || clean(t.board);
        return t.note ? { board: bk, note: clean(t.note) } : { board: bk };
      }
      return null;
    }).filter(Boolean);
    return to.length ? { ref, to } : null;
  }).filter(Boolean) as LayoutLink[];

  return { ...data, repos, boards: boardsIn, links, refs: normalizeRefs(data.refs) };
}

/** refs 数组归一：只留 refId + origin / locator / desc。 */
function normalizeRefs(raw: unknown): LayoutRef[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutRef[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const refId = clean(x && x.refId);
    if (!refId || seen.has(refId)) continue;
    seen.add(refId);
    out.push({
      refId,
      origin: x && x.origin === 'external' ? 'external' : 'own',
      locator: clean(x && x.locator),
      desc: clean(x && x.desc),
    });
  }
  return out;
}
