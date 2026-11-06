// 行形状适配：SQLite 行（epoch ms + ext JSON）⇄ 视图用的 JSON 形态对象。
//
// 与 localtask/repo/rows.js 同一思路：T05 只换存储不动行为。service/boards/
// ref/transfer 与 docs 域（经 repos-bridge）消费的都是 JSON 形态的 store
// （`{repos:[...], boards:[...]}`，字符串时间戳、r_xxx/b_xxx id、docLinks…），
// 让 repo 统一在边界上做行↔对象转换，调用方与断言一行不用改。
//
// 字段映射（旧 JSON 字段 ↔ 列），新 schema 没有列的落 ext（G4/G5 的裁决）：
//   repo.id          → ext.ext_legacy_id          （r_xxx，本机行主键的取证）
//   repo.desc        → repos.description
//   repo.notes       → ext.ext_notes              （与 description 是两个字段）
//   repo.icon        → ext.ext_icon
//   repo.remotes[]   → ext.ext_remotes            （remote 是归一化主键来源）
//   repo.keyCustom   → ext.ext_key_custom
//   repo.keyUpdatedAt→ ext.ext_key_updated_at
//   repo.linked[]    → ext.ext_linked             （ref↔repo/board 关系；import 只
//                                               留了 kind='ref'，旧键名 ext_linked_refs 兼容读）
//   repo.getLoop     → ext.ext_getloop
//   repo.doc/.docLinks → ext.ext_doc / ext.ext_doc_links
//   repo.type(dev/ref) → ext.ext_legacy_type        （列 type 只二分 repo/group）
//   repo.addedAt/.updatedAt（ISO UTC）→ created_at / updated_at（epoch ms）
//   board.id         → ext.ext_legacy_id           （b_xxx）
//   board.repoKeys[] → repo_group_members 行（真实成员）+ ext.ext_placeholders（占位）
//   board.repoNotes  → repo_group_members.note / 占位条目的 note
//   board.repoHints  → ext.ext_repo_hints
//   board.doc/.docLinks/.repoDocs → ext.ext_doc / ext_doc_links / ext_repo_docs
//   board 的 key      → repos.key（冻结的 group/<slug>；JSON 形态多带一个 key 字段）
//
// **组的成员身份规则**：repo_group_members 两端都是 repos.key 外键，
// 「本地未拥有」的占位成员进不了表（FK 拒绝）→ 落 ext.ext_placeholders，
// 读时按 pos 与真实成员合并还原 JSON 数组序。
import { anyTimeMs } from '../../../core/db/time.js';

/** 哨兵仓库：迁移时承载「对不上真实仓库」的队列；不是用户登记的仓库。 */
export const SENTINEL_REPO_KEY = '__unbound__';

/** repos.ext 的键名（type='repo' 行）。 */
export const REPO_EXT = Object.freeze({
  LEGACY_ID: 'ext_legacy_id',
  LEGACY_TYPE: 'ext_legacy_type',
  NOTES: 'ext_notes',
  ICON: 'ext_icon',
  REMOTES: 'ext_remotes',
  KEY_CUSTOM: 'ext_key_custom',
  KEY_UPDATED_AT: 'ext_key_updated_at',
  LINKED: 'ext_linked',
  /** T01 导入器写的旧键名（只留 kind='ref'）；读时兜底，写一律用 LINKED。 */
  LINKED_REFS: 'ext_linked_refs',
  GETLOOP: 'ext_getloop',
  DOC: 'ext_doc',
  DOC_LINKS: 'ext_doc_links',
});

/** repos.ext 的键名（type='group' 行）。 */
export const GROUP_EXT = Object.freeze({
  LEGACY_ID: 'ext_legacy_id',
  REPO_HINTS: 'ext_repo_hints',
  PLACEHOLDERS: 'ext_placeholders',
  DOC: 'ext_doc',
  DOC_LINKS: 'ext_doc_links',
  REPO_DOCS: 'ext_repo_docs',
});

export function parseExt(raw) {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export const jsonText = (v) => JSON.stringify(v === undefined ? null : v);

/** epoch ms → ISO UTC 串（legacy addedAt/updatedAt 的形状）；非法 → 空串。 */
export const msToIso = (ms) => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : '';
};

/** 「ISO / 本地串 / 数字」→ epoch ms；解析不出 → fallback。 */
export const msOfAny = (v, fallback) => {
  const n = anyTimeMs(v, NaN);
  return Number.isFinite(n) ? n : fallback;
};

