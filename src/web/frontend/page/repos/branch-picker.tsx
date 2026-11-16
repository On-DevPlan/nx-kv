// 分组选择器（#143/#145）：本地开发仓库是 `main`，每个项目组是一「支」来看——
// 但界面上一律叫**分组**（用户口径：「分支只是我用来比喻的」）。
//
// 交互照 GitHub / GitLab 的 branch 下拉：点标题右侧的「◈ main ▾」展开浮层，
// 顶部是过滤框（输入即筛分组名），下面是分组清单（main → 各组 → default），
// 每行右侧报这一组里的仓库数，当前项打勾。底部一个「＋ 新建分组」。
// Esc / 点外部关闭。
//
// 为什么不是左侧树：分组是**全局的维度**（同一批仓库会出现在多个分组里），
// 放在标题旁让人一眼看出「我现在在看哪个分组」，也不会把表格挤窄。
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconBranch, IconCheck, IconChevron, IconGrid, IconPlus, IconSearch } from './icons.jsx';

/** 一个分组（= 一个组；main / default 是两个虚拟项）。 */
export interface BranchOption {
  /** 'main' | 'default' | 组的 id */
  id: string;
  /** 展示名：main / default / 组名 */
  name: string;
  /** 这个分组里的开发仓库数 */
  repoCount: number;
  /** 这个分组里的参考仓库数 */
  refCount: number;
  /** 这个分组里的文档数（main 才有意义） */
  docCount: number;
  /** 虚拟项（main / default）——不能删不能改名 */
  virtual?: boolean;
  /** 组的 key（`board/<名>`），深链接与面板 config 用得到 */
  key?: string;
}

/** 分支 id 的哨兵值（避免各处写字符串）。 */
export const BRANCH_MAIN = 'main';
export const BRANCH_DEFAULT = 'default';

export default function BranchPicker({ branches, value, onChange, onCreate }: {
  branches: BranchOption[];
  value: string;
  onChange: (id: string) => void;
  /** 「＋ 新建分组」：由页面实现（弹窗问名字 → 建组 → 切过去） */
  onCreate?: () => void;
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
        title="切换分组：main = 全部仓库；其余项 = 项目组"
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
        <div className="rp-branch-pop" role="listbox" aria-label="分组">
          <div className="rp-branch-filter">
            <IconSearch size={13} />
            <input
              ref={inputRef}
              value={kw}
              placeholder="筛选分组…"
              aria-label="筛选分组"
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
                  : `项目组「${b.name}」`}
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
            {!shown.length ? <div className="rp-branch-empty">没有匹配的分组</div> : null}
          </div>
          {onCreate ? (
            <button type="button" className="rp-branch-new" onClick={() => { setOpen(false); setKw(''); onCreate(); }}>
              <IconPlus size={13} />
              <span>新建分组</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
