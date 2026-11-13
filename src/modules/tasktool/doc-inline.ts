// tasktool/doc-inline.js —— 任务级文档绑定的「进原文」（#162）。
//
// role='doc' 的 kind=ref 附件 = **文档资料绑定**：交付时把文档全文附进 instruction，
// 而不是只给一条 `docs get` 命令——agent 少跑一轮 nx-kv（任务原文口径：
// 「减少反复访问 nxkv 的开销」）。
//
// 读侧纪律（v8）：
//   - **只读、只认 DB**：ref 正文按 refId 从 ref_bodies 读，缺失不播种；
//   - 外部 ref（origin='external'）**不直读盘**：必须先在 attachments 里登记成 mdfile，
//     经 `readMdfile`（唯一文件读入口）取正文；没登记 → 显式提示 + 给登记命令；
//   - fail-open：读不到 → 内容留空，清单与取用命令照给，绝不拖垮领取。
import { MAX_INLINE_DOC_CHARS } from './attach-resource.js';
import { findMdfileByPath, noBodyReason, readMdfile, refDocById } from '../../core/attachmentdb.js';
import { getDb } from '../../core/db/index.js';

/** 外部 md 正文：只认已登记的 mdfile（唯一文件读入口）。 */
function readExternalViaMdfile(db: any, locator: string): string | null {
  const rec = findMdfileByPath(db, locator);
  if (!rec) return null;
  const read = readMdfile(db, rec.id);
  if (!read || read.missing) return null;
  return read.body;
}

/**
 * 读一篇 ref 资源的正文（进原文用）：只认 refId。
 * 外部 ref → mdfile；目录 / 缺失 → null（fail-open）。
 */
export async function readRefDocBody(refId: unknown): Promise<string | null> {
  const id = String(refId || '').trim();
  if (!id) return null;
  const db = getDb();
  const row = refDocById(db, id);
  if (!row) return null;
  if (row.origin === 'external') {
    return row.locator ? readExternalViaMdfile(db, row.locator) : null;
  }
  return row.hasBody ? String(row.body ?? '') : null;
}

/** 交付里没内联时的人读原因。 */
function missingReasonOf(db: any, refId: string): string {
  const row = refDocById(db, refId);
  if (!row) return '文档条目不存在';
  if (row.origin === 'external') return '该文档未登记为附件，无法内联';
  return noBodyReason(row.kind);
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
    const refId = String(a.refId || a.targetKey || '');
    let body: string | null = null;
    try {
      body = await readRefDocBody(refId);
    } catch {
      body = null;
    }
    const text = String(body ?? '');
    if (!text.trim()) {
      a.docMissing = true;
      a.docMissingReason = missingReasonOf(db, refId);
      const row = refDocById(db, refId);
      if (row && row.origin === 'external' && row.locator) {
        const addr = [seq ? `--id ${seq}` : '', key ? `--key ${key}` : ''].filter(Boolean).join(' ');
        a.docRegisterCmd = `nx-kv localtask attach ${addr ? addr + ' ' : ''}--mdfile "${row.locator}"`;
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
