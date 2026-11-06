// 文档地址 / 双链解析 / 快搜的**原型**（纯函数，不接数据库）。
// 验证 entities.sql 里的命名空间规则能落地，并给出前缀快搜的排序口径。
//
// 地址规范：docs 根下的相对路径，第一段是命名空间（repo / group / ext）。
//   repo/github.com/acme/web/docs/api.md
//   group/frontend/spec.md
//   ext/D:/vault/notes/idea.md
//
// ── 关于「点」───────────────────────────────────────────────────────────
// 地址里出现点**不会**影响解析：分段是按 `/` 切的，只有**整段等于** '.' 或 '..'
// 才当相对标记。所以 `github.com`、`v1.2.3.md`、`a..b.md` 都是普通名字。
// 真正要处理的是这四种边角：
//   1. `..` 越过根（repo/ group/ ext/）→ 必须报错，不能静默 pop 成别的路径
//   2. 每段尾部的点和空格 —— Windows 落盘时会吃掉，登记与解析必须同口径
//   3. Unicode 组合形式（macOS 存 NFD，Windows 存 NFC）→ 统一 NFC
//   4. 大小写 —— Windows/macOS 文件系统不区分，Linux 区分。默认按**不区分**处理，
//      否则同一份关系换台机器就指不到文件

const ROOTS = ['repo', 'group', 'ext'];

/** 单段归一：NFC + 去掉 Windows 会吃掉的尾部点和空格。 */
function normSegment(seg) {
  return seg.normalize('NFC').replace(/[. ]+$/, '');
}

/** 比较用的键：NFC + 小写（文件系统口径）。存储仍保留原样，显示才对。 */
export function compareKey(addr) {
  return String(addr).normalize('NFC').toLowerCase();
}

/**
 * 地址归一。越界返回 null（调用方必须当成失败，不能当普通字符串继续用）。
 * `..` 只能在命名空间根之下回退，退到根外面就是错的。
 */
export function normalizeAddr(addr) {
  const raw = String(addr).replace(/\\/g, '/').split('/');
  const out = [];
  for (const seg of raw) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;                       // 开头就 .. → 越界
      const last = out[out.length - 1];
      if (ROOTS.includes(last.toLowerCase())) return null; // 不许吃掉命名空间根
      out.pop();
      continue;
    }
    const s = normSegment(seg);
    if (!s) return null;                                  // 纯点/空格段 → 非法
    out.push(s);
  }
  return out.length ? out.join('/') : null;
}

/** 从 `[[...]]` 或 `![](...)` 的内部文本里拆出 地址 / 别名 / 锚点。 */
export function parseLinkText(inner) {
  let s = String(inner).trim();
  let alias = '';
  const bar = s.indexOf('|');
  if (bar >= 0) { alias = s.slice(bar + 1).trim(); s = s.slice(0, bar).trim(); }
  let anchor = '';
  const hash = s.indexOf('#');
  if (hash >= 0) { anchor = s.slice(hash + 1).trim(); s = s.slice(0, hash).trim(); }
  return { target: s, alias, anchor };
}

/** 已登记地址的索引。查询一律走 compareKey，避免大小写/编码差异。 */
export function makeCatalog(addresses, owners = []) {
  const list = [];
  const byKey = new Map();
  for (const a of addresses) {
    const n = normalizeAddr(a);
    if (!n) continue;
    list.push(n);
    byKey.set(compareKey(n), n);
  }
  return { list, byKey, owners };
}

/** 地址属于哪个 owner 前缀（'repo/github.com/acme/web'）。最长 key 优先。 */
export function ownerPrefixOf(addr, owners) {
  const key = compareKey(addr);
  const hit = owners
    .map((k) => {
      const root = k.startsWith('group/') ? 'group' : 'repo';
      return `${root}/${k}`;
    })
    .filter((p) => {
      const k = compareKey(p);
      return key === k || key.startsWith(k + '/');
    })
    .sort((a, b) => b.length - a.length)[0];
  return hit || '';
}

function dirOf(addr) {
  const i = addr.lastIndexOf('/');
  return i < 0 ? '' : addr.slice(0, i);
}

/**
 * 把一处引用解析成地址。addr 为 null 表示没解析出来，reason 说明为什么。
 */
