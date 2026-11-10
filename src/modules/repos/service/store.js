// JSON 形态 store 的组装与落库（SQLite，T05）。
//
// repos.json 的读写已消失：登记与看板落 `repos` 表（组 = type='group'），成员边落
// `repo_group_members`，队列绑定落 `topics.repo_key`。JSON 形态的 store
//（{repos, boards}）在这里按需组装/落库 —— docs 域经 repos-bridge 消费的
// 正是这层形状，存储切换对它完全透明。
//
// 为什么保留 loadStore/mutateStore 的形状：repos 域写频率低、数据量小
//（几十个仓库），「读全量 → 同步改 → 一个事务落回」在这里不是热路径
//（localtask 那种 0.5s 轮询才必须拆掉 mutate）。它同时保住了两样东西：
// docs 域 33 个调用点零改动；boards/ref/transfer 的多实体联动写一个事务搞定。
// 窄方法（repo/repos.js / repo/refs.js）承担单实体路径与跨表绑定。
//
// ⚠️ **禁令（T06 团队裁决）**：这个「BEGIN IMMEDIATE 内读全量→改→整份落回」的
// 适配器模式**只允许出现在"小表低频"的域**（repos / templates 这种几十行、
// 偶发写的表）。**热路径禁止照抄**——localtask 的 get/list/wait 是毫秒级轮询，
// 一次 mutate = 全表读 + 全表写，并发轮询下就是灾难。有新域要切库：
// 先看写频率，热路径一律走窄方法（仿 localtask/repo），不要回退成 mutate。
import { badInput } from '../../../core/errors.js';
import { sanitizeDocRef, withLinkMeta } from '../../docs/docref.js';
import { nowMs } from '../../../core/db/time.js';
import repoLayer from '../repo/index.js';
import {
  SENTINEL_REPO_KEY,
  REPO_EXT,
  GROUP_EXT,
  parseExt,
  jsonText,
  msOfAny,
  compact,
  repoRowToStore,
  groupRowToStore,
} from '../repo/rows.js';
import { boardKeyOf } from './identity.js';

const repo = repoLayer;

/**
 * JSON 形态 store 的组装（同步；事务内复用 —— mutateStore 用它读当前态）。
 * 哨兵仓库不进 store（隐藏：不是用户登记的仓库，面板/导出/上下文都看不见它）。
 */
function assembleStore(conn) {
  const repoRows = repo.repos.listRepoRows(conn);
  const groupRows = repo.repos.listGroupRows(conn);
  const members = repo.repos.listAllMembers(conn);
  const store = {
    version: 2,
    repos: repoRows.map((row) => repoRowToStore(row)),
    boards: groupRows.map((row) => groupRowToStore(row, members)),
  };
  // v2 文档绑定归一：非法 DocRef 形状直接丢弃（ext 里的脏数据不炸读取）。
  normalizeDocRefs(store);
  return store;
}

export async function loadStore() {
  return assembleStore(repo.db());
}

// 读-改-写事务：fn 直接修改传入的深拷贝；fn 抛错则不落库。
// fn 必须同步（事务体同步是硬约束）；返回值原样透传给调用方。
// 导出给 boards.js / docs 域（经 repos-bridge）用，不重复实现一遍。
export async function mutateStore(fn) {
  return repo.txw((conn) => {
    const cur = assembleStore(conn);
    const draft = structuredClone(cur);
    const out = fn(draft);
    persistStore(conn, draft);
    return out;
  });
}

/** 整份 store 落库（一个事务）。测试与批量导入用；常规写走 mutateStore。 */
export async function saveStore(data) {
  return repo.txw((conn) => persistStore(conn, data));
}

// ─── 落库（JSON 形态 → 行）────────────────────────────────────────────

