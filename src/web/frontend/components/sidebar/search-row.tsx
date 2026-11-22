// 侧栏搜索行（#179 抽出）：命名空间切换器 + 搜索框 + 添加入口。
// 从 index.tsx 抽出的纯渲染块——状态与回调全部由 Sidebar 传入。
import { Icon } from '../icons.jsx';
import NsPicker from './ns-picker.js';
import type { SidebarNs } from '../../types.js';

export interface SearchRowProps {
  kw: string;
  onKw: (v: string) => void;
  matchCount: number;
  namespaces?: SidebarNs[];
  focusNs?: string;
  onFocusNs: (focus: string) => void;
  onNewNs: () => void;
  onManage: () => void;
  onAddCurrent: () => void;
  onAddMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export default function SearchRow(p: SearchRowProps) {
  return (
    <div className='searchrow sb-ns-row'>
      <NsPicker
        namespaces={p.namespaces}
        focusNs={p.focusNs}
        onFocus={p.onFocusNs}
        onNewNs={p.onNewNs}
        onManage={p.onManage}
        onAddCurrent={p.onAddCurrent}
      />
      <label className='sbox'>
        <Icon name='search' />
        <input
          value={p.kw}
          placeholder='搜索仓库（命中自动展开）'
          onChange={(e) => p.onKw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') p.onKw(''); }}
        />
      </label>
      {p.kw ? <span className='kwcount'>{p.matchCount} 个匹配</span> : null}
      <button className='iconbtn add' title='添加目录 / 新建分组' aria-label='添加目录或新建分组' onClick={p.onAddMenu}>
        <Icon name='plus' />
      </button>
    </div>
  );
}
