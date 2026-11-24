// 分区管理弹窗（#179）：命名空间是**切换器**——管理动作（重命名 / 排序 / 删除 / 新建）
// 统一收进这里，侧栏里不再叠一排分区头行做管理入口。
// #256 增补：顶部搜索框（分区多了以后按名找）+ 每行「成员」展开该分区的条目清单，
// 在清单里直接移除 / 呼出成员添加弹窗；重命名改走标准表单弹窗（原生 prompt 已废）。
import { useMemo, useState } from 'react';
import { Modal } from '../popup/index.jsx';
import { Button } from '../button/index.js';
import { Icon } from '../icons.jsx';
import type { SidebarNs } from '../../types.js';

export interface NsManageModalProps {
  namespaces: SidebarNs[];
  /** 当前聚焦的命名空间 id（高亮） */
  focusNs?: string;
  onClose: () => void;
  /** 重命名：打开标准表单弹窗（宿主负责关本弹窗），不再用原生 prompt */
  onEditName: (id: string, name: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onNew: () => void;
  onFocus: (id: string) => void;
  /** #256：呼出「向该分区添加成员」弹窗（宿主负责关本弹窗） */
  onAddItems: (id: string) => void;
  /** #256：从该分区移除一个条目（items 键形：'board:<id>' | '<仓库key>'） */
  onRemoveItem: (nsId: string, itemKey: string) => void;
  /** 条目键 → 显示名（宿主的 labelOf） */
  labelOf: (key: string) => string;
}

export default function NsManageModal({
  namespaces, focusNs, onClose, onEditName, onMove, onRemove, onNew, onFocus,
  onAddItems, onRemoveItem, labelOf,
}: NsManageModalProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? list.filter((n) => (n.name || '').toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) : list),
    [list, q]
  );
  const expanded = expandedId ? list.find((n) => n.id === expandedId) : null;

  return (
    <Modal title="管理命名空间（分区）" onClose={onClose}>
      {/* #256：按名称 / id 搜索分区——分区一多，扫列表比搜索慢得多 */}
      <label className="sbox ns-manage-search">
        <input
          value={filter}
          placeholder="搜索命名空间…"
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }}
        />
      </label>
      {q ? <div className="ns-add-filter-note">{shown.length} / {list.length} 个分区匹配</div> : null}
      <div className="ns-add-list">
        {shown.length ? (
          shown.map((n, i) => {
            const isExpanded = expandedId === n.id;
            return (
              <div key={n.id} className={'ns-manage-cell' + (n.id === focusNs ? ' is-on' : '')}>
                <div className={'ns-manage-row' + (n.id === focusNs ? ' is-on' : '')}>
                  <button type="button" className="ns-manage-name" title="切换到这个命名空间"
                    onClick={() => { onFocus(n.id); onClose(); }}>
                    {n.pinned ? '★ ' : ''}{n.name}
                    <span className="ns-manage-count">{n.items.length} 项</span>
                  </button>
                  <span className="ns-manage-acts">
                    <Button small variant="secondary" title={isExpanded ? '收起成员' : '管理成员（增删）'}
                      onClick={() => setExpandedId(isExpanded ? null : n.id)}>成员</Button>
                    <Button small variant="secondary" disabled={i === 0} title="上移" onClick={() => onMove(n.id, -1)}>↑</Button>
                    <Button small variant="secondary" disabled={i === list.length - 1} title="下移" onClick={() => onMove(n.id, 1)}>↓</Button>
                    <Button small variant="secondary" title="重命名"
                      onClick={() => onEditName(n.id, n.name)}>重命名</Button>
                    <Button small variant="secondary" danger title="删除命名空间（其它命名空间不受影响）" onClick={() => onRemove(n.id)}>删除</Button>
                  </span>
                </div>
                {isExpanded && expanded ? (
                  <div className="ns-manage-items">
                    {expanded.items.length ? (
                      expanded.items.map((k) => (
                        <div key={k} className="ns-manage-item" title={k}>
                          <span className={'ns-add-kind ' + (k.startsWith('board:') ? 'board' : 'repo')}>
                            {k.startsWith('board:') ? '分组' : '仓库'}
                          </span>
                          <span className="ns-manage-item-name">{labelOf(k)}</span>
                          <button type="button" className="ns-manage-item-del" title="从该分区移除（登记与其它分区不受影响）"
                            onClick={() => onRemoveItem(n.id, k)}>
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="setp-note">空分区——用下面「添加成员」或拖拽侧栏行加入。</div>
                    )}
                    <Button small variant="secondary" onClick={() => onAddItems(n.id)}>＋ 添加成员</Button>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="setp-note">{q ? '没有匹配的命名空间——换个关键词试试。' : '还没有命名空间——点下面「新建」开始。'}</div>
        )}
      </div>
      <div className="form-acts">
        <Button variant="secondary" onClick={onClose}>关闭</Button>
        <Button onClick={onNew}>＋ 新建命名空间</Button>
      </div>
    </Modal>
  );
}
