// 双链解析服务：把「文档名 → docId」的索引建出来，供渲染端点击导航。
//
// 索引 = 文档库全部有正文的自有文档 + 外部绑定闭包内的 .md。按面板打开时拉取一次，
// 不监听文件系统（Obsidian 里改了文件，重开页签即刷新）——这是第一块的有意取舍。
import * as store from './store.js';
import { parseWikiLinks, resolveWikiLink, normalizeWikiTarget } from '../../shared/wikilink.js';
import type { WikiIndexEntry, WikiResolveResult } from '../../shared/wikilink.js';

const baseNameOf = (p: unknown): string =>
  String(p || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? '';

/**
 * 双链索引：[{ docId, name, path? }]
 * name = normalizeWikiTarget 后的文件名（比较口径与 shared/wikilink 一致）。
 * 自有文档没有路径：名字取 desc → locator 末段 → refId（locator 只用于取名，不展示）。
 */
export async function buildIndex(): Promise<WikiIndexEntry[]> {
  const own = await store.listOwnDocs();
  const index: WikiIndexEntry[] = [];
  for (const f of own) {
    index.push({ docId: store.ownDocId(f.id), name: normalizeWikiTarget(f.desc || baseNameOf(f.locator) || f.id) });
  }
  const closure = await store.externalClosure();
  for (const abs of await store.listExternalDocs(closure)) {
    index.push({ docId: store.externalDocId(abs), name: normalizeWikiTarget(baseNameOf(abs)), path: abs });
  }
  return index;
}

/**
 * 解析一个双链目标。index 可传入（渲染端已有缓存时避免重复建索引）。
 * 返回 { docId } | { candidates } | null——语义见 shared/wikilink.ts。
 */
export async function resolveLink(target: unknown, index?: WikiIndexEntry[] | null): Promise<WikiResolveResult> {
  return resolveWikiLink(target, index || (await buildIndex()));
}

/** 一篇文档里的全部双链引用：[{ target, label }] */
export function linksOf(body: unknown): { target: string; label: string }[] {
  return parseWikiLinks(body);
}

// 反向索引（哪些文档链接到这里）暂不做：第一块只要「点得动」，backlink 记入后续。
