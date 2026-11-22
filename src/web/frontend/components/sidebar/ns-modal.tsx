// 侧栏分区（namespace）的新建/重命名表单（#167）——从 index.tsx 拆出。
// id 空 = 新建；moveTo 带条目键 = 建完即把该条目移入新分区。
import { Modal } from '../popup/index.jsx';

export interface NsFormState {
  /** 空 = 新建；否则为分区 id（重命名） */
  id: string;
  name: string;
  /** 建完即移入的条目键（'board:<id>' | '<仓库key>'） */
  moveTo?: string;
}

export interface NsModalProps {
  form: NsFormState;
  onClose: () => void;
  /** (id, name, moveKey)：id 为空 = 新建 */
  onSave: (id: string, name: string, moveKey: string | null) => void;
}

export default function NsFormModal({ form, onClose, onSave }: NsModalProps) {
  return (
    <Modal title={form.id ? '重命名分区' : '新建分区（namespace）'} onClose={onClose}>
      <div className="form-grid">
        <div className="form-field">
          <label htmlFor="sb-ns-name">名称</label>
          <input
            id="sb-ns-name"
            value={form.name}
            spellCheck="false"
            placeholder="分区名，如 工作 / 自研 / 临时"
            autoFocus
            onChange={(e) => onSave('@@edit', e.target.value, null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && form.name.trim()) {
                onSave(form.id, form.name.trim(), form.moveTo ?? null);
                onClose();
              }
            }}
          />
        </div>
        <div className="form-acts">
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button
            type="button"
            className="btn"
            disabled={!form.name.trim()}
            onClick={() => {
              onSave(form.id, form.name.trim(), form.moveTo ?? null);
              onClose();
            }}
          >
            {form.id ? '保存' : '新建分区'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
