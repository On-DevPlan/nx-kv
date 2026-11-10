// tasktool/doc-inline.js —— 任务级文档绑定的「进原文」（#162）。
//
// role='doc' 的 kind=ref 附件 = **文档资料绑定**：交付时把文档全文附进 instruction，
// 而不是只给一条 `docs get` 命令——agent 少跑一轮 nx-kv（任务原文口径：
// 「减少反复访问 nxkv 的开销」）。
//
// 读侧纪律：
//   - **只读**：自有 rel 直接读 docs 树，缺失不播种（交付/预览都不许有写副作用）；
//   - 外部绝对路径必须落在绑定闭包内（与 docs get 的读侧守卫同口径，
//     否则交付链就成了任意文件读入口）；
//   - fail-open：读不到 → 内容留空，清单与取用命令照给，绝不拖垮领取。
import { isAbsolute } from 'node:path';
import { MAX_INLINE_DOC_CHARS } from './attach-resource.js';

let docsStoreMod = null;
async function docsStore() {
  if (!docsStoreMod) docsStoreMod = await import('../docs/store.js');
  return docsStoreMod;
}

let docsBridgeMod = null;
async function docsBridge() {
  if (!docsBridgeMod) docsBridgeMod = await import('../docs/repos-bridge.js');
  return docsBridgeMod;
}

/**
 * 读一篇 ref 资源的正文（进原文用）。locator = refs 表的 locator：
 * 自有树相对路径 / 外部绝对路径。目录绑定、缺失、闭包外 → null（fail-open）。
 */
export async function readRefDocBody(locator) {
  const raw = String(locator || '').trim();
  if (!raw) return null;
  const store = await docsStore();
  if (!isAbsolute(raw)) {
    try {
      return await store.readOwnDoc(raw);
    } catch {
      return null; // 缺失不播种：交付只读
    }
  }
  const { loadStore } = await docsBridge().then((m) => m.reposBridge());
  const s = await loadStore();
  const closure = await store.externalClosure(s);
  const abs = store.resolveExternal(raw, closure);
  if (!abs) return null; // 闭包外一律不给（任意文件读闸门）
  const fsp = await import('node:fs/promises');
  const st = await fsp.stat(abs).catch(() => null);
  if (!st || !st.isFile()) return null;
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 给附件视图模型补「文档原文」：role='doc' 且 kind='ref' 的项读全文（截断 2 万字）。
 * 就地写 docContent / docTruncated，并把文档首行 # 标题带到 docTitle——
 * 绑定条目常只有文件名，agent 看「〔文档原文 · <真标题>〕」比看文件名更知道里面是什么。
 * 读不到就留空——调用方照常渲染路径与命令。
 */
export async function inlineDocContent(items) {
  for (const a of Array.isArray(items) ? items : []) {
    if (a.kind !== 'ref' || a.role !== 'doc' || a.docContent) continue;
    let body = null;
    try {
      body = await readRefDocBody(a.relPath || a.targetKey || '');
    } catch {
      body = null;
    }
    const text = String(body ?? '');
    if (!text.trim()) continue;
    const m = /^#\s+(.+)$/m.exec(text);
    if (m && m[1].trim()) a.docTitle = m[1].trim();
    if (text.length > MAX_INLINE_DOC_CHARS) {
      a.docContent = text.slice(0, MAX_INLINE_DOC_CHARS);
      a.docTruncated = true;
    } else {
      a.docContent = text;
      a.docTruncated = false;
    }
  }
}
