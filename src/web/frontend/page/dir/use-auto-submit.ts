// 参数填写页「直接提交」的一次性意图（#151 / #191）。
//
// 参数页渲染出纯文本草稿 → 种进 doc-store → 开到任务编辑页 → 留一个一次性 intent；
// 本 hook 在编辑页 mount 时取走意图，等 doc 就绪后自动 submit 一次（落库为待领取任务）。
// 取后即删：StrictMode 双跑 / 重复挂载只会消费一次，不会双提交。
import { useEffect, useRef } from 'react';
import type { DocState } from './task-utils.js';
import { takeTaskIntent } from '../../modules/md/task-intent.js';

export function useAutoSubmit(id: string, doc: DocState | null, isDraft: boolean, submit: () => unknown): void {
  const autoSubmitRef = useRef(false);
  useEffect(() => {
    if (takeTaskIntent(id)?.submit) autoSubmitRef.current = true;
  }, [id]);
  useEffect(() => {
    if (!autoSubmitRef.current || !doc || !isDraft) return;
    autoSubmitRef.current = false;
    submit();
  }, [doc, isDraft, submit]);
}
