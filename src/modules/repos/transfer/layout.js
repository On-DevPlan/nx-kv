// 布局解析（兼容 v2）：JSON → 归一化 layout 对象。
// key 只认两个来源：布局里显式写的，或远程地址归一化。
import { badInput } from '../../../core/errors.js';
import { sanitizeDocRef, withLinkMeta } from '../../docs/docref.js';
import * as service from '../service.js';

export const clean = (v) => String(v || '').trim();
const boardKey = (name) => service.boardKeyOf(name);

export function parseLayout(json) {
  let data;
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
const refOf = (raw) => {
  const d = sanitizeDocRef(raw);
  if (!d) return null;
  return withLinkMeta(d, raw);
};

function normalizeLayout(data) {
  const repos = (data.repos || []).map((r) => {
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
    const out = {
      key,
      keyCustom: r.keyCustom === true,
      name,
      desc: clean(r.desc),
      type: r.type === 'ref' ? 'ref' : 'dev',
    };
    const doc = refOf(r.doc);
    if (doc) out.doc = doc;
    if (remote) out.remote = remote;
    if (Array.isArray(r.remotes)) out.remotes = r.remotes.map(clean).filter(Boolean);
    if (r.notes) out.notes = clean(r.notes);
    return out;
  });

  // key 是全局身份：同一个导入包里出现两次，后续 addRepo 一条会失败、一条会覆盖，
  // 必须在 diff 阶段就拒绝并点名两个仓库，而不是让用户看到半截导入结果。
  const repoKeyByName = new Map();
  const seenKeys = new Map();
  for (const r of repos) {
    const prev = seenKeys.get(r.key);
    if (prev) {
      throw badInput(`导入布局里有重复 key「${r.key}」：仓库「${prev.name || '(未命名)'}」和「${r.name || '(未命名)'}」——同一个 key 只能对应一个仓库，请先改其中一条`);
    }
    seenKeys.set(r.key, r);
    if (r.name) repoKeyByName.set(r.name, r.key);
  }

  const boardsIn = (data.boards || []).map((b) => {
    const name = clean(b?.name);
    const out = {
      key: clean(b?.key) || boardKey(name),
      name,
      desc: clean(b?.desc),
      repos: (Array.isArray(b?.repos) ? b.repos : [])
        .map((e, idx) => {
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
    const repoDocs = {};
    for (const [rk, ref] of Object.entries(b?.repoDocs || {})) {
      const d = refOf(ref);
      if (d) repoDocs[rk] = d;
    }
    if (Object.keys(repoDocs).length) out.repoDocs = repoDocs;
    return out;
  }).filter((b) => b.name);

  // 关系：v2 用 remote 引用，v3 用 key
  const keyByRemote = new Map(repos.filter((r) => r.remote).map((r) => [service.keyFromRemote(r.remote), r.key]));
  const resolveRef = (v) => {
    const s = clean(v);
    if (!s) return '';
    const byKey = repos.find((r) => r.key === service.normalizeKey(s));
    if (byKey) return byKey.key;
    const rk = service.keyFromRemote(s);
    if (rk && keyByRemote.has(rk)) return keyByRemote.get(rk);
    return service.normalizeKey(s);
  };
  const boardKeyByName = new Map((data.boards || []).map((b) => [clean(b?.name), clean(b?.key) || boardKey(clean(b?.name))]));

  const links = (Array.isArray(data.links) ? data.links : []).map((l) => {
    const ref = resolveRef(l?.ref);
    if (!ref) return null;
    const to = (Array.isArray(l.to) ? l.to : []).map((t) => {
      if (t?.repo) return t.note ? { repo: resolveRef(t.repo), note: clean(t.note) } : { repo: resolveRef(t.repo) };
      if (t?.board) {
        const bk = boardKeyByName.get(clean(t.board)) || clean(t.board);
        return t.note ? { board: bk, note: clean(t.note) } : { board: bk };
      }
      return null;
    }).filter(Boolean);
    return to.length ? { ref, to } : null;
  }).filter(Boolean);

  return { ...data, repos, boards: boardsIn, links };
}
