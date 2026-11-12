// 文档侧 mdfile 的读取与巡检（业务编排，核心读写仍在 core/attachmentdb/mdfile）。
import { getDb } from '../../core/db/index.js';
import { tx } from '../../core/db/tx.js';
import { listMdfiles, readMdfile } from '../../core/attachmentdb.js';
import type { MdfileRow, ReadMdfileResult } from '../../core/attachmentdb.js';
import { badInput, notFound } from '../../core/errors.js';

/** 读一个 mdfile 的正文（读时校验指纹；缺失只标 missing_at）。 */
export async function readDocMdfile({ attachment }: { attachment?: unknown } = {}): Promise<ReadMdfileResult> {
  const id = String(attachment || '').trim();
  if (!id) throw badInput('需要 --attachment <mdfile 的附件 id>（见 docs mdfiles）');
  const db = getDb();
  let out: ReadMdfileResult | null = null;
  tx((conn) => {
    out = readMdfile(conn, id);
  }, { db, mode: 'IMMEDIATE' });
  if (!out) throw notFound(`没有这条 mdfile 附件: ${id}`);
  return out;
}

/** 列出全部已登记的 mdfile（--missing 只看已失效的）。 */
export async function listDocMdfiles({ missing = false }: { missing?: unknown } = {}): Promise<MdfileRow[]> {
  return listMdfiles(getDb(), { missingOnly: !!missing });
}
