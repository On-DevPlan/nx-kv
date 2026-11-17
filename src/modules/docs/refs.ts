// 绑定管理：宿主 ext 里 DocRef{ref}（refId）的维护。
//
// v8 口径：宿主字段只存 refId；外部文件/目录先落一条 origin='external' 的 ref
// （实际位置在 refs.locator），宿主只认 ref。所有写路径走 mutateStore，
// 写完调用 syncRefIndex 重建索引。
import { normalizeKey } from '../../shared/repo-key.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, notFound, conflict } from '../../core/errors.js';
import { ensureDocRef, refDocById } from '../../core/attachmentdb.js';
import { getDb } from '../../core/db/index.js';
import { withLinkMeta } from './docref.js';
import type { DocRef } from './docref.js';
import { syncRefIndex } from './ref-sync.js';

/** ref / path 二选一 → DocRef{ref}；path 先登记成外部 ref。 */
async function docRefOf({ ref, path }: { ref?: unknown; path?: unknown }): Promise<DocRef> {
  const refId = String(ref || '').trim();
  if (refId) {
    if (!refDocById(getDb(), refId)) throw notFound('文档不存在: ' + refId);
    return { ref: refId };
  }
  const abs = String(path || '').trim();
  if (abs) {
    const id = ensureDocRef(getDb(), { locator: abs });
    if (!id) throw badInput('外部路径不能为空');
    return { ref: id };
  }
  throw badInput('缺少文档：--ref <refId> 或 --path <外部绝对路径>');
}

// 看板定位（id / 冻结 key / 派生 key / 名称）：boardKeyOf 由 bridge 注入（key 口径必须与 repos 完全一致）
// #119：先认**冻结 key**——历史组的 key 可能是 `group/<name>`，而 boardKeyOf 只给 `board/<name>`。
function findBoardIn(s: any, idOrKey: unknown, { normalizeKey: nk, boardKeyOf }: { normalizeKey: (k: unknown) => string; boardKeyOf: (v: any) => any }): any {
  const raw = String(idOrKey || '').trim();
  return (
    s.boards.find((x: any) => x.id === raw) ||
    s.boards.find((x: any) => String(x.key || '') === raw) ||
    s.boards.find((x: any) => String(x.key || '') !== '' && nk(x.key) === nk(raw)) ||
    s.boards.find((x: any) => boardKeyOf(x.name) === nk(raw)) ||
    s.boards.find((x: any) => String(x.name).toLowerCase() === raw.toLowerCase()) ||
    null
  );
}

// 仓库定位（id / key / 名称）：deriveKey 由 bridge 注入（repos 业务，不能静态引）
function makeRepoKeyIn({ normalizeKey: nk, deriveKey }: { normalizeKey: (k: unknown) => string; deriveKey: (r: any) => any }): (s: any, locator: unknown) => string | null {
  return (s: any, locator: unknown): string | null => {
    const raw = String(locator || '').trim();
    if (!raw) return null;
    const r =
      s.repos.find((x: any) => x.id === raw) ||
      s.repos.find((x: any) => deriveKey(x) === nk(raw)) ||
      s.repos.find((x: any) => String(x.name).toLowerCase() === raw.toLowerCase());
    return r ? deriveKey(r) : null;
  };
}

/** setDocRef 的入参。 */
export interface SetDocRefInput {
  repo?: string;
  board?: string;
  ref?: string;
  path?: string;
  reset?: boolean;
}

/**
 * 设置项目/组介绍的主篇。
 *   target: { repo: locator } 或 { board: locator }（二选一）
 *   doc:    refId 或外部路径；reset=true 清空主篇
 */
export async function setDocRef({ repo, board, ref, path, reset }: SetDocRefInput = {}): Promise<any> {
  if (!!repo === !!board) throw badInput('请给 --repo <仓库> 或 --board <看板>（二选一）');
  const docRef: DocRef | null = reset ? null : await docRefOf({ ref, path });
  const { mutateStore, deriveKey, boardKeyOf } = await reposBridge();
  const repoKeyIn = makeRepoKeyIn({ normalizeKey, deriveKey });
  const nk = { normalizeKey, boardKeyOf };
  const res = await mutateStore((s: any) => {
    if (repo) {
      const rkey = repoKeyIn(s, repo);
      if (!rkey) throw notFound('repo 不存在: ' + repo);
      const r = s.repos.find((x: any) => deriveKey(x) === rkey);
      if (docRef) r.doc = docRef;
      else delete r.doc;
      return { kind: 'repo', key: rkey, name: r.name, ref: r.doc || null };
    }
    const b = findBoardIn(s, board, nk);
    if (!b) throw notFound('看板不存在: ' + board);
    if (docRef) b.doc = docRef;
    else delete b.doc;
    return { kind: 'board', key: boardKeyOf(b.name), name: b.name, ref: b.doc || null };
  });
  await syncRefIndex();
  return res;
}