export function resolveLink(inner, srcAddr, catalog) {
  const { target, alias, anchor } = parseLinkText(inner);
  const no = (reason) => ({ addr: null, reason, alias, anchor });
  if (!target) return no('empty');
  if (/^https?:\/\//i.test(target)) return no('external');

  const src = normalizeAddr(srcAddr);
  if (!src) return no('bad-src');

  // 查表前一律归一：拼出来的地址里可能还留着 `./`，不归一就查不到。
  const lookup = (addr) => {
    const n = normalizeAddr(addr);
    return n ? catalog.byKey.get(compareKey(n)) || null : null;
  };
  const hit = (addr) => (lookup(addr) ? { addr: lookup(addr), alias, anchor, reason: 'ok' } : no('missing'));

  const norm = normalizeAddr(target);
  if (norm === null) return no('escape');                 // .. 越界

  // 1. 绝对地址
  if (ROOTS.includes(compareKey(norm).split('/')[0])) return hit(norm);

  // 2. ./ 或 ../ 相对当前文档目录
  if (target.startsWith('./') || target.startsWith('../')) return hit(`${dirOf(src)}/${target}`);

  // 3. 裸名：同目录 → 同 owner → 全局唯一
  const sameDir = normalizeAddr(`${dirOf(src)}/${target}`);
  const r1 = lookup(sameDir);
  if (r1) return compareKey(r1) === compareKey(src) ? no('self') : { addr: r1, alias, anchor, reason: 'ok' };

  const tKey = compareKey(norm);
  const own = compareKey(ownerPrefixOf(src, catalog.owners));
  if (own) {
    const inOwner = catalog.list.filter((a) => {
      const k = compareKey(a);
      return k !== compareKey(src) && k.startsWith(own + '/') && (k === `${own}/${tKey}` || k.endsWith('/' + tKey));
    });
    if (inOwner.length === 1) return { addr: inOwner[0], alias, anchor, reason: 'ok' };
    if (inOwner.length > 1) return no('ambiguous');
  }

  const all = catalog.list.filter((a) => compareKey(a) !== compareKey(src) && compareKey(a).endsWith('/' + tKey));
  if (all.length === 1) return { addr: all[0], alias, anchor, reason: 'ok' };
  return no(all.length ? 'ambiguous' : 'missing');
}

/** 扫一段 md，产出该文档的全部引用（即 ref_relations 的行）。 */
export function scanMarkdown(text, srcAddr, catalog) {
  const out = [];
  let pos = 0;
  const push = (inner, type) => {
    const r = resolveLink(inner, srcAddr, catalog);
    out.push({
      type, raw: String(inner).trim(), position: pos++,
      dst: r.addr, anchor: r.anchor || '', reason: r.reason,
      state: r.addr ? 'resolved' : (r.reason === 'external' ? 'external' : 'missing'),
    });
  };
  const re = /!\[([^\]]*)\]\(([^)]+)\)|\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[2] !== undefined) push(m[2], 'embeds');
    else push(m[3], 'links');
  }
  return out;
}

// ── 快搜（Obsidian quick switcher 那种） ────────────────────────────────
// 打分只解决**排序**，不解决"能不能搜到"：能搜到靠的是 SQL 的范围扫描，
// 见 entities.sql 里那块注释（LIKE 'x%' 在 SQLite 里不走索引，范围比较才走）。

function subsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) { if (ch === needle[i]) i++; if (i === needle.length) return true; }
  return needle.length === 0;
}

function scoreOne(addr, term) {
  const a = compareKey(addr);
  const base = a.slice(a.lastIndexOf('/') + 1);
  const segs = a.split('/');
  if (base === term) return 100;
  if (base.startsWith(term)) return 90 - Math.min(base.length - term.length, 20);
  if (a.startsWith(term)) return 75;
  if (segs.some((s) => s.startsWith(term))) return 65;
  if (base.includes(term)) return 50;
  if (subsequence(term, base)) return 35;
  if (subsequence(term, a)) return 20;
  return 0;
}

/**
 * 快搜。空格分词，全部命中才算（与 Obsidian 一致的"与"语义）。
 * 排序：文件名精确 > 文件名前缀 > 全路径前缀 > 某段前缀 > 文件名包含 > 子序列。
 * 同分时短地址优先（少跳几层目录）。
 */
export function quickOpen(query, catalog, limit = 10) {
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return catalog.list
    .map((addr) => {
      let total = 0;
      for (const t of terms) {
        const s = scoreOne(addr, t);
        if (!s) return null;
        total += s;
      }
      return { addr, score: total };
    })
    .filter(Boolean)
    .sort((x, y) => y.score - x.score || x.addr.length - y.addr.length || (x.addr < y.addr ? -1 : 1))
    .slice(0, limit);
}
