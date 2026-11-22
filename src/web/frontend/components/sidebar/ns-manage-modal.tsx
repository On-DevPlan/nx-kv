// 分区管理弹窗（#179）：命名空间是**切换器**——管理动作（重命名 / 排序 / 删除 / 新建）
// 统一收进这里，侧栏里不再叠一排分区头行做管理入口。
import { Modal } from '../popup/index.jsx';
import { Button } from '../button/index.js';
import type { SidebarNs } from '../../types.js';

export interface NsManageModalProps {
  namespaces: SidebarNs[];
  /** 当前聚焦的命名空间 id（高亮） */
  focusNs?: string;
  onClose: () => void;
  onRename: (id: string, name: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onNew: () => void;
  onFocus: (id: string) => void;
}

export default function NsManageModal({
  namespaces, focusNs, onClose, onRename, onMove, onRemove, onNew, onFocus,
}: NsManageModalProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  return (
    <Modal title="管理命名空间（分区）" onClose={onClose}>
      <div className="ns-add-list">
        {list.length ? (
          list.map((n, i) => (
            <div key={n.id} className={'ns-manage-row' + (n.id === focusNs ? ' is-on' : '')}>
              <button type="button" className="ns-manage-name" title="切换到这个命名空间"
                onClick={() => { onFocus(n.id); onClose(); }}>
                {n.pinned ? '★ ' : ''}{n.name}
                <span className="ns-manage-count">{n.items.length} 项</span>
              </button>
              <span className="ns-manage-acts">
                <Button small variant="secondary" disabled={i === 0} title="上移" onClick={() => onMove(n.id, -1)}>↑</Button>
                <Button small variant="secondary" disabled={i === list.length - 1} title="下移" onClick={() => onMove(n.id, 1)}>↓</Button>
                <Button small variant="secondary" title="重命名"
                  onClick={() => {
                    const name = window.prompt('重命名命名空间', n.name);
                    if (name && name.trim()) onRename(n.id, name.trim());
                  }}>重命名</Button>
                <Button small variant="secondary" danger title="删除命名空间（其它命名空间不受影响）" onClick={() => onRemove(n.id)}>删除</Button>
              </span>
            </div>
          ))
        ) : (
          <div className="setp-note">还没有命名空间——点下面「新建」开始。</div>
        )}
      </div>
      <div className="form-acts">
        <Button variant="secondary" onClick={onClose}>关闭</Button>
        <Button onClick={onNew}>＋ 新建命名空间</Button>
      </div>
    </Modal>
  );
}
