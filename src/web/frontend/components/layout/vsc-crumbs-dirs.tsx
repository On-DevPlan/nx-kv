// 面包屑的「完整本地路径」段 + 子目录下拉（#276）。
//
// VS Code 口径（用户参考图）：面包屑显示完整文件系统路径，逐段「>」分隔；
// 点某个目录段弹的是**它的子目录**（可逐级进入，形成目录树）。
//
// 本组件的交互：
//   · 点路径段 → 列该层子目录（后端守卫：只许已登记仓库下）
//   · 点子目录 → 该目录**有队列**就跳到那个目录页；没有就**逐级进入**
//     （下拉内容换成它的子目录，可一直往下走），与 VS Code 的路径树一致
//   · 下拉顶部有「↑ 上级」——回退一层
import { useCallback, useRef, useState } from 'react';
import { useApp } from '../../app-context.jsx';
import { PopMenu } from '../popup/index.jsx';
import type { PopMenuItem } from '../popup/index.jsx';
import { useToast } from '../toast/index.jsx';
import { listDirs } from './vsc-crumbs-api.js';
import type { DirEntry } from './vsc-crumbs-api.js';
import type { VscPathSeg, VscSegment } from './vsc-crumbs-model.js';

interface DirMenu {
  x: number;
  y: number;
  /** 当前列的是哪一层的子目录 */
  path: string;
  items: DirEntry[];
  /** 上一级路径栈（最后一项 = 上一层的目录） */
  stack: string[];
  /** 加载失败时的提示（不抛 toast，直接在菜单里说） */
  error?: string;
}

export default function VscCrumbsDirs({
  segments,
  siblingSeg,
  onSiblingMenu,
}: {
  segments: VscPathSeg[];
  /** 与路径末段同名的「组/目录」段——它的同级下拉改挂在末段的小按钮上（避免同名段重复画）。 */
  siblingSeg?: { label: string } | null;
  onSiblingMenu?: ((seg: VscSegment, e: { clientX: number; clientY: number }) => void) | null;
}) {
  const app = useApp();
  const toast = useToast();
  const [menu, setMenu] = useState<DirMenu | null>(null);
  // 目录树的**上下文**（位置/当前层/上级栈）：菜单被 dismiss 关掉时 state 会归 null，
  // 但下钻要接着这条路径继续走——所以另存一份不受关闭影响的 ref。
  const treeRef = useRef<{ x: number; y: number; path: string; stack: string[] } | null>(null);

  const openDirs = useCallback(async (seg: VscPathSeg, e: { clientX: number; clientY: number }) => {
    const x = e.clientX;
    const y = e.clientY + 6;
    try {
      const dirs = await listDirs(seg.path);
      treeRef.current = { x, y, path: seg.path, stack: [] };
      setMenu({ x, y, path: seg.path, items: dirs, stack: [] });
    } catch (err) {
      treeRef.current = { x, y, path: seg.path, stack: [] };
      setMenu({
        x,
        y,
        path: seg.path,
        items: [],
        stack: [],
        error: (err as Error).message || String(err),
      });
    }
  }, []);

  // 点子目录：有队列 → 跳过去；没有 → 逐级进入（下拉换成它的子目录）
  const goInto = useCallback(
    async (dir: DirEntry) => {
      const rows = app.rows || [];
      const topic = rows.find(
        (t) => t && String(t.cwd || '').toLowerCase() === dir.path.toLowerCase()
      );
      if (topic && topic.key) {
        app.onNavigate?.('#/dir/' + encodeURIComponent(String(topic.key)));
        return;
      }
      const ctx = treeRef.current;
      if (!ctx) return;
      try {
        const dirs = await listDirs(dir.path);
        // 菜单此刻可能已被 dismiss 关掉（state=null）——用 treeRef 的上下文重新开一份
        const next = { ...ctx, path: dir.path, stack: [...ctx.stack, ctx.path] };
        treeRef.current = next;
        setMenu({ ...next, items: dirs, error: '' });
      } catch (err) {
        toast('无法列子目录：' + ((err as Error).message || err));
      }
    },
    [app, toast]
  );

  const goUp = useCallback(async () => {
    const ctx = treeRef.current;
    if (!ctx) return;
    const parent = ctx.stack[ctx.stack.length - 1];
    if (!parent) return;
    try {
      const dirs = await listDirs(parent);
      const next = { ...ctx, path: parent, stack: ctx.stack.slice(0, -1) };
      treeRef.current = next;
      setMenu({ ...next, items: dirs, error: '' });
    } catch (err) {
      toast('无法列上级目录：' + ((err as Error).message || err));
    }
  }, [toast]);

  const items: Array<PopMenuItem | string> = [];
  if (menu) {
    if (menu.stack.length) {
      items.push({ label: '↑ 上级', onClick: () => { void goUp(); } });
    }
    // 注意：PopMenu 把**字符串项**渲染成分隔线 —— 说明性文字必须是对象项（label + 无 onClick）
    if (menu.error) {
      items.push({ label: menu.error });
    } else if (!menu.items.length) {
      items.push({ label: '（没有子目录）' });
    } else {
      for (const d of menu.items) {
        items.push({
          label: d.name,
          icon: 'folder',
          onClick: () => { void goInto(d); },
        });
      }
    }
  }

  return (
    <>
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={seg.path} className="vsc-crumb is-path">
            <span className="vsc-sep" aria-hidden>
              &gt;
            </span>
            <button
              type="button"
              className="vsc-crumb-t"
              title={`${seg.path}（点开列子目录）`}
              onClick={(e) => { void openDirs(seg, e); }}
            >
              {seg.label}
            </button>
            {/* 同名段去重后，「同级」下拉改挂在末段右侧的小按钮上（VS Code 段旁也有这种入口） */}
            {isLast && siblingSeg && onSiblingMenu && (
              <button
                type="button"
                className="vsc-crumb-t vsc-crumb-sib"
                title={`显示「${siblingSeg.label}」的同级`}
                onClick={(e) => onSiblingMenu(siblingSeg as VscSegment, e)}
              >
                ≡
              </button>
            )}
          </span>
        );
      })}
      {menu && (
        <PopMenu x={menu.x} y={menu.y} width={170} items={items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
