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

// 看板定位（id / key / 名称）：boardKeyOf 由 bridge 注入（key 口径必须与 repos 完全一致）
function findBoardIn(s: any, idOrKey: unknown, { normalizeKey: nk, boardKeyOf }: { normalizeKey: (k: unknown) => string; boardKeyOf: (v: any) => any }): any {
  const raw = String(idOrKey || '').trim();
  return (
    s.boards.find((x: any) => x.id === raw) ||
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
  note?: string;
  tag?: string;
  remove?: number;
  before?: number;
}

/**
 * 维护组的 docLinks。
 *   --ref <refId> 或 --path <绝对路径>（外部只读）
 *   note / tag  条目注解
 *   remove --remove <序号>（1 起）
 *   before --before <序号>（插到该条之前；缺省追加）
 *
 * 同 ref 重复添加 = 更新该条（note/tag 以本次为准）。
 */
export async function setDocLink({ board, ref, path, note, tag, remove, before }: SetDocLinkInput = {}): Promise<any> {
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

    // 条目 = DocRef + 注解（note/tag）；合成逻辑收在 docref.withLinkMeta
    const entry = withLinkMeta(docRef!, { note, tag });
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

/** addRepoDoc 的入参（refId 或外部路径 + 可选注解）。 */
export interface AddRepoDocInput {
  ref?: string;
  path?: string;
  note?: string;
  tag?: string;
}

/** 往项目的介绍文档集里加一篇（同 ref 重复添加 = 更新注解）。 */
export async function addRepoDoc(locator: string, raw: unknown): Promise<any> {
  const { getRepo, deriveKey, mutateStore } = await reposBridge();
  const repo = await getRepo(locator);
  const input = (raw && typeof raw === 'object' ? raw : {}) as AddRepoDocInput;
  const docRef = await docRefOf({ ref: input.ref, path: input.path });
  const entry = withLinkMeta(docRef, { note: input.note, tag: input.tag });
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