/** setDocMain 的入参：宿主（repo / board 二选一）+ 目标文档（ref / path）。 */
export interface SetDocMainInput {
  repo?: unknown;
  board?: unknown;
  ref?: unknown;
  path?: unknown;
}

/**
 * 把某一篇设成宿主的**主篇**（#144）。
 *
 * 与 `docs bind` 的差别（用户视角正是这一点）：这是**换位**，不是覆盖——
 *   · 目标那篇如果已经在附加篇（docLinks）里，先把它摘出来，避免同一篇出现两次；
 *   · 原主篇还在、且不是目标 → 挪到 docLinks 头部，**保住它的归属**
 *     （`docs bind` 会直接把原主篇甩成孤儿，3 天后被清理）；
 *   · 目标没绑在这个宿主上 → 显式报错，先加进列表（不做「顺手加一篇」的隐式行为）。
 *
 * 宿主 = 仓库（repo.doc/docLinks）或组（board.doc/docLinks）；组内仓库描述
 * （board.repoDocs）不在这个语义里。
 */
export async function setDocMain({ repo, board, ref, path }: SetDocMainInput = {}): Promise<any> {
  if (!!repo === !!board) throw badInput('请给 --repo <仓库> 或 --board <看板>（二选一）');
  const docRef = await docRefOf({ ref, path });
  const { mutateStore, deriveKey, boardKeyOf } = await reposBridge();
  const nk = { normalizeKey, boardKeyOf };
  const repoKeyIn = makeRepoKeyIn({ normalizeKey, deriveKey });
  const res = await mutateStore((s: any) => {
    const host = repo
      ? (() => {
          const rkey = repoKeyIn(s, repo);
          if (!rkey) throw notFound('repo 不存在: ' + String(repo));
          const r = s.repos.find((x: any) => deriveKey(x) === rkey);
          if (!r) throw notFound('repo 不存在: ' + String(repo));
          return r;
        })()
      : (() => {
          const b = findBoardIn(s, board, nk);
          if (!b) throw notFound('看板不存在: ' + String(board));
          return b;
        })();
    const links: any[] = Array.isArray(host.docLinks) ? host.docLinks : [];
    const inLinks = links.findIndex((x: any) => x && x.ref === docRef.ref);
    const isMain = !!(host.doc && host.doc.ref === docRef.ref);
    if (isMain && inLinks < 0) {
      return { changed: false, alreadyMain: true, name: host.name, key: deriveKey(host), ref: docRef.ref };
    }
    // 目标必须已经在这个宿主的文档列表里（主篇或附加篇）。不在这里就显式报错——
    // 「顺手把它加成主篇」是隐式行为，会让列表凭空多一篇。
    if (!isMain && inLinks < 0) {
      throw conflict('这篇不在这个宿主的文档列表里：先加进去（repo doc add / docs link）再设主篇');
    }
    // ① 目标从附加篇里摘出来（同一篇不能既是主篇又在附加篇里）
    if (inLinks >= 0) links.splice(inLinks, 1);
    // ② 原主篇退回附加篇头部（保住归属；只有它还在、且不是目标时才动）
    const prev = host.doc;
    if (prev && prev.ref && prev.ref !== docRef.ref) links.unshift(prev);
    // ③ 目标上位
    host.doc = docRef;
    if (links.length) host.docLinks = links;
    else delete host.docLinks;
    host.updatedAt = new Date().toISOString();
    return {
      changed: true,
      alreadyMain: false,
      name: host.name,
      key: deriveKey(host),
      ref: docRef.ref,
      previous: prev && prev.ref ? prev.ref : '',
      count: links.length + 1,
    };
  });
  await syncRefIndex();
  return res;
}

/** setNoteDocRef 的入参。 */
export interface SetNoteDocRefInput {
  board?: string;
  repo?: string;
  ref?: string;
  path?: string;
  reset?: boolean;
}

/**
 * 设置组内仓库描述（repo 必须是该 board 的成员——含占位成员）。
 * reset=true 清空；清空后该成员没有组内描述文档。
 */
