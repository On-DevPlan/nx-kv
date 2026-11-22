// 侧栏视图下拉（#174）：全部分区 / 单分区聚焦 / 运行中（有任务的） / 新建分区。
// 纯显示态（prefs.focusNs）——替代已下线的「全部目录总览」与设置页「侧栏显示」。
import { DropdownButton } from '../button/index.js';
import { ACTIVE_KEY } from './model.js';
import type { SidebarNs } from '../../types.js';

export interface NsPickerProps {
  namespaces?: SidebarNs[];
  focusNs?: string;
  /** 切换视图（'' = 全部分区 / ACTIVE_KEY = 运行中 / ns id = 单分区） */
  onFocus: (focus: string) => void;
  /** 新建分区（下拉末项） */
  onNewNs: () => void;
}

export default function NsPicker({ namespaces = [], focusNs = '', onFocus, onNewNs }: NsPickerProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  const label = focusNs === ACTIVE_KEY
    ? '运行中'
    : focusNs
      ? (list.find((n) => n.id === focusNs)?.name || '全部分区')
      : '全部分区';
  return (
    <DropdownButton
      label={label}
      items={[
        { key: '', label: '全部分区' },
        ...list.map((n) => ({ key: n.id, label: n.name })),
        { key: ACTIVE_KEY, label: '运行中（有任务）' },
        { key: '__NEW__', label: '＋ 新建分区…' },
      ]}
      variant='secondary'
      className='sb-ns-pick'
      title='切换侧栏视图：分区 / 运行中（有任务的仓库与看板）'
      onSelect={(k) => {
        if (k === '__NEW__') onNewNs();
        else onFocus(k);
      }}
    />
  );
}
