// 旁路（beside）三件套（#259 从任务页主体抽出，行数门禁）：打开来源原文 / 关闭自己 /
// 面包屑「预览原文」。都只是 openBesideMain / deleteTab 的薄封装，状态零自有。
import { useCallback } from 'react';
import type { Model } from 'flexlayout-react';
import { Actions } from 'flexlayout-react';
import { openBesideMain } from '../../workspace.js';
import type { ParentRef } from './task-utils.js';

export interface BesideOpsArgs {
  parentRef: ParentRef | null;
  model: Model | null;
  appModel?: Model | null;
  toast: (msg: string) => void;
  topicKey: string;
  tabId?: string;
}

export function useBesideOps(args: BesideOpsArgs) {
  const { parentRef, model, appModel, toast, topicKey, tabId } = args;

  const openParentBeside = useCallback(() => {
    if (!parentRef) {
      toast('这条任务没有可定位的原文');
      return;
    }
    const m = model || appModel;
    if (!m) return;
    openBesideMain(m, {
      component: 'page',
      name: parentRef.name || `原文 ${parentRef.task}`,
      config: { dirKey: parentRef.dirKey, task: String(parentRef.task) },
    });
  }, [parentRef, model, appModel, toast]);

  const closeBesideSelf = useCallback(() => {
    const m = model || appModel;
    if (!m || !tabId) return;
    m.doAction(Actions.deleteTab(tabId));
  }, [model, appModel, tabId]);

  // #261：下拉任务条目的「预览原文」——把**任意**同队列任务的原文旁路打开
  // （openBesideMain 会先收掉旧旁路，同一时刻只有一块）。
  const openTaskBeside = useCallback((taskId: string | number) => {
    const m = model || appModel;
    if (!m || !topicKey) return;
    openBesideMain(m, {
      component: 'page',
      name: `原文 #${taskId}`,
      config: { dirKey: topicKey, task: String(taskId) },
    });
  }, [model, appModel, topicKey]);

  return { openParentBeside, closeBesideSelf, openTaskBeside };
}
