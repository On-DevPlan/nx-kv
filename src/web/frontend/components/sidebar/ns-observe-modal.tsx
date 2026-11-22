// 「更多 → 命名空间详情观察」（#181）：在筛选行点「更多」打开——
// 一屏看清每个命名空间里有哪些仓库/分组、各多少项，可直接点某行切过去。
import { Modal } from '../popup/index.jsx';
import type { SidebarNs } from '../../types.js';

export interface NsObserveModalProps {
  namespaces: SidebarNs[]
  focusNs?: string
  /** key → 显示名（仓库 / 分组） */
  labelOf: (key: string) => string
  onClose: () => void
  onFocus: (id: string) => void
}

export default function NsObserveModal({ namespaces, focusNs, labelOf, onClose, onFocus }: NsObserveModalProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  return (
    <Modal title='命名空间详情' onClose={onClose}>
      <div className='ns-observe-list'>
        {list.length ? list.map((n) => (
          <div key={n.id} className={'ns-observe-row' + ((focusNs || list[0]?.id) === n.id ? ' is-current' : '')}>
            <button type='button' className='ns-observe-head' onClick={() => { onFocus(n.id); onClose(); }}>
              <span className='ns-observe-name'>{n.pinned ? '★ ' : ''}{n.name}</span>
              <span className='ns-observe-count'>{n.items.length} 项</span>
            </button>
            <div className='ns-observe-items'>
              {n.items.length
                ? n.items.map((k) => <span key={k} className='ns-observe-chip'>{labelOf(k)}</span>)
                : <span className='ns-observe-empty'>（空）</span>}
            </div>
          </div>
        )) : <div className='setp-note'>还没有命名空间——点切换器里的「＋ 新建分组」开始。</div>}
      </div>
    </Modal>
  );
}
