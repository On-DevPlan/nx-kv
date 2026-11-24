// 任务正文头部的 frontmatter —— **只读兼容**（#197 起不再写入）。
//
// #197：任务归属改成库内关联（tasks.repo_topic_id / group_topic_id），正文只存 markdown。
// 这里只剩「读/剥」两个纯函数：渲染旧数据、迁移历史正文时用来剥掉残留的 --- 头。
// 写函数（withFrontmatter / applyGroupFields / preserveFrontmatter）已删除。
//
// 形如文件头的：
//   ---
//   board: b_mvwc2mzrwnlby     # 工作组（看板 id；面板写 id，解析时 id / key / name 都认）
//   project: local/nx-kv      # 归属项目（仓库 key）
//   ---
//   # 标题
//   正文…
//
// 纯函数、零依赖：CLI（node）与面板（浏览器）共用**同一份**实现——
// 两端各写一套正则，必然出现「面板认得出、CLI 认不出」这种最难查的分叉。
//
// 判定从严：起始必须是 `---` 块且至少含一行 key: value，否则当普通正文
// （文档以 `---` 开头的分割线不受影响）。不引 YAML 依赖——只需要平铺标量。

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const KV_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

// 工作组语义键：贴图/光标误插进 FM 时曾把 `board:` 撕成 `oard:` / `d:` 等后缀残留
//（#15 / #23 案例）。解析时把「规范键的真后缀残留」提升回规范键，组面板才能再认到。
const GROUP_KEYS = ['board', 'project', 'boardIntro', 'boardDesc', 'projectIntro', 'projectDesc'] as const;

/** 把被撕碎的 frontmatter 键修回规范名（只升真后缀，不发明新键） */
export function healFrontmatterKeys(fm: unknown): Record<string, string> {
  if (!fm || typeof fm !== 'object') return {};
  const out: Record<string, string> = { ...(fm as Record<string, string>) };
  for (const canon of GROUP_KEYS) {
    if (out[canon] != null && String(out[canon]).trim() !== '') continue;
    let hit: string | null = null;
    for (const k of Object.keys(out)) {
      if (k === canon) continue;
      // 真后缀：board→oard/ard/rd/d；project→roject/…；长度至少 1、严格短于规范名
      if (!canon.endsWith(k) || k.length < 1 || k.length >= canon.length) continue;
      const v = out[k];
      if (v == null || String(v).trim() === '') continue;
      hit = k;
      break;
    }
    if (!hit) continue;
    out[canon] = String(out[hit] ?? '');
    delete out[hit];
  }
  return out;
}

/** 解析正文头部的 frontmatter；没有或不是 frontmatter → 空对象 */
export function parseFrontmatter(src: unknown): Record<string, string> {
  const m = String(src ?? '').match(FM_RE);
  if (!m) return {};
  const out: Record<string, string> = {};
  let hits = 0;
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = line.match(KV_RE);
    if (kv) {
      out[kv[1] ?? ''] = (kv[2] ?? '').trim();
      hits += 1;
    }
  }
  return hits ? healFrontmatterKeys(out) : {};
}

/** 去掉正文头部的 frontmatter（不是 frontmatter 时原样返回） */
export function stripFrontmatter(src: unknown): string {
  return String(src ?? '').replace(FM_RE, (block: string, inner: string) => {
    const kv = String(inner || '').split(/\r?\n/).some((l) => KV_RE.test(l));
    return kv ? '' : block;
  });
}
