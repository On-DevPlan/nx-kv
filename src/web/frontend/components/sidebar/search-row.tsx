// 侧栏搜索行（#179 抽出）：命名空间切换器 + 搜索框 + 添加入口。
// 从 index.tsx 抽出的纯渲染块——状态与回调全部由 Sidebar 传入。
import { Icon } from '../icons.jsx';

export interface SearchRowProps {
  kw: string;
  onKw: (v: string) => void;
  matchCount: number;
  onAddMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** #181：筛选行「更多」——打开命名空间详情观察 */
  onMore?: () => void;
}

export default function SearchRow(p: SearchRowProps) {
  return (
    <div className='searchrow'>
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
      {p.onMore ? (
        <button className='iconbtn more' title='更多：查看命名空间详情' aria-label='命名空间详情' onClick={p.onMore}>
          <Icon name='dots' size={13} />
        </button>
      ) : null}
    </div>
  );
}
