// tasktool/doc-inline.js —— 任务级文档绑定的「进原文」（#162）。
//
// role='doc' 的 kind=ref 附件 = **文档资料绑定**：交付时把文档全文附进 instruction，
// 而不是只给一条 `docs get` 命令——agent 少跑一轮 nx-kv（任务原文口径：
// 「减少反复访问 nxkv 的开销」）。
//
// 读侧纪律（2026-11 DOCS_DIR 收口后）：
//   - **只读、只认 DB**：自有 rel 走 docs store 的 DB 读取，缺失不播种；
//   - 外部绝对路径**不再直读盘**：必须先在 attachments 里登记成 mdfile，
//     经 `readMdfile`（唯一文件读入口）取正文；没登记 → 显式提示 + 给登记命令；
//   - fail-open：读不到 → 内容留空，清单与取用命令照给，绝不拖垮领取。
import { isAbsolute } from 'node:path';
import { MAX_INLINE_DOC_CHARS } from './attach-resource.js';
import { findMdfileByPath, noBodyReason, readMdfile, relKindOf } from '../../core/attachmentdb.js';
import { getDb } from '../../core/db/index.js';

let docsStoreMod: any = null;
async function docsStore(): Promise<any> {
  if (!docsStoreMod) docsStoreMod = await import('../docs/store.js');
  return docsStoreMod;
}

/** 逻辑 rel（external/<sha1>）→ 原始绝对路径；不是 ref 行就返回 ''。 */
function locatorOfRel(db: any, rel: string): string {
  const row = db.get('SELECT locator FROM refs WHERE rel = :rel AND deleted_at IS NULL', { rel });
  return String(row?.locator || '');
}

/** 外部 md 正文：只认已登记的 mdfile（唯一文件读入口）。 */
function readExternalViaMdfile(db: any, locator: string): string | null {
  const rec = findMdfileByPath(db, locator);
  if (!rec) return null;
  const read = readMdfile(db, rec.id);
  if (!read || read.missing) return null;
  return read.body;
}

/**
 * 读一篇 ref 资源的正文（进原文用）。locator = refs 表的 locator / rel：
 * 自有树相对路径 / 外部绝对路径 / external/<sha1> 逻辑名。
 * 目录绑定、缺失、未登记 mdfile → null（fail-open）。
 */
export async function readRefDocBody(locator: unknown): Promise<string | null> {
  const raw = String(locator || '').trim();
  if (!raw) return null;
  const db = getDb();
  if (!isAbsolute(raw)) {
    try {
      return await (await docsStore()).readOwnDoc(raw);
    } catch {
      // 不是自有文档：可能是不在库里的历史壳行 / 外部逻辑名，继续按外部处理
    }
  }
  const abs = isAbsolute(raw) ? raw : locatorOfRel(db, raw);
  if (!isAbsolute(abs)) return null;
  // 外部 md 必须先登记成 mdfile 附件；未登记不允许直读盘（DOCS_DIR 收口）
  return readExternalViaMdfile(db, abs);
}

/** 交付里没内联时的人读原因。 */
function missingReasonOf(raw: string): string {
  if (!isAbsolute(raw) && !raw.startsWith('external/')) {
    return noBodyReason(relKindOf(raw, false));
  }
  return '该文档未登记为附件，无法内联';
}

/**
 * 给附件视图模型补「文档原文」：role='doc' 且 kind='ref' 的项读全文（截断 2 万字）。
 * 就地写 docContent / docTruncated，并把文档首行 # 标题带到 docTitle——
 * 绑定条目常只有文件名，agent 看「〔文档原文 · <真标题>〕」比看文件名更知道里面是什么。
 * 读不到就留空，并显式标 `docMissing` + 原因；外部 md 另带**可直接执行**的登记命令。
 */
export async function inlineDocContent(items: any, task?: { id?: unknown; key?: unknown }): Promise<void> {
  const db = getDb();
  const seq = Number(task?.id) || 0;
  const key = String(task?.key || '');
  for (const a of Array.isArray(items) ? items : []) {
    if (a.kind !== 'ref' || a.role !== 'doc' || a.docContent) continue;
    const raw = String(a.relPath || a.targetKey || a.locator || '');
    let body: string | null = null;
    try {
      body = await readRefDocBody(raw);
    } catch {
      body = null;
    }
    const text = String(body ?? '');
    if (!text.trim()) {
      // v6：没有正文的条目在交付清单里显式标 missing（不输出空串冒充正文）
      a.docMissing = true;
      a.docMissingReason = missingReasonOf(raw);
      const abs = isAbsolute(raw) ? raw : locatorOfRel(db, raw);
      if (abs) {
        const addr = [seq ? `--id ${seq}` : '', key ? `--key ${key}` : ''].filter(Boolean).join(' ');
        a.docRegisterCmd = `nx-kv localtask attach ${addr ? addr + ' ' : ''}--mdfile "${abs}"`;
      }
      continue;
    }
    const m = /^#\s+(.+)$/m.exec(text);
    const title = m?.[1] ?? '';
    if (title.trim()) a.docTitle = title.trim();
    if (text.length > MAX_INLINE_DOC_CHARS) {
      a.docContent = text.slice(0, MAX_INLINE_DOC_CHARS);
      a.docTruncated = true;
    } else {
      a.docContent = text;
      a.docTruncated = false;
    }
  }
}
