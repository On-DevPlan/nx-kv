// 双链导航（DocPanel 与组详情、refs 面板共用）：拉一次索引，解析目标 → 开 doc 页签。
//
// 从 page/doc/index.tsx 抽出来的（#183）：那一页已经顶着行数上限，导航逻辑与
// 渲染无关，独立成文件后两边都更好读。对外契约不变——index.tsx 继续 re-export
// `useWikiNav` / `DocOpenExtra` / `WikiNav`，原 import 路径不受影响。
import { useCallback, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Model } from 'flexlayout-react';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { openPanel } from '../../workspace.js';
import { resolveWikiLink } from '../../../../shared/wikilink.js';
import type { WikiIndexEntry } from '../../../../shared/wikilink.js';
import { getDocsIndex } from './api.js';

/** 打开文档页签时携带的归属上下文（repo 与 board 二选一）。 */
export interface DocOpenExtra {
  repoKey?: string;
  boardKey?: string;
  boardName?: string;
}

/** useWikiNav 的返回面（DocPanel 与组详情共用）。 */
export interface WikiNav {
  nav: (target: string | null) => Promise<void>;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  ensureIndex: () => Promise<WikiIndexEntry[]>;
  openByDocId: (
    targetDocId: string | undefined | null,
    index?: WikiIndexEntry[] | null,
    extra?: DocOpenExtra,
  ) => Promise<void>;
}

/**
 * 双链导航：拉一次索引，解析目标 → 开 doc 页签。
 * 多同名候选不猜（列出 docId 让人挑）；未命中提示用 CLI 创建。
 */
export function useWikiNav(model?: Model | null): WikiNav {
  const app = useApp();
  const toast = useToast();
  const m = model || app.model;
  const indexRef = useRef<WikiIndexEntry[] | null>(null);

  const ensureIndex = useCallback(async () => {
    if (!indexRef.current) {
      try {
        indexRef.current = (await getDocsIndex()).index || [];
      } catch {
        indexRef.current = [];
      }
    }
    return indexRef.current ?? [];
  }, []);

  const openByDocId = useCallback(
    async (targetDocId: string | undefined | null, index?: WikiIndexEntry[] | null, extra: DocOpenExtra = {}) => {
      const idx = index || (await ensureIndex());
      const entry = idx.find((x) => x.docId === targetDocId);
      openPanel(m, {
        component: 'doc',
        name: entry ? entry.name : targetDocId,
        config: {
          docId: targetDocId,
          ...(extra.repoKey ? { repoKey: extra.repoKey } : {}),
          ...(extra.boardKey ? { boardKey: extra.boardKey, boardName: extra.boardName || '' } : {}),
        },
        location: 'center',
      });
    },
    [m, ensureIndex]
  );

  const nav = useCallback(
    async (target: string | null) => {
      const index = await ensureIndex();
      const hit = resolveWikiLink(target, index);
      if (hit && 'docId' in hit) return openByDocId(hit.docId, index);
      if (hit && 'candidates' in hit) {
        return toast(`「${target}」同名文档多份：${hit.candidates.join('、')}`);
      }
      toast(`未找到「${target}」——在仓库/组面板点 ＋ 新建文档后再引用`);
    },
    [ensureIndex, openByDocId, toast]
  );

  // 预览容器的事件委托：点 [data-wl] 即导航
  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>) => {
      // DOM 事件边界：React 的 event.target 只声明为 EventTarget，这里要 Element 能力
      const el = e.target as HTMLElement;
      const a = el.closest('[data-wl]');
      if (!a) return;
      e.preventDefault();
      nav(a.getAttribute('data-wl'));
    },
    [nav]
  );

  return { nav, onClick, ensureIndex, openByDocId };
}
