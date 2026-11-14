// 宿主文档引用的清理（#132）。
//
// 宿主的文档集存在两处：仓库/组的 `ext.doc`（主篇）与 `ext.docLinks`（补充篇）
// （组的还有 `ext.repoDocs`——组内仓库在组里的那一篇）。这些 refId 是**语义权威**：
// 留着悬空 refId 会让「项目介绍」看着有、实际读不到正文，文档列表也会多出空行。
//
// 两处会留下悬空引用：
//   · `doc.remove` 删文档时（#132 修的就是这条：删除后宿主 ext 仍指着已删 ref）；
//   · `docs gc` 批量清空正文时（#114 起就有清理逻辑）。
// 所以清理逻辑抽到这里，两边共用一份口径。
import { reposBridge } from './repos-bridge.js';

/**
 * 从 store 里摘掉指向 doomed 的宿主文档引用。
 * @param store repos store（可改的草案对象）
 * @param doomed 要摘掉的 refId 集合
 * @returns 清理处数（主篇 1 + 补充篇若干 + 组内仓库篇若干）
 */
export function scrubHostDocRefs(store: any, doomed: Set<string>): number {
  let touched = 0;
  const scrubDoc = (host: any): void => {
    if (!host) return;
    if (host.doc && doomed.has(String(host.doc.ref))) {
      host.doc = null;
      touched++;
    }
    if (Array.isArray(host.docLinks)) {
      const kept = host.docLinks.filter((l: any) => !doomed.has(String(l && l.ref)));
      if (kept.length !== host.docLinks.length) {
        host.docLinks = kept;
        touched++;
      }
    }
  };
  for (const r of store.repos || []) {
    if (r.type === 'group') continue;
    scrubDoc(r);
  }
  for (const b of store.boards || []) {
    scrubDoc(b);
    if (b.repoDocs && typeof b.repoDocs === 'object') {
      for (const [k, v] of Object.entries(b.repoDocs)) {
        if (doomed.has(String((v as any) && (v as any).ref))) {
          delete b.repoDocs[k];
          touched++;
        }
      }
    }
  }
  return touched;
}

/**
 * 落库式清理：把 store 里指向 doomed 的宿主引用摘掉并写回。
 * 走 repos 桥（docs 不静态依赖 repos）；桥不可用时静默跳过——文档已经删了，
 * 宿主引用只是「多一条指向空处的指针」，不该让删除动作整体失败。
 */
export async function scrubHosts(doomed: Set<string>): Promise<number> {
  if (!doomed.size) return 0;
  try {
    const { mutateStore } = await reposBridge();
    let touched = 0;
    await mutateStore((s: any) => {
      touched = scrubHostDocRefs(s, doomed);
    });
    return touched;
  } catch {
    return 0;
  }
}
