// 分组筛选器行：主表 = 开发仓库；点 chip 只看那个组的成员（再点取消）。
// 行内的分组 chips 也会落到同一个 filter 上。
// 检索框一个输入同时搜仓库名/路径、分组名、文档标题/rel —— 管理页不该靠长列表找人。
import { Button } from '../../components/button/index.jsx';

export default function FiltersBar({ boards, filter, onFilter, devCount, shownCount, q, onQ, onOpenDocs }) {
  return (
    <div className="rp-filters" data-testid="rp-filters">
      <div className="rp-filters-main">
        <button
          className={'rp-chip' + (filter ? '' : ' on')}
          onClick={() => onFilter('')}
          title="显示全部开发仓库"
        >
          全部 <b>{devCount}</b>
        </button>
        {boards.map((b) => (
          <button
            key={b.id}
            className={'rp-chip' + (filter === b.id ? ' on' : '')}
            onClick={() => onFilter(filter === b.id ? '' : b.id)}
            title={`只看「${b.name}」里的仓库（${b.repos.length} 个）`}
          >
            {b.name} <b>{b.repos.length}</b>
          </button>
        ))}
      </div>
      <div className="rp-filters-side">
        <input
          className="rp-search"
          type="search"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="搜仓库 / 路径 / 分组 / 文档…"
          aria-label="检索仓库与文档"
        />
        {q ? <Button small onClick={() => onQ('')}>清空</Button> : null}
        <span className="muted rp-search-count">{shownCount} / {devCount}</span>
        <Button small title="按仓库 / 组内 / 分组三档检索文档"
          onClick={onOpenDocs}>文档检索</Button>
      </div>
    </div>
  );
}
