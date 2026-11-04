// 「描述即文档」：把一个所有者（repo / board）的绑定文档集整理成短视图。
//
// 为什么单开一个文件：列表接口（repos list / board 投影）要给前端「这个项目的描述
// 是哪几篇 md」——主篇标题 + 补充篇数量。这活儿既要读盘（取标题）、又要按约定路径
// 推导（没绑过 doc 的项目也要能显示默认主篇），但**不能**把整棵树读一遍：
// 列表里只有主篇需要标题，补充篇给 rel 名就够（点开才读正文）。
//
// 依赖方向：docs 是叶子，repos/service 反向依赖它（它已经 import 了 docs/paths）。
// 这里要 deriveKey 所以走 reposBridge 动态拿，静态 import 会成环。
import * as paths from './paths.js';
import * as store from './store.js';
import { summaryFromMd } from './seed.js';

const TITLE_RE = /^#\s+(.+)$/m;

const baseNameOf = (p) => String(p || '').replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '');

/** DocRef → docId（与前端 openByDocId 同一口径：rel: / path: 前缀） */
export function refToDocId(ref) {
  if (!ref) return '';
  if (ref.rel) return 'rel:' + ref.rel;
  if (ref.path) return 'path:' + ref.path;
  return '';
}

/** 约定主篇路径（没显式绑 doc 时的默认位置） */
export function defaultMainRel(owner, kind) {
  if (kind === 'board') return paths.boardDocRel(owner.name);
  const key = owner.key || owner.repoKey || '';
  return key ? paths.repoDocRel(key) : '';
}

/**
 * 主篇的展示元信息：标题 + 摘要（正文首个非标题行，与 seed 同一口径）。
 * 文件还没写过时标题退回**仓库/看板名**（key 末段往往是 remote 的仓库名，
 * 跟用户认知里的项目名对不上），摘要空着，由前端显示「未写」。
 */
async function mainMeta(ref, fallbackRel, ownerName) {
  // 没显式绑 doc 的项目只有约定路径——那种情况**也要读**，
  // 否则迁过来的主篇永远显示不出摘要（doc 字段为空 ≠ 文档不存在）。
  const rel = (ref && ref.rel) || fallbackRel;
  if (rel) {
    try {
      const body = await store.readOwnDoc(rel);
      const t = TITLE_RE.exec(body);
      return {
        title: (t && t[1].trim()) || ownerName || baseNameOf(rel),
        summary: summaryFromMd(body),
      };
    } catch { /* 还没落盘 */ }
    return { title: ownerName || baseNameOf(rel), summary: '' };
  }
  if (ref && ref.path) return { title: baseNameOf(ref.path), summary: '' };
  return { title: ownerName || '', summary: '' };
}

/**
 * 文档集短视图。
 * @param {object} owner repo 或 board 记录
 * @param {'repo'|'board'} kind
 * @returns {Promise<{main:{docId,title,rel,path,exists},links:Array<{docId,title,note,tag}>,count:number}>}
 */
export async function docSetOf(owner, kind) {
  if (!owner) return { main: null, links: [], count: 0 };
  const mainRef = owner.doc && (owner.doc.rel || owner.doc.path) ? owner.doc : null;
  const rel = (mainRef && mainRef.rel) || defaultMainRel(owner, kind);
  const exists = !!(rel && (await store.ownDocExists(rel))) || !!(mainRef && mainRef.path);
  const meta = await mainMeta(mainRef, rel, owner.name || '');
  const main = {
    docId: mainRef ? refToDocId(mainRef) : rel ? 'rel:' + rel : '',
    title: meta.title,
    summary: meta.summary,
    rel: (mainRef && mainRef.rel) || rel,
    path: (mainRef && mainRef.path) || '',
    exists,
  };
  const links = (Array.isArray(owner.docLinks) ? owner.docLinks : []).map((l) => ({
    docId: refToDocId(l),
    title: baseNameOf(l.rel || l.path),
    note: l.note || '',
    tag: l.tag || '',
  }));
  return { main, links, count: (main.title ? 1 : 0) + links.length };
}
