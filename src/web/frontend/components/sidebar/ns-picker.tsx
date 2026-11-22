// 侧栏**命名空间切换器**（#179）：namespace = 可切换的命名空间，不是「一屏叠所有分区」。
// 下拉选一个 → 侧栏只显示该命名空间的仓库/分组（无分区头行）；另有「运行中」「未分组」
// 两个内置视图与「全部分区（概览）」（拖动/管理的场所）。
import { DropdownButton } from '../button/index.js';
import { ACTIVE_KEY, ALL_KEY, UNGROUPED_KEY } from './model.js';
import type { SidebarNs } from '../../types.js';

export interface NsPickerProps {
  namespaces?: SidebarNs[];
  focusNs?: string;
  /** 切换视图（ns id / ACTIVE_KEY / UNGROUPED_KEY / ALL_KEY） */
  onFocus: (focus: string) => void;
  /** 新建命名空间 */
  onNewNs: () => void;
  /** 打开管理弹窗 */
  onManage: () => void;
  /** 向当前命名空间添加成员（非内置视图时显示 ＋） */
  onAddCurrent?: () => void;
}

export default function NsPicker({ namespaces = [], focusNs = '', onFocus, onNewNs, onManage, onAddCurrent }: NsPickerProps) {
  const list = Array.isArray(namespaces) ? namespaces : [];
  // #179：默认聚焦第一个命名空间（model 同口径）——标签跟着解析后的实际视图走
  const effective = list.length ? (focusNs || list[0]!.id) : '';
  const label = !list.length
    ? '全部分区'
    : effective === ACTIVE_KEY
      ? '运行中'
      : effective === UNGROUPED_KEY
        ? '未分组'
        : effective === ALL_KEY
          ? '全部分区'
          : (list.find((n) => n.id === effective)?.name || '全部分区');
  const isNs = list.some((n) => n.id === effective);
  return (
    <>
      <DropdownButton
        label={label}
        items={[
          ...list.map((n) => ({ key: n.id, label: n.name })),
          { key: ACTIVE_KEY, label: '运行中（有任务）' },
          { key: UNGROUPED_KEY, label: '未分组' },
          { key: ALL_KEY, label: '全部分区（概览）' },
          { key: '__MANAGE__', label: '管理命名空间…' },
          { key: '__NEW__', label: '＋ 新建命名空间…' },
        ]}
        variant='secondary'
        className='sb-ns-pick'
        title='切换命名空间（侧栏只显示所选空间里的仓库与分组）'
        onSelect={(k) => {
          if (k === '__NEW__') onNewNs();
          else if (k === '__MANAGE__') onManage();
          else onFocus(k);
        }}
      />
      {isNs && onAddCurrent ? (
        <button type="button" className="iconbtn sb-ns-add" title={`向「${label}」添加仓库或分组`} onClick={onAddCurrent}>
          ＋
        </button>
      ) : null}
    </>
  );
}
