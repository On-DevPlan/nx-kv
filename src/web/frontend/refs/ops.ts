// ref 列表的**写操作**（唯一入口）。
//
// 以前「新建 / 改描述 / 摘除归属 / 删文档」散在 refs 面板、文档页（介绍文档集）、
// 仓库管理页三处，各自拼 body、各自 toast、各自记得发 doc-bus 通知——行为一旦分叉，
// 列表就会出现「这边删了那边还在」的不一致（#120）。现在统一收在这里：
//   · 面板 ＋、文档页「补充」、仓库管理入口都调同一批函数；
//   · 每个写操作成功后统一 notifyDocsChanged()，所有列表靠总线刷新；
//   · 文案（toast）也跟着收口，避免同一个动作两种说法。
import {
  createRef,
  removeDocItem,
  setDocDesc,
  unbindRef,
  updateDocItem,
  type BindingRow,
} from './api.js';
import { notifyDocsChanged } from '../modules/md/doc-bus.js';

/** 新建文档的归属（与 refs 的 type 同口径）。 */
export type RefOwner = 'repo' | 'group' | 'group_repo';

export interface CreateDocArgs {
  owner: RefOwner;
  repo?: string;
  group?: string;
  desc?: string;
  /** 新建后立即写入的首行标题（可选）：文档页「补充一篇」用它起个名字 */
  title?: string;
}

/** 新建一篇空文档并返回 refId；建完会广播刷新。 */
export async function createDoc({ owner, repo, group, desc = '', title = '' }: CreateDocArgs): Promise<string> {
  const res = await createRef({ owner, repo, group, desc });
  if (title) {
    await updateDocItem({ ref: 'ref:' + res.refId, body: `# ${title}\n\n（待补）\n` });
  }
  notifyDocsChanged();
  return res.refId;
}

/** 改一句描述（desc）；空串 = 清掉描述。 */
export async function saveDesc(refId: string, desc: string): Promise<string> {
  const res = await setDocDesc(refId, String(desc || '').trim());
  notifyDocsChanged();
  return String(res?.desc ?? desc ?? '');
}

/** 摘除一条归属（文档与正文都保留）。 */
export async function detach(b: Pick<BindingRow, 'refId' | 'type' | 'repoKey' | 'groupKey'>): Promise<void> {
  await unbindRef({ ref: b.refId, type: b.type, repo: b.repoKey, group: b.groupKey || undefined });
  notifyDocsChanged();
}

/** 删除整篇文档（正文一并删，不可恢复；调用方负责确认弹窗）。 */
export async function removeDoc(refId: string): Promise<void> {
  await removeDocItem({ ref: 'ref:' + refId });
  notifyDocsChanged();
}
