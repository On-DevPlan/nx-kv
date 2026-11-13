// DocRef（宿主绑定字段）与 docId 的校验。
//
// 刻意**不依赖 repos/service.js**：services 的 loadStore 要用 sanitizeDocRef
// 做读时归一，而 docs/paths.js 又依赖 repos/service——校验逻辑单独成文件，
// 依赖链保持单向（repos/service → docs/docref，是叶子）。
//
// v8 形状：DocRef 只有 { ref }（refs.id）。
// 外部文件/目录不再直接写进宿主字段：先落一条 origin='external' 的 ref，
// 实际位置在 refs.locator；宿主只认 refId。
import { badInput } from '../../core/errors.js';

/** DocRef：{ ref } 指向文档库条目；note/tag 是列表条目的注解（docLinks 用）。 */
export interface DocRef {
  ref?: string;
  /** 链接级注解（note/tag，docLinks 条目用） */
  note?: string;
  tag?: string;
}

/** DocRef + 链接级注解（withLinkMeta 的产出形状）。 */
export type DocRefWithMeta = DocRef;

const REF_ID_RE = /^ref_[0-9a-f]{16}$/i;

/** refId 校验：`ref_<16hex>`（ref 是 DB 实体，地址就是 id）。 */
export function assertRefId(id: unknown, label = '文档'): string {
  const s = String(id ?? '').trim();
  if (!REF_ID_RE.test(s)) throw badInput(label + '必须是 refId（ref_<16hex>）: ' + String(id));
  return s.toLowerCase();
}

/** 严格版：形状非法抛 badInput（绑定写入口用） */
export function assertDocRef(raw: unknown): DocRef {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badInput('绑定必须是 { ref }');
  }
  const o = raw as { ref?: unknown };
  const ref = typeof o.ref === 'string' ? o.ref.trim() : '';
  if (!ref) throw badInput('绑定不能为空（--ref 给 refId）');
  return { ref: assertRefId(ref) };
}

/** 宽松版：非法返回 null（loadStore 归一化用——盘上脏数据丢弃，不炸读取） */
export function sanitizeDocRef(raw: unknown): DocRef | null {
  try {
    return assertDocRef(raw);
  } catch {
    return null;
  }
}

/**
 * DocRef + 链接级注解（note/tag）合成列表条目。
 *
 * 注解要过三道关（写入口合并 / 读归一化回贴 / 导出保留），三处口径必须一致——
 * 实现只此一份，docs/refs 与 repos/service、transfer 都从这里拿。
 * 空串/缺省 = 不落字段（对已有条目即「清掉」）。
 */
export function withLinkMeta(ref: DocRef, raw: { note?: unknown; tag?: unknown } = {}): DocRefWithMeta {
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  const tag = typeof raw.tag === 'string' ? raw.tag.trim() : '';
  const entry: DocRefWithMeta = { ...ref };
  if (note) entry.note = note;
  if (tag) entry.tag = tag;
  return entry;
}

// ─── docId（前后端统一寻址）────────────────────────────────────────────
//
// 自有 / 外部 ref 统一：ref:<refId>（裸 ref_<16hex> 也认——CLI --ref 用）。
// 外部目录里的裸文件（不是文档库条目）仍用 path:<绝对路径>，由 getDoc 的
// 外部分支处理；它不属于 ref，也不参与归属/绑定。

export function ownDocId(refId: string): string {
  return 'ref:' + refId;
}

export function extDocId(abs: string): string {
  return 'path:' + abs;
}
