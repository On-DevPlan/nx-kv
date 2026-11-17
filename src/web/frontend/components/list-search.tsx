// 列表搜索框（#149 全局统一形态）：受控输入 + 命中计数 + 清空按钮。
//
// 抽出来是为了让「文档列表 / 归属 / 加绑宿主 / 参考仓库勾选」等所有列表
// 长得一样、行为一样；匹配规则由 modules/list-filter.ts 的纯函数负责，
// 这里只管交互形态。图标走 components/icons 的搜索图标（内联 SVG / currentColor）。
import { Icon } from './icons.jsx';

export function ListSearch({ value, onChange, placeholder, count, title, className }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 有关键词时显示的命中数 */
  count?: number;
  title?: string;
  className?: string;
}) {
  const label = title || '搜索';
  return (
    <label className={'nx-list-search' + (className ? ' ' + className : '')} title={title || '输入关键词过滤列表'}>
      <Icon name="search" size={13} />
      <input
        value={value}
        placeholder={placeholder || '搜索…'}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && count !== undefined ? <span className="nx-list-search-n">{count}</span> : null}
      {value ? (
        <button type="button" className="nx-list-search-x" title="清空搜索" aria-label="清空搜索" onClick={() => onChange('')}>
          ×
        </button>
      ) : null}
    </label>
  );
}

export default ListSearch;
