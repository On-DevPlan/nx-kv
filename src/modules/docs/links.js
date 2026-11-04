// 双链解析服务：把「文档名/路径 → docId」的索引建出来，供渲染端点击导航。
//
// 索引 = 自有树全部 .md + 外部绑定闭包内的 .md。按面板打开时拉取一次，
// 不监听文件系统（Obsidian 里改了文件，重开页签即刷新）——这是第一块的有意取舍。
import * as paths from './paths.js';
import * as store from './store.js';
import { reposBridge } from './repos-bridge.js';
import { parseWikiLinks, resolveWikiLink, normalizeWikiTarget } from '../../shared/wikilink.js';

const baseNameOf = (p) => String(p || '').replace(/\\/g, '/').split('/').pop().replace(/\.md$/i, '');

/**
 * 双链索引：[{ docId, name, rel?, path? }]
 * name = normalizeWikiTarget 后的文件名（比较口径与 core/wikilink.js 一致）。
 */
export async function buildIndex() {
  const { loadStore } = await reposBridge();
  const s = await loadStore();
  const closure = await store.externalClosure(s);
  const index = [];
  for (const f of await store.listOwnDocs()) {
    index.push({ docId: paths.ownDocId(f.rel), name: normalizeWikiTarget(baseNameOf(f.rel)), rel: f.rel });
  }
  for (const abs of await store.listExternalDocs(closure)) {
    index.push({ docId: paths.extDocId(abs), name: normalizeWikiTarget(baseNameOf(abs)), path: abs });
  }
  return index;
}

/**
 * 解析一个双链目标。index 可传入（渲染端已有缓存时避免重复建索引）。
 * 返回 { docId } | { candidates } | null——语义见 core/wikilink.js。
 */
export async function resolveLink(target, index) {
  return resolveWikiLink(target, index || (await buildIndex()));
}

/** 一篇文档里的全部双链引用：[{ target, label }] */
export function linksOf(body) {
  return parseWikiLinks(body);
}

// 反向索引（哪些文档链接到这里）暂不做：第一块只要「点得动」，backlink 记入后续。
