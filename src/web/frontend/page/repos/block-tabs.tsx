// 区块切换条（#143）：仓库 / 参考仓库 / 文档 三块是**独立区块**，用横向按钮切换。
//
// 为什么不做同屏三段：一段一张表会拉出三倍高度，用户在「找某个仓库」时反而要多滚一屏；
// 横向按钮把三块压成同一块屏幕，计数就在按钮上（当前分支下各有多少条），
// 右侧统一放搜索框——切区块时搜索词保留（同一个分支内的检索不该被切块清掉）。
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

export default function BlockTabs({ tabs, value, onChange, q, onQ, placeholder, hint, right }: {
  tabs: BlockTab[];
  value: string;
  onChange: (id: string) => void;
  q: string;
  onQ: (v: string) => void;
  placeholder?: string;
  hint?: string;
  right?: ReactNode;
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
      <div className="rp-block-side">
        {hint ? <span className="rp-block-hint">{hint}</span> : null}
        {right}
        <label className="rp-q">
          <IconSearch size={13} />
          <input
            value={q}
            placeholder={placeholder || '按名称 / 路径 / 描述筛选…'}
            aria-label="筛选当前区块"
            onChange={(e) => onQ(e.target.value)}
          />
          {q ? (
            <button type="button" className="rp-q-x" title="清空筛选" onClick={() => onQ('')}>×</button>
          ) : null}
        </label>
      </div>
    </div>
  );
}
