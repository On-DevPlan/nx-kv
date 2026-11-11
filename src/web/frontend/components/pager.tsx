// 分页器 —— 列表超过一页时的翻页控件（侧栏任务子行 / 目录任务表共用）。
//
// 为什么要有（2026-11-03 反馈「优化队列长度限制，进行分页」）：侧栏任务子行
// 以前是**硬截断**在 12 条——第 13 条起静默丢弃，用户既看不到也够不着；
// 目录任务表则相反，一次把全部任务渲染出来，队列一长就成了一堵墙。
// 两种毛病其实是同一个：**列表长度没有出口**。这里给一份统一的分页：
// 页大小固定、页码可达、当前页/总数如实标出来。
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

/** 分页状态（usePager 的返回面）。 */
export interface PagerState<T> {
  page: number;
  pageCount: number;
  total: number;
  items: T[];
  setPage: Dispatch<SetStateAction<number>>;
}

/**
 * 列表分页状态。
 *
 * 页码越界（列表变短、筛选后变少）时**渲染时收回**最后一页——不用 effect
 * 回写 state：那样会多一次渲染，而且渲染中途读到的还是越界页码。
 *
 * @param {Array} items  已排好序的列表
 * @param {number} pageSize 每页条数
 * @returns {{page:number,pageCount:number,total:number,items:Array,setPage:Function}}
 */
export function usePager<T>(items: T[] | null | undefined, pageSize: number): PagerState<T> {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(0);
  const size = Math.max(1, Number(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(Math.max(0, page), pageCount - 1);
  const start = cur * size;
  return {
    page: cur,
    pageCount,
    total: list.length,
    items: list.slice(start, start + size),
    setPage,
  };
}

/** 翻页控件入参（都可省：只有一页时退化为「共 N 条」）。 */
export interface PagerProps {
  page?: number;
  pageCount?: number;
  total?: number;
  onPage?: (page: number) => void;
  unit?: string;
}

/**
 * 翻页控件。只有一页时不显示翻页按钮，但仍报总数（用户知道还有多少）。
 */
export default function Pager({ page = 0, pageCount = 1, total = 0, onPage, unit = '条' }: PagerProps) {
  const go = (p: number) => onPage && onPage(Math.max(0, Math.min(p, pageCount - 1)));
  if (pageCount <= 1) {
    return <span className="pager-n">共 {total} {unit}</span>;
  }
  return (
    <span className="pager">
      <button
        type="button"
        className="pager-btn"
        disabled={page <= 0}
        onClick={() => go(page - 1)}
        aria-label="上一页"
        title="上一页"
      >
        ‹
      </button>
      <span className="pager-n">
        第 {page + 1}/{pageCount} 页 · 共 {total} {unit}
      </span>
      <button
        type="button"
        className="pager-btn"
        disabled={page >= pageCount - 1}
        onClick={() => go(page + 1)}
        aria-label="下一页"
        title="下一页"
      >
        ›
      </button>
    </span>
  );
}
