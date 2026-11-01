// 绑定管理：DocRef（项目/组/组内描述的文档覆盖）与组级附加文档列表。
//
// **绑定与约定的关系**：默认全部走约定路径（repoDocRel / boardDocRel / groupNoteRel），
// 绑定只是覆盖——最典型的场景是把组内描述绑到 Obsidian vault 里的一个文件（外部、只读）。
// `--reset` 拆掉覆盖回到约定路径；拆绑定不动文档文件本身。
//
// 全部写路径走 mutateStore（与登记/看板同一把锁）。repos 的 store 事务经
// repos-bridge 动态加载（模块分层规则，见 repos-bridge.js 文件头）。
import * as paths from './paths.js';
import { normalizeKey } from '../../core/keys.js';
import { reposBridge } from './repos-bridge.js';
import { badInput, notFound, conflict } from '../../core/errors.js';

// 看板定位（id / key / 名称）：boardKeyOf 由 bridge 注入（key 口径必须与 repos 完全一致）
function findBoardIn(s, idOrKey, { normalizeKey: nk, boardKeyOf }) {
  const raw = String(idOrKey || '').trim();
  return (
    s.boards.find((x) => x.id === raw) ||
    s.boards.find((x) => boardKeyOf(x.name) === nk(raw)) ||
    s.boards.find((x) => String(x.name).toLowerCase() === raw.toLowerCase()) ||
    null
  );
}

// 仓库定位（id / key / 名称）：deriveKey 由 bridge 注入（repos 业务，不能静态引）
function makeRepoKeyIn({ normalizeKey: nk, deriveKey }) {
  return (s, locator) => {
    const raw = String(locator || '').trim();
    if (!raw) return null;
    const r =
      s.repos.find((x) => x.id === raw) ||
      s.repos.find((x) => deriveKey(x) === nk(raw)) ||
      s.repos.find((x) => String(x.name).toLowerCase() === raw.toLowerCase());
    return r ? deriveKey(r) : null;
  };
}

/**
 * 设置项目/组介绍的 DocRef 覆盖。
 *   target: { repo: locator } 或 { board: locator }（二选一）
 *   ref:    { rel } | { path }；reset=true 拆覆盖回约定路径
 */
export async function setDocRef({ repo, board, rel, path, reset } = {}) {
  if (!!repo === !!board) throw badInput('请给 --repo <仓库> 或 --board <看板>（二选一）');
  const ref = reset ? null : paths.assertDocRef({ rel, path });
  const { mutateStore, deriveKey, boardKeyOf } = await reposBridge();
  const repoKeyIn = makeRepoKeyIn({ normalizeKey, deriveKey });
  const nk = { normalizeKey, boardKeyOf };
  return mutateStore((s) => {
    if (repo) {
      const rkey = repoKeyIn(s, repo);
      if (!rkey) throw notFound('repo 不存在: ' + repo);
      const r = s.repos.find((x) => deriveKey(x) === rkey);
      if (ref) r.doc = ref;
      else delete r.doc;
      return { kind: 'repo', key: rkey, name: r.name, ref: r.doc || null };
    }
    const b = findBoardIn(s, board, nk);
    if (!b) throw notFound('看板不存在: ' + board);
    if (ref) b.doc = ref;
    else delete b.doc;
    return { kind: 'board', key: boardKeyOf(b.name), name: b.name, ref: b.doc || null };
  });
}

/**
 * 设置组内仓库描述的 DocRef 覆盖（repo 必须是该 board 的成员——含占位成员）。
 * reset=true 拆覆盖；拆掉后组内描述读约定路径（组内 note 字符串仍是摘要）。
 */
export async function setNoteDocRef({ board, repo, rel, path, reset } = {}) {
  if (!board) throw badInput('缺少看板（id / key / 名称）');
  const locator = String(repo || '').trim();
  if (!locator) throw badInput('缺少仓库（id / key / 路径 / 名称）');
  const ref = reset ? null : paths.assertDocRef({ rel, path });
  const { mutateStore, deriveKey, boardKeyOf, boardRepoKeys } = await reposBridge();
  const repoKeyIn = makeRepoKeyIn({ normalizeKey, deriveKey });
  const nk = { normalizeKey, boardKeyOf };
  return mutateStore((s) => {
    const b = findBoardIn(s, board, nk);
    if (!b) throw notFound('看板不存在: ' + board);
    const rkey = repoKeyIn(s, locator) || normalizeKey(locator);
    if (!boardRepoKeys(b, s).includes(rkey)) {
      throw conflict(`仓库「${rkey}」不在看板「${b.name}」里——组内描述只对成员有意义`);
    }
    if (!b.repoDocs) b.repoDocs = {};
    if (ref) b.repoDocs[rkey] = ref;
    else delete b.repoDocs[rkey];
    return { board: b.id, boardName: b.name, boardKey: boardKeyOf(b.name), repoKey: rkey, ref: b.repoDocs[rkey] || null };
  });
}

// ─── 组级附加文档（有序列表，自有 rel 与外部 path 混排）────────────────

/**
 * 维护组的 docLinks。
 *   doc    --doc <rel|绝对路径>（盘符/绝对 → 外部，否则自有）
 *   note   条目说明
 *   remove --remove <序号>（1 起）
 *   before --before <序号>（插到该条之前；缺省追加）
 */
export async function setDocLink({ board, doc, note, remove, before } = {}) {
  if (!board) throw badInput('缺少看板（id / key / 名称）');
  const { mutateStore, boardKeyOf } = await reposBridge();
  return mutateStore((s) => {
    const b = findBoardIn(s, board, { normalizeKey, boardKeyOf });
    if (!b) throw notFound('看板不存在: ' + board);
    if (!Array.isArray(b.docLinks)) b.docLinks = [];

    const idxOf = (n) => {
      const i = Number(n) - 1;
      if (!Number.isInteger(i) || i < 0 || i >= b.docLinks.length) {
        throw badInput('序号超出范围（1-' + b.docLinks.length + '）: ' + n);
      }
      return i;
    };

    if (remove !== undefined) {
      const [gone] = b.docLinks.splice(idxOf(remove), 1);
      return { boardName: b.name, removed: describeLink(gone), count: b.docLinks.length };
    }

    const ref = paths.assertDocRef(
      /^[a-zA-Z]:[\\/]/.test(String(doc || '')) || String(doc || '').startsWith('/')
        ? { path: String(doc).trim() }
        : { rel: String(doc || '') }
    );
    const entry = note ? { ...ref, note: String(note).trim() } : ref;
    const at = b.docLinks.findIndex((x) => (x.rel || '') === (entry.rel || '') && (x.path || '') === (entry.path || ''));
    if (at >= 0) b.docLinks.splice(at, 1);
    const want = before !== undefined ? idxOf(before) : -1;
    if (want >= 0) b.docLinks.splice(want, 0, entry);
    else b.docLinks.push(entry);
    return { boardName: b.name, links: b.docLinks.slice(), count: b.docLinks.length };
  });
}

function describeLink(l) {
  if (!l) return '(空)';
  return l.rel ? 'rel:' + l.rel : 'path:' + l.path;
}