export async function setNoteDocRef({ board, repo, ref, path, reset }: SetNoteDocRefInput = {}): Promise<any> {
  if (!board) throw badInput('缺少看板（id / key / 名称）');
  const locator = String(repo || '').trim();
  if (!locator) throw badInput('缺少仓库（id / key / 路径 / 名称）');
  const docRef: DocRef | null = reset ? null : await docRefOf({ ref, path });
  const { mutateStore, deriveKey, boardKeyOf, boardRepoKeys } = await reposBridge();
  const repoKeyIn = makeRepoKeyIn({ normalizeKey, deriveKey });
  const nk = { normalizeKey, boardKeyOf };
  const res = await mutateStore((s: any) => {
    const b = findBoardIn(s, board, nk);
    if (!b) throw notFound('看板不存在: ' + board);
    const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
    if (!boardRepoKeys(b, s).includes(rkey)) {
      throw conflict(`仓库「${rkey}」不在看板「${b.name}」里——组内描述只对成员有意义`);
    }
    if (!b.repoDocs) b.repoDocs = {};
    if (docRef) b.repoDocs[rkey] = docRef;
    else delete b.repoDocs[rkey];
    return { board: b.id, boardName: b.name, boardKey: boardKeyOf(b.name), repoKey: rkey, ref: b.repoDocs[rkey] || null };
  });
  await syncRefIndex();
  return res;
}

// ─── 组级附加文档（有序列表）────────────────────────────────────────────

/** setDocLink 的入参。 */
export interface SetDocLinkInput {
  board?: string;
  ref?: string;
  path?: string;
  remove?: number;
  before?: number;
}

/**
 * 维护组的 docLinks。
 *   --ref <refId> 或 --path <绝对路径>（外部只读）
 *   remove --remove <序号>（1 起）
 *   before --before <序号>（插到该条之前；缺省追加）
 *
 * 同 ref 重复添加 = 把该条移到新位置。
 */
export async function setDocLink({ board, ref, path, remove, before }: SetDocLinkInput = {}): Promise<any> {
  if (!board) throw badInput('缺少看板（id / key / 名称）');
  const { mutateStore, boardKeyOf } = await reposBridge();
  const docRef = remove === undefined ? await docRefOf({ ref, path }) : null;
  const res = await mutateStore((s: any) => {
    const b = findBoardIn(s, board, { normalizeKey, boardKeyOf });
    if (!b) throw notFound('看板不存在: ' + board);
    if (!Array.isArray(b.docLinks)) b.docLinks = [];

    const idxOf = (n: unknown): number => {
      const i = Number(n) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= b.docLinks.length) {
        throw badInput('序号超出范围（1-' + b.docLinks.length + '）: ' + String(n));
      }
      return i;
    };

    if (remove !== undefined) {
      const [gone] = b.docLinks.splice(idxOf(remove), 1);
      return { boardName: b.name, removed: describeLink(gone), count: b.docLinks.length };
    }

    // 条目 = DocRef（去 note 后只剩 ref 本体）
    const entry = withLinkMeta(docRef!);
    const at = b.docLinks.findIndex((x: any) => (x && x.ref) === entry.ref);
    if (at >= 0) b.docLinks.splice(at, 1);
    const want = before !== undefined ? idxOf(before) : -1;
    if (want >= 0) b.docLinks.splice(want, 0, entry);
    else b.docLinks.push(entry);
    return { boardName: b.name, links: b.docLinks.slice(), count: b.docLinks.length };
  });
  await syncRefIndex();
  return res;
}

function describeLink(l: any): string {
  if (!l) return '(空)';
  return 'ref:' + String(l.ref || '');
}

// ─── 项目介绍文档集（多篇）────────────────────────────────────────────
//
// 主篇 repo.doc + 其余 repo.docLinks；每篇都是 refId。

/** 列项目的介绍文档集 */
export async function listRepoDocs(locator: string): Promise<any> {
  const { getRepo, loadStore, deriveKey } = await reposBridge();
  const repo = await getRepo(locator);
  const s = await loadStore();
  const r = s.repos.find((x: any) => deriveKey(x) === deriveKey(repo));
  const key = deriveKey(repo);
  const { docSetOf } = await import('./brief.js');
  const set = await docSetOf(r || {}, 'repo');
  // 补 ref 别名：老调用方按 `ref` 取 refId（面板的简介轨只认 docId/refId）。
  const withRef = (v: any): any => (v ? { ...v, ref: v.refId } : v);
  return {
    repo: { key, name: repo.name },
    main: withRef(set.main),
    extras: set.links.map(withRef),
    links: set.links.map(withRef),
    count: set.count,
  };
}

/** addRepoDoc 的入参（refId 或外部路径）。 */
export interface AddRepoDocInput {
  ref?: string;
  path?: string;
}

