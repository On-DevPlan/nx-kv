// 分区相关的两个弹窗宿主（#178）：新建/重命名表单 + 成员选择。
// 抽成组件是为了让 index.tsx 只留一行接线（行数门禁），业务回调全部走 props。
import NsFormModal, { type NsFormState } from './ns-modal.js';
import NsAddModal, { type NsCandidate } from './ns-add-modal.js';
import NsManageModal from './ns-manage-modal.js';
import NsObserveModal from './ns-observe-modal.js';
import type { SidebarNs } from '../../types.js';

export interface NsDialogsProps {
  /** 新建/重命名表单（null = 关闭） */
  form: NsFormState | null;
  onFormClose: () => void;
  /** 保存：id 空 = 新建；'@@edit' = 重命名编辑中的实时值 */
  onSave: (id: string, name: string, moveKey: string | null) => void;
  /** 成员选择（null = 关闭；值是分区 id） */
  addFor: string | null;
  addCandidates: NsCandidate[];
  addNsName: string;
  onAddClose: () => void;
  onAdd: (keys: string[]) => void;
  /** #179：管理弹窗 */
  manageOpen: boolean;
  namespaces: SidebarNs[];
  focusNs?: string;
  onManageClose: () => void;
  onRenameNs: (id: string, name: string) => void;
  onMoveNs: (id: string, dir: -1 | 1) => void;
  onRemoveNs: (id: string) => void;
  onNewNs: () => void;
  onFocusNs: (id: string) => void;
  /** #181：详情观察 */
  observeOpen: boolean;
  onObserveClose: () => void;
  labelOf: (key: string) => string;
}

export default function NsDialogs(p: NsDialogsProps) {
  return (
    <>
      {p.addFor ? (
        <NsAddModal nsName={p.addNsName} candidates={p.addCandidates} onClose={p.onAddClose} onAdd={p.onAdd} />
      ) : null}
      {p.manageOpen ? (
        <NsManageModal
          namespaces={p.namespaces}
          focusNs={p.focusNs}
          onClose={p.onManageClose}
          onRename={p.onRenameNs}
          onMove={p.onMoveNs}
          onRemove={p.onRemoveNs}
          onNew={() => { p.onManageClose(); p.onNewNs(); }}
          onFocus={p.onFocusNs}
        />
      ) : null}
      {p.observeOpen ? (
        <NsObserveModal
          namespaces={p.namespaces}
          focusNs={p.focusNs}
          labelOf={p.labelOf}
          onClose={p.onObserveClose}
          onFocus={p.onFocusNs}
        />
      ) : null}
      {p.form ? <NsFormModal form={p.form} onClose={p.onFormClose} onSave={p.onSave} /> : null}
    </>
  );
}
