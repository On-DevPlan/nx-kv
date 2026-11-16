// 区块切换条（#143）：仓库 / 参考仓库 / 文档 三块是**独立区块**，用横向按钮切换。
//
// 为什么不做同屏三段：一段一张表会拉出三倍高度，用户在「找某个仓库」时反而要多滚一屏；
// 横向按钮把三块压成同一块屏幕，计数就在按钮上（当前分组下各有多少条）。
//
// #146：搜索框搬到上面那一行（分组信息条）——它是**全局检索**（三块一起搜、结果同屏
// 分段列出），不该跟着区块按钮走；这里只留切换。
import type { ReactNode } from 'react';
import { IconSearch } from './icons.jsx';

export interface BlockTab {
  id: string;
  label: string;
  count: number;
  icon: ReactNode;
  /** 这一块为什么是空的 / 为什么不能点（title 提示） */
  tip?: string;
  /** 禁用（例如组视图里没有文档区块时由外部决定是否隐藏） */
  disabled?: boolean;
}

/** 全局检索框（#146）：放在分组信息条上，三块一起搜。 */
export function RpSearch({ value, onChange, placeholder, count }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 命中总数（有关键词时显示） */
  count?: number;
}) {
  return (
    <label className="rp-q" title="全局检索：仓库 / 参考仓库 / 文档 一起搜">
      <IconSearch size={13} />
      <input
        value={value}
        placeholder={placeholder || '搜索仓库 / 参考仓库 / 文档…'}
        aria-label="全局检索"
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? <span className="rp-q-n">{count === undefined ? '' : count}</span> : null}
      {value ? (
        <button type="button" className="rp-q-x" title="清空检索" onClick={() => onChange('')}>×</button>
      ) : null}
    </label>
  );
}

export default function BlockTabs({ tabs, value, onChange }: {
  tabs: BlockTab[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="rp-blocks">
      <div className="rp-block-tabs" role="tablist" aria-label="区块">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === value}
            disabled={t.disabled}
            className={'rp-block-tab' + (t.id === value ? ' on' : '')}
            title={t.tip || `${t.label}（${t.count}）`}
            onClick={() => { if (!t.disabled && t.id !== value) onChange(t.id); }}
          >
            <span className="rp-block-tab-ico">{t.icon}</span>
            <span className="rp-block-tab-label">{t.label}</span>
            <span className="rp-block-tab-n">{t.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