/** 去掉 undefined 值的键（ext 里不落 null 占位，往返零漂移）。 */
export function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** DB repos 行（type='repo'）→ JSON 形态登记对象。 */
export function repoRowToStore(row) {
  const ext = parseExt(row.ext);
  const legacyRefs = Array.isArray(ext[REPO_EXT.LINKED_REFS]) ? ext[REPO_EXT.LINKED_REFS] : [];
  const out = {
    // 本机行主键（r_xxx）：迁移取证 + 定位入口（updateRepo 按 id 找）
    id: String(ext[REPO_EXT.LEGACY_ID] || ''),
    key: String(row.key || ''),
    keyCustom: !!ext[REPO_EXT.KEY_CUSTOM],
    name: String(row.name || ''),
    icon: String(ext[REPO_EXT.ICON] || ''),
    path: String(row.path || ''),
    desc: String(row.description || ''),
    notes: String(ext[REPO_EXT.NOTES] || ''),
    // 列 type 只二分 repo/group；dev/ref 存 ext（登记语义，前端与导出按它分支）
    type: String(ext[REPO_EXT.LEGACY_TYPE] || 'dev'),
    remote: String(row.remote || ''),
    remotes: Array.isArray(ext[REPO_EXT.REMOTES]) ? ext[REPO_EXT.REMOTES].map(String) : [],
    keyUpdatedAt: String(ext[REPO_EXT.KEY_UPDATED_AT] || ''),
    linked: Array.isArray(ext[REPO_EXT.LINKED])
      ? ext[REPO_EXT.LINKED]
      : legacyRefs.map((id) => ({ kind: 'ref', id: String(id) })),
    addedAt: msToIso(row.created_at),
    updatedAt: msToIso(row.updated_at),
  };
  if (ext[REPO_EXT.GETLOOP] && typeof ext[REPO_EXT.GETLOOP] === 'object') out.getLoop = ext[REPO_EXT.GETLOOP];
  if (ext[REPO_EXT.DOC] && typeof ext[REPO_EXT.DOC] === 'object') out.doc = ext[REPO_EXT.DOC];
  if (Array.isArray(ext[REPO_EXT.DOC_LINKS]) && ext[REPO_EXT.DOC_LINKS].length) {
    out.docLinks = ext[REPO_EXT.DOC_LINKS];
  }
  return out;
}

/**
 * DB repos 行（type='group'）+ 成员行 → JSON 形态看板对象。
 *
 * 成员顺序 = repo_group_members.position 与 ext_placeholders.pos 合并排序
 * （真实成员的 position 是「上次落盘时它在数组里的下标」，含占位）。
 */
export function groupRowToStore(row, allMembers) {
  const ext = parseExt(row.ext);
  const real = allMembers
    .filter((m) => m.group_key === row.key)
    .map((m, i) => ({ key: String(m.repo_key || ''), note: String(m.note || ''), pos: Number(m.position) || 0, ord: i }));
  const phRaw = Array.isArray(ext[GROUP_EXT.PLACEHOLDERS]) ? ext[GROUP_EXT.PLACEHOLDERS] : [];
  const ph = phRaw.map((p, i) => ({
    key: String((p && p.key) || ''),
    note: String((p && p.note) || ''),
    pos: Number.isFinite(Number(p && p.pos)) ? Number(p.pos) : Number.MAX_SAFE_INTEGER,
    ord: real.length + i,
  }));
  const merged = [...real, ...ph].sort((a, b) => a.pos - b.pos || a.ord - b.ord);
  const repoKeys = merged.map((m) => m.key);
  const repoNotes = {};
  for (const m of merged) if (m.note) repoNotes[m.key] = m.note;

  const out = {
    id: String(ext[GROUP_EXT.LEGACY_ID] || ''),
    // 看板在 JSON 时代没有 key 字段（一律 boardKeyOf(name) 现算）；库化后 key 冻结
    // 落库，这里带上它 —— 定位与导出用冻结 key，改名后依然正确。
    key: String(row.key || ''),
    name: String(row.name || ''),
    desc: String(row.description || ''),
    createdAt: msToIso(row.created_at),
    repoKeys,
  };
  if (Object.keys(repoNotes).length) out.repoNotes = repoNotes;
  if (ext[GROUP_EXT.REPO_HINTS] && typeof ext[GROUP_EXT.REPO_HINTS] === 'object') {
    out.repoHints = ext[GROUP_EXT.REPO_HINTS];
  }
  if (ext[GROUP_EXT.DOC] && typeof ext[GROUP_EXT.DOC] === 'object') out.doc = ext[GROUP_EXT.DOC];
  if (Array.isArray(ext[GROUP_EXT.DOC_LINKS]) && ext[GROUP_EXT.DOC_LINKS].length) {
    out.docLinks = ext[GROUP_EXT.DOC_LINKS];
  }
  if (ext[GROUP_EXT.REPO_DOCS] && typeof ext[GROUP_EXT.REPO_DOCS] === 'object') {
    out.repoDocs = ext[GROUP_EXT.REPO_DOCS];
  }
  return out;
}
