// 侧栏第一行（#181）：去掉 logo，命名空间切换器直接做行首主入口；
// 右侧保留设置 / 收起 / 关闭。ns 切换的拖拽落点（加入当前空间）也在这里。
import NsPicker from './ns-picker.js';
import type { SidebarNs } from '../../types.js';

export interface BrandRowProps {
  namespaces?: SidebarNs[];
  focusNs?: string;
  onFocusNs: (focus: string) => void;
  onNewNs: () => void;
  onManage: () => void;
  onAddCurrent: () => void;
  onDropHere: (key: string) => void;
}

export default function BrandRow(p: BrandRowProps) {
  return (
    <div className='brandrow ns-brandrow'>
      <NsPicker
        namespaces={p.namespaces}
        focusNs={p.focusNs}
        onFocus={p.onFocusNs}
        onNewNs={p.onNewNs}
        onManage={p.onManage}
        onAddCurrent={p.onAddCurrent}
        onDropHere={p.onDropHere}
      />
    </div>
  );
}