/** JSON 形态登记对象 → repos 行。key 必须已经存在（不允许落库时现算）。 */
function repoToRow(r, atMs) {
  // 不再用 deriveKey 现算：落库是最后一道关，静默补 key 会把「用户没填」的历史
  // 覆盖成 local/<名字>，之后再也看不出这个 key 是猜出来的。
  const key = String(r.key || '').trim();
  if (!key) throw badInput('仓库「' + (r.name || '未命名') + '」缺少 key：key 是仓库身份，必须显式给出或由远程地址归一化');
  const remotes = Array.isArray(r.remotes) ? r.remotes.map((x) => String(x).trim()).filter(Boolean) : [];
  const linked = Array.isArray(r.linked)
    ? r.linked.filter((l) => l && typeof l === 'object' && l.kind && l.id).map((l) => ({ kind: String(l.kind), id: String(l.id), ...(l.note ? { note: String(l.note) } : {}) }))
    : [];
  const ext = compact({
    [REPO_EXT.LEGACY_ID]: r.id ? String(r.id) : undefined,
    [REPO_EXT.LEGACY_TYPE]: r.type === 'ref' ? 'ref' : 'dev',
    [REPO_EXT.NOTES]: r.notes ? String(r.notes) : undefined,
    [REPO_EXT.ICON]: r.icon ? String(r.icon) : undefined,
    [REPO_EXT.REMOTES]: remotes.length ? remotes : undefined,
    [REPO_EXT.KEY_CUSTOM]: r.keyCustom ? 1 : undefined,
    [REPO_EXT.KEY_UPDATED_AT]: r.keyUpdatedAt ? String(r.keyUpdatedAt) : undefined,
    [REPO_EXT.LINKED]: linked.length ? linked : undefined,
    [REPO_EXT.GETLOOP]: r.getLoop && typeof r.getLoop === 'object' ? r.getLoop : undefined,
    [REPO_EXT.DOC]: r.doc && typeof r.doc === 'object' ? r.doc : undefined,
    [REPO_EXT.DOC_LINKS]: Array.isArray(r.docLinks) && r.docLinks.length ? r.docLinks : undefined,
  });
  return {
    key,
    type: 'repo',
    name: String(r.name || key),
    description: String(r.desc ?? ''),
    path: String(r.path ?? ''),
    remote: String(r.remote ?? ''),
    ext: jsonText(ext),
    legacyId: r.id ? String(r.id) : null,
    createdAtMs: msOfAny(r.addedAt, atMs),
    updatedAtMs: msOfAny(r.updatedAt, atMs),
  };
}

/**
 * JSON 形态看板对象 → 组行 + 真实成员边。
 *
 * key：冻结（b.key 优先，缺省 boardKeyOf(name)）—— 改名后 key 不变，
 * 成员边 / ref 绑定 / topics.group_key 的引用跟着冻结 key 走。
 * 占位成员（本机没有登记的 key）进不了 repo_group_members（FK 拒绝）→
 * 落 ext.ext_placeholders，读时按 pos 合并还原数组序。
 */
function groupToRow(b, atMs, knownRepoKeys) {
  const key = String(b.key || boardKeyOf(b.name) || '').trim();
  if (!key) throw badInput('看板 key 不能为空');
  if (key === SENTINEL_REPO_KEY) throw badInput('哨兵仓库不能入组: ' + SENTINEL_REPO_KEY);
  const repoKeys = Array.isArray(b.repoKeys) ? b.repoKeys.map((k) => String(k || '').trim()).filter(Boolean) : [];
  const notes = b.repoNotes && typeof b.repoNotes === 'object' ? b.repoNotes : {};
  const members = [];
  const placeholders = [];
  const seen = new Set();
  repoKeys.forEach((rk, position) => {
    if (seen.has(rk)) return; // 重复成员去重（位次取首次出现）
    seen.add(rk);
    if (rk === SENTINEL_REPO_KEY) throw badInput('哨兵仓库不能入组: ' + SENTINEL_REPO_KEY);
    if (knownRepoKeys.has(rk)) members.push({ repoKey: rk, position, note: String(notes[rk] ?? '') });
    else placeholders.push({ key: rk, note: String(notes[rk] ?? ''), pos: position });
  });
  const hints = b.repoHints && typeof b.repoHints === 'object' ? b.repoHints : null;
  const repoDocs = b.repoDocs && typeof b.repoDocs === 'object' && Object.keys(b.repoDocs).length ? b.repoDocs : null;
  const docLinks = Array.isArray(b.docLinks) && b.docLinks.length ? b.docLinks : null;
  const ext = compact({
    [GROUP_EXT.LEGACY_ID]: b.id ? String(b.id) : undefined,
    [GROUP_EXT.REPO_HINTS]: hints ? hints : undefined,
    [GROUP_EXT.PLACEHOLDERS]: placeholders.length ? placeholders : undefined,
    [GROUP_EXT.DOC]: b.doc && typeof b.doc === 'object' ? b.doc : undefined,
    [GROUP_EXT.DOC_LINKS]: docLinks ? docLinks : undefined,
    [GROUP_EXT.REPO_DOCS]: repoDocs ? repoDocs : undefined,
  });
  return {
    key,
    type: 'group',
    name: String(b.name || key),
    description: String(b.desc ?? ''),
    path: '',
    remote: '',
    ext: jsonText(ext),
    legacyId: b.id ? String(b.id) : null,
    members,
    createdAtMs: msOfAny(b.createdAt, atMs),
    updatedAtMs: atMs,
  };
}

