// 分区相关的两个弹窗宿主（#178）：新建/重命名表单 + 成员选择。
// 抽成组件是为了让 index.tsx 只留一行接线（行数门禁），业务回调全部走 props。
import NsFormModal, { type NsFormState } from './ns-modal.js';
import NsAddModal, { type NsCandidate } from './ns-add-modal.js';

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
}

export default function NsDialogs(p: NsDialogsProps) {
  return (
    <>
      {p.addFor ? (
        <NsAddModal nsName={p.addNsName} candidates={p.addCandidates} onClose={p.onAddClose} onAdd={p.onAdd} />
      ) : null}
      {p.form ? <NsFormModal form={p.form} onClose={p.onFormClose} onSave={p.onSave} /> : null}
    </>
  );
}