/** 往项目的介绍文档集里加一篇（同 ref 重复添加 = 移到末尾）。 */
export async function addRepoDoc(locator: string, raw: unknown): Promise<any> {
  const { getRepo, deriveKey, mutateStore } = await reposBridge();
  const repo = await getRepo(locator);
  const input = (raw && typeof raw === 'object' ? raw : {}) as AddRepoDocInput;
  const docRef = await docRefOf({ ref: input.ref, path: input.path });
  const entry = withLinkMeta(docRef);
  const res = await mutateStore((s: any) => {
    const r = s.repos.find((x: any) => deriveKey(x) === deriveKey(repo));
    if (!r) throw notFound('repo 不存在: ' + locator);
    if (!Array.isArray(r.docLinks)) r.docLinks = [];
    const at = r.docLinks.findIndex((x: any) => (x && x.ref) === entry.ref);
    if (at >= 0) r.docLinks.splice(at, 1);
    r.docLinks.push(entry);
    r.updatedAt = new Date().toISOString();
    return { key: deriveKey(r), name: r.name, added: entry, count: r.docLinks.length };
  });
  await syncRefIndex();
  return res;
}

/**
 * 「建一篇文档并挂到某个仓库上」——关系描述的落点（#137）。
 *
 * 定位口径：**desc 就在 ref 上**——同一个 desc 的那篇就是它；
 * 找到了就改（正文 + desc），没找到就新建一篇并挂到该仓库的文档列表。
 */
export async function setDocLinkDoc({ repoKey, desc, body }: {
  repoKey: string;
  desc: string;
  body?: string;
}): Promise<{ refId: string; desc: string; created: boolean }> {
  const { getRepo, deriveKey, mutateStore } = await reposBridge();
  const repo = await getRepo(repoKey);
  const key = deriveKey(repo);
  const label = String(desc || '').trim();
  const text = String(body ?? '');

  // ① 找同 desc 的那篇（该仓库的文档集里）
  const s = await (await reposBridge()).loadStore();
  const r = s.repos.find((x: any) => deriveKey(x) === key);
  const ids: string[] = [];
  if (r && r.doc && r.doc.ref) ids.push(String(r.doc.ref));
  for (const l of (r && Array.isArray(r.docLinks) ? r.docLinks : [])) {
    if (l && l.ref) ids.push(String(l.ref));
  }
  let hit = '';
  for (const id of ids) {
    const row = getDb().get(`SELECT "desc" AS desc FROM refs WHERE id = :id AND deleted_at IS NULL`, { id });
    if (row && String(row.desc || '') === label) { hit = id; break; }
  }

  if (hit) {
    // ② 改：正文 + desc（同一篇，不新增）
    const { writeOwnDoc, setOwnDocDesc } = await import('./store.js');
    await writeOwnDoc(hit, text);
    await setOwnDocDesc(hit, label);
    return { refId: hit, desc: label, created: false };
  }

  // ③ 建：新建一篇自有文档（空正文也落行）+ 挂到仓库文档集
  const { createRef } = await import('./service.js');
  const made = await createRef({ desc: label, owner: 'repo', repo: key });
  const { writeOwnDoc } = await import('./store.js');
  await writeOwnDoc(made.refId, text);
  // createRef 会把它挂成**主篇**（仓库没有主篇时）；关系描述是「又一篇」，
  // 应当是附加篇 —— 把主篇位还回去（本来就是空的），改挂 docLinks。
  await mutateStore((draft: any) => {
    const dr = draft.repos.find((x: any) => deriveKey(x) === key);
    if (!dr) return;
    if (dr.doc && dr.doc.ref === made.refId) {
      delete dr.doc;
      if (!Array.isArray(dr.docLinks)) dr.docLinks = [];
      dr.docLinks.push({ ref: made.refId });
    }
    dr.updatedAt = new Date().toISOString();
  });
  await syncRefIndex();
  return { refId: made.refId, desc: label, created: true };
}

/** 从项目的介绍文档集里摘掉一篇（--index 从 1 起；1 = 主篇） */
export async function removeRepoDoc(locator: string, index: unknown): Promise<any> {
  const { getRepo, deriveKey, mutateStore } = await reposBridge();
  const repo = await getRepo(locator);
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1) throw badInput('缺少参数 --index <序号>（1 = 主篇，其后依次）');
  const res = await mutateStore((s: any) => {
    const r = s.repos.find((x: any) => deriveKey(x) === deriveKey(repo));
    if (!r) throw notFound('repo 不存在: ' + locator);
    if (n === 1) {
      const gone = r.doc || null;
      const next = Array.isArray(r.docLinks) ? r.docLinks.shift() : null;
      if (next) r.doc = next;
      else delete r.doc;
      r.updatedAt = new Date().toISOString();
      return { key: deriveKey(r), name: r.name, removed: gone };
    }
    const links = Array.isArray(r.docLinks) ? r.docLinks : [];
    if (n - 2 >= links.length) throw badInput('序号超出范围（共 ' + (links.length + 1) + ' 篇）');
    const [gone] = links.splice(n - 2, 1);
    r.updatedAt = new Date().toISOString();
    return { key: deriveKey(r), name: r.name, removed: gone };
  });
  await syncRefIndex();
  return res;
}
