// 「关联参考仓库」区块（#184）：搜索已登记仓库 → 选中后挂指针（不走 folder）。
// 抽成组件是为了让 attach-modal 不因新增区块超行数门禁。
export interface RepoPickItem {
  key: string;
  name: string;
  desc?: string;
  type?: string;
  path?: string;
}

export interface AttachRepoPickProps {
  repos: RepoPickItem[];
  list: RepoPickItem[];
  search: string;
  onSearch: (v: string) => void;
  onPick: (r: RepoPickItem) => void;
}

export default function AttachRepoPick({ repos, list, search, onSearch, onPick }: AttachRepoPickProps) {
  return (
    <div className='att-pick'>
      <div className='att-pick-head'>关联参考仓库（repo）</div>
      <input
        className='pp-input'
        placeholder='搜索仓库名 / key / 描述'
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          const first = list[0];
          if (e.key === 'Enter' && first) { e.preventDefault(); onPick(first); }
        }}
        spellCheck='false'
      />
      {list.length ? (
        <div className='att-pick-list'>
          {list.map((r) => (
            <button key={r.key} type='button' className='att-pick-item' onClick={() => onPick(r)}>
              <span className='att-pick-main'>{r.name || r.key}</span>
              <span className='att-pick-path'>{r.type === 'ref' ? '参考仓库' : '开发仓库'} · {r.key}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className='att-empty-inline'>{repos.length ? '没有匹配的仓库' : '还没有登记仓库'}</div>
      )}
    </div>
  );
}