/**
 * 整份 JSON 形态 store 落库（**必须在事务内**调用）。
 *
 * 行身份 = ext.ext_legacy_id（r_xxx / b_xxx，本机行主键）：key 变了（改 key /
 * 改组名后 key 重派）而 id 没变 → 按 id 找到旧行，UPDATE key 原地改名
 * （成员边 / 绑定 / topics 外键全部 ON UPDATE CASCADE 跟随）。
 * 消失的行真删（成员边与绑定级联清）；哨兵仓库不受落库影响（永远在场）。
 */
function persistStore(conn, store) {
  const at = nowMs();
  const repos = Array.isArray(store && store.repos) ? store.repos : [];
  const boards = Array.isArray(store && store.boards) ? store.boards : [];

  // 事前行身份表：legacy id → 现落点 key（rename 探测用）
  const before = conn.all('SELECT key, type, ext FROM repos');
  const idToKey = new Map();
  const keySet = new Set();
  for (const row of before) {
    keySet.add(String(row.key));
    const lid = parseExt(row.ext)[REPO_EXT.LEGACY_ID];
    if (lid) idToKey.set(String(lid), String(row.key));
  }

  // ① 登记（type='repo'）
  const seenRepoKeys = new Set();
  for (const r of repos) {
    const row = repoToRow(r, at);
    const prior = (row.legacyId && idToKey.get(row.legacyId)) || (keySet.has(row.key) ? row.key : null);
    if (prior && prior !== row.key) repo.repos.renameRow(conn, prior, row.key, at);
    repo.repos.upsertRow(conn, row);
    seenRepoKeys.add(row.key);
  }
  for (const row of before) {
    if (row.type !== 'repo') continue; // 组行归 ② 处理；这里只清「消失的仓库」
    const k = String(row.key);
    if (k === SENTINEL_REPO_KEY) continue; // 哨兵永远在场，不随 store 落库增删
    if (!seenRepoKeys.has(k)) repo.repos.softDeleteRow(conn, k, at);
  }

  // ② 组（type='group'）+ 成员边。真实成员的 key 必须已在 repos 表（FK），
  //    所以成员重建放在登记 upsert 之后。
  const knownRepoKeys = new Set(
    conn.all("SELECT key FROM repos WHERE type <> 'group' AND deleted_at IS NULL").map((x) => String(x.key))
  );
  const seenGroupKeys = new Set();
  for (const b of boards) {
    const row = groupToRow(b, at, knownRepoKeys);
    const prior = (row.legacyId && idToKey.get(row.legacyId)) || (keySet.has(row.key) ? row.key : null);
    if (prior && prior !== row.key) repo.repos.renameRow(conn, prior, row.key, at);
    repo.repos.upsertRow(conn, row);
    repo.repos.replaceMembers(conn, row.key, row.members, at);
    seenGroupKeys.add(row.key);
  }
  for (const row of before) {
    const k = String(row.key);
    if (row.type !== 'group') continue;
    if (!seenGroupKeys.has(k)) repo.repos.softDeleteRow(conn, k, at);
  }
}

// v2 文档绑定归一：非法 DocRef 形状直接丢弃（盘上脏数据不炸读取）。
// 在内存完成即可，不强制落盘——下一次任何写都会把归一结果带下去。
// sanitizeDocRef 来自 docs/docref.js（叶子模块，刻意不反向依赖本文件之外的东西）。
function normalizeDocRefs(store) {
  for (const r of store.repos) {
    const ref = sanitizeDocRef(r.doc);
    if (ref) r.doc = ref;
    else delete r.doc;
    // 项目介绍文档集（多篇）：doc 是主篇，docLinks 是其余各篇
    const links = (Array.isArray(r.docLinks) ? r.docLinks : [])
      .map((l) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) r.docLinks = links;
    else delete r.docLinks;
  }
  for (const b of store.boards) {
    const ref = sanitizeDocRef(b.doc);
    if (ref) b.doc = ref;
    else delete b.doc;
    const links = (Array.isArray(b.docLinks) ? b.docLinks : [])
      .map((l) => {
        const d = sanitizeDocRef(l);
        if (!d) return null;
        return withLinkMeta(d, l);
      })
      .filter(Boolean);
    if (links.length) b.docLinks = links;
    else delete b.docLinks;
    const repoDocs = {};
    for (const [k, v] of Object.entries(b.repoDocs && typeof b.repoDocs === 'object' ? b.repoDocs : {})) {
      const d = sanitizeDocRef(v);
      if (d) repoDocs[k] = d;
    }
    if (Object.keys(repoDocs).length) b.repoDocs = repoDocs;
    else delete b.repoDocs;
  }
}
