// 斜杠菜单状态 hook：实时预览与源码两个编辑器共用。
// 差异点全部由参数注入：getTa 取当前 textarea、positionOf 算浮层坐标
// （预览按块矩形、源码按行列推算行高）、onApply 把选中的命令结果写回
// （预览走块级 applyBlockOp，源码走全文 applyOp）。
import { useEffect, useRef, useState } from 'react';
import { applySlashCommand, filterSlashCmds, slashQueryAt } from '../../modules/md/md-edit-ops.js';
import { handleSlashKey, slashActiveIndex } from './slash-menu.jsx';
import type { SlashItem, SlashState } from './slash-menu.jsx';
import type { EditOpResult } from './md-panes-helpers.js';

/** 调用方注入的三个差异点（见文件头注释）。 */
export interface UseSlashMenuArgs {
  getTa: () => HTMLTextAreaElement | null;
  positionOf: (ta: HTMLTextAreaElement) => { x: number; y: number };
  onApply: (next: EditOpResult | null, cur: SlashState | null) => void;
}

export function useSlashMenu({ getTa, positionOf, onApply }: UseSlashMenuArgs) {
  const [slash, setSlash] = useState<SlashState | null>(null); // { index?, query, items, active, x, y }
  const slashRef = useRef<SlashState | null>(null);
  const slashRafRef = useRef(0);
  const setSlashBoth = (next: SlashState | null | ((prev: SlashState | null) => SlashState | null)) => {
    const v = typeof next === 'function' ? next(slashRef.current) : next;
    slashRef.current = v;
    setSlash(v);
  };
  useEffect(() => { slashRef.current = slash; }, [slash]);

  // extra：调用方附加上下文（预览态是块序号 index）；extra 变化时活动项归零重算
  const refreshSlash = (ta: HTMLTextAreaElement, extra: { index?: number; [k: string]: any } | null = null) => {
    const hit = slashQueryAt(ta);
    if (!hit) {
      setSlashBoth(null);
      return;
    }
    const items: SlashItem[] = filterSlashCmds(hit.query);
    if (!items.length) {
      setSlashBoth(null);
      return;
    }
    const { x, y } = positionOf(ta);
    setSlashBoth((prev) => {
      const sameExtra = Object.keys(extra || {}).every((k) => prev?.[k] === extra?.[k]);
      const keep = prev && prev.query === hit.query && sameExtra;
      const active = keep ? slashActiveIndex({ ...prev, items }) : 0;
      return { ...(extra || {}), query: hit.query, items, active, x, y };
    });
  };

  const moveSlash = (delta: number) => {
    setSlashBoth((s) => {
      if (!s?.items?.length) return s;
      const n = s.items.length;
      const cur = slashActiveIndex(s);
      return { ...s, active: (cur + delta + n) % n };
    });
  };

  const pickSlash = (cmd: SlashItem | undefined) => {
    const ta = getTa();
    const cur = slashRef.current;
    if (!ta || !cmd) return;
    const next = applySlashCommand(ta, cmd);
    setSlashBoth(null);
    if (next) onApply(next, cur);
  };

  const hoverSlash = (n: number) => setSlashBoth((s) => s && ({ ...s, active: n }));

  // document 捕获：即使焦点异常也能 ↑↓
  useEffect(() => {
    if (!slash) return undefined;
    const onKey = (e: KeyboardEvent) => {
      handleSlashKey(e, slashRef, {
        move: moveSlash,
        pick: pickSlash,
        close: () => setSlashBoth(null),
      });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
    // eslint 无 exhaustive-deps：moveSlash/pickSlash 走 ref，slash 变化才需要重挂
  }, [slash]);

  return {
    slash, slashRef, slashRafRef, setSlashBoth,
    refreshSlash, moveSlash, pickSlash, hoverSlash,
  };
}
