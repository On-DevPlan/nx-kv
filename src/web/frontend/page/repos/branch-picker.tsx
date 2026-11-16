// 分支选择器（#143）：把「组」当分支——本地开发仓库是 `main`，每个组是一个分支。
//
// 交互照 GitHub / GitLab 的 branch 下拉：点标题右侧的「⑂ main ▾」展开一个浮层，
// 顶部是过滤框（输入即筛分支名），下面是分支清单（main → 各组 → default），
// 每行右侧报这一支里的仓库数，当前分支打勾。Esc / 点外部关闭。
//
// 为什么不是左侧树：分支是**全局的维度**（同一批仓库会出现在多个分支里），
// 放在标题旁让人一眼看出「我现在在哪个分支看东西」，也不会把表格挤窄。
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBranch, IconCheck, IconChevron, IconGrid, IconSearch } from './icons.jsx';

/** 一个分支（= 一个组；main / default 是两个虚拟分支）。 */
export interface BranchOption {
  /** 'main' | 'default' | 组的 id */
  id: string;
  /** 展示名：main / default / 组名 */
  name: string;
  /** 这一支里的开发仓库数 */
  repoCount: number;
  /** 这一支里的参考仓库数（main 才有意义；组也有） */
  refCount: number;
  /** 这一支里的文档数（main 才有意义） */
  docCount: number;
  /** 虚拟分支（main / default）——不能删不能改名 */
  virtual?: boolean;
  /** 组的 key（`board/<名>`），深链接与面板 config 用得到 */
  key?: string;
}

/** 分支 id 的哨兵值（避免各处写字符串）。 */
export const BRANCH_MAIN = 'main';
export const BRANCH_DEFAULT = 'default';

export default function BranchPicker({ branches, value, onChange }: {
  branches: BranchOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cur = branches.find((b) => b.id === value) || branches[0];

  // 点外部 / Esc 关闭：浮层是 absolute 定位，没有遮罩，所以要自己听
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    // 打开即聚焦过滤框（键盘用户直接开始打字）
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
    };
  }, [open]);

  const shown = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return branches;
    return branches.filter((b) => b.name.toLowerCase().includes(k) || String(b.key || '').toLowerCase().includes(k));
  }, [branches, kw]);

  const pick = (id: string) => {
    setOpen(false);
    setKw('');
    if (id !== value) onChange(id);
  };

  return (
    <div className="rp-branch" ref={rootRef}>
      <button
        type="button"
        className={'rp-branch-btn' + (open ? ' open' : '')}
        title="切换分支：main = 全部仓库；各分支 = 项目组（命名空间）"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {cur && cur.virtual && cur.id === BRANCH_MAIN
          ? <IconGrid size={14} />
          : <IconBranch size={14} />}
        <span className="rp-branch-name">{cur ? cur.name : BRANCH_MAIN}</span>
        <span className="rp-branch-btn-caret"><IconChevron size={13} /></span>
      </button>

      {open ? (
        <div className="rp-branch-pop" role="listbox" aria-label="分支">
          <div className="rp-branch-filter">
            <IconSearch size={13} />
            <input
              ref={inputRef}
              value={kw}
              placeholder="筛选分支…"
              aria-label="筛选分支"
              onChange={(e) => setKw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shown[0]) pick(shown[0].id);
              }}
            />
          </div>
          <div className="rp-branch-list">
            {shown.map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={b.id === value}
                className={'rp-branch-item' + (b.id === value ? ' on' : '')}
                title={b.virtual
                  ? (b.id === BRANCH_MAIN ? '全部：所有仓库 / 参考仓库 / 文档' : '没有归组的仓库都落在这里')
                  : `项目组「${b.name}」——只是命名空间，仓库本身仍在 main 里`}
                onClick={() => pick(b.id)}
              >
                <span className="rp-branch-item-ico">
                  {b.virtual && b.id === BRANCH_MAIN ? <IconGrid size={13} /> : <IconBranch size={13} />}
                </span>
                <span className="rp-branch-item-name">{b.name}</span>
                <span className="rp-branch-item-n">{b.repoCount}</span>
                <span className="rp-branch-item-check">{b.id === value ? <IconCheck size={13} /> : null}</span>
              </button>
            ))}
            {!shown.length ? <div className="rp-branch-empty">没有匹配的分支</div> : null}
          </div>
          <div className="rp-branch-tip">分支 = 项目组（命名空间）；跟着 main 的仓库在哪个分支下都能找到它</div>
        </div>
      ) : null}
    </div>
  );
}
