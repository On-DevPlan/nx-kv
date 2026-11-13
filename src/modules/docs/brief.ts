// 「描述即文档」：把一个所有者（repo / board）的绑定文档集整理成短视图。
//
// v8 口径：宿主 ext 只存 DocRef{ref}（refId），文档标题/描述从 refs/ref_bodies 读；
// 不再有约定路径、文件是否存在、rel。列表接口给前端「这个项目/组挂了哪几篇文档」。
import { refDocById } from '../../core/attachmentdb.js';
import { docTitleFromMd } from '../../shared/doc-title.js';
import { summaryFromMd } from './seed.js';

const baseNameOf = (p: unknown): string =>
  String(p || '').replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/i, '') ?? '';

/**
 * 文档的**显示名**（人看的名字）。
 *
 * v8 起文档没有路径名了（rel 概念整个删掉），名字只能从内容里来：
 *   正文首行 `# 标题` → desc（v7 短描述）→ 正文首行摘要 → locator 末段（只是文件名，不是路径）→ 兜底。
 * 没有这条链的话，一篇**没有 `# 标题`**的旧文档在界面上会全叫「未命名文档」
 * ——路径删除之前，路径本身就是它的名字。
 */
export function refTitleOf(
  row: { body?: string | null; desc?: string; locator?: string; origin?: string },
  fallback = ''
): string {
  const body = String(row.body ?? '');
  const title = docTitleFromMd(body);
  if (title) return title;
  const desc = String(row.desc || '').trim();
  if (desc) return desc;
  const summary = summaryFromMd(body);
  if (summary) return summary;
  const stem = baseNameOf(row.locator);
  if (stem) return stem;
  return fallback;
}

/** 一篇文档的短视图（前端 DocBrief 的数据面）。 */
export interface DocBriefView {
  /** refs.id */
  refId: string;
  /** 面板导航地址：ref:<refId> */
  docId: string;
  /** 正文首行标题 → desc → 所有者名 */
  title: string;
  /** 短描述（v7） */
  desc: string;
  /** 正文摘要（首个非标题行）；没有正文时为空 */
  summary: string;
  note: string;
  tag: string;
  /** 有正文（外部镜像也算存在：正文在库外） */
  exists: boolean;
  missing?: boolean;
}

/** 文档集短视图。 */
export interface DocSetView {
  main: DocBriefView | null;
  links: DocBriefView[];
  count: number;
}

/**
 * 批量取 ref 的**文档标题**（#168）：标题 = 正文首行的 `# 标题`。
 * 用途：面板/交付清单里的 ref 条目按标题显示；读不到就不给（调用方回落 desc / refId）。
 */
export async function refTitlesOf(
  refs?: Array<{ id?: string; refId?: string; locator?: string }> | null
): Promise<Map<string, string>> {
  const { getDb } = await import('../../core/db/index.js');
  const out = new Map<string, string>();
  for (const r of refs || []) {
    const id = String((r && (r.id || r.refId)) || '');
    if (!id || out.has(id)) continue;
    const row = refDocById(getDb(), id);
    if (!row || !row.hasBody) continue;
    const title = docTitleFromMd(String(row.body ?? ''));
    if (title) out.set(id, title);
  }
  return out;
}

/**
 * 文档集短视图。
 * @param owner repo 或 board 记录
 * @param _kind 兼容旧签名（repo / board），当前读取口径一致
 */
export async function docSetOf(owner: any, _kind: 'repo' | 'board' = 'repo'): Promise<DocSetView> {
  if (!owner) return { main: null, links: [], count: 0 };
  const { getDb } = await import('../../core/db/index.js');
  const db = getDb();
  const viewOf = (raw: any): DocBriefView | null => {
    const refId = String((raw && raw.ref) || '').trim();
    if (!refId) return null;
    const row = refDocById(db, refId);
    if (!row) return null;
    const body = row.hasBody ? String(row.body ?? '') : '';
    const title = refTitleOf(
      { body, desc: row.desc, locator: row.locator, origin: row.origin },
      String(owner.name || '')
    );
    return {
      refId: row.id,
      docId: 'ref:' + row.id,
      title,
      desc: row.desc,
      summary: body ? summaryFromMd(body) : '',
      note: String((raw && raw.note) || ''),
      tag: String((raw && raw.tag) || ''),
      exists: row.hasBody || row.origin === 'external',
      ...(row.hasBody || row.origin === 'external' ? {} : { missing: true }),
    };
  };

  const main = viewOf(owner.doc);
  const links = (Array.isArray(owner.docLinks) ? owner.docLinks : [])
    .map(viewOf)
    .filter((x: DocBriefView | null): x is DocBriefView => !!x);
  return { main, links, count: (main ? 1 : 0) + links.length };
}
