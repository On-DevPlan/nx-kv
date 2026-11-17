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

/**
 * DocRef：{ ref } 指向文档库条目。
 *
 * #137 的 `tag` 已在 v12 删掉；#148 的 `note`（列表条目注解）在 v13 删掉——
 * 描述走 ref 自己的 desc + 正文标题，关系表不再挂业务字段。
 */
export interface DocRef {
  ref?: string;
}

/** 兼容旧调用方的类型别名（现在与 DocRef 同形）。 */
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

/** 归一化一条文档条目（v13 去 note 后就是浅拷贝，保留名字让调用方语义统一）。 */
export function withLinkMeta(ref: DocRef): DocRefWithMeta {
  return { ...ref };
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
