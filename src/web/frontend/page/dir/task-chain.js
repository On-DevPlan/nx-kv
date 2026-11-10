// 任务链（history / fork 派生）状态与导航。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { GLOBAL_KEY } from '../../modules/board/board-view.js';
import { openBesideMain } from '../../workspace.js';

export function useChain({
  isDraft, task, taskRow, topicKey, topic, isGlobal, groupAnchored, groupId,
  app, model, historyId, toast,
}) {
  const [chainApi, setChainApi] = useState(null);
  useEffect(() => {
    if (isDraft || task == null || /^draft/i.test(String(task))) {
      setChainApi(null);
      return undefined;
    }
    let cancelled = false;
    const q = isGlobal
      ? `key=${encodeURIComponent(GLOBAL_KEY)}&id=${Number(task)}`
      : `cwd=${encodeURIComponent(topic?.cwd || '')}&id=${Number(task)}`;
    api(`/api/localtasks/chain?${q}`)
      .then((d) => {
        if (!cancelled) setChainApi(d);
      })
      .catch(() => {
        if (!cancelled) setChainApi(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isDraft, task, isGlobal, topic?.cwd, taskRow?.history?.length, taskRow?.forkOf, taskRow?.reopenCount]);

  const chainNodes = useMemo(() => {
    if (isDraft || !taskRow) return [];
    const tip =
      String(taskRow.text || '')
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) || '';
    const tipEx = tip.replace(/^#+\s*/, '').slice(0, 100);

    // 1) 同任务 history 链
    const hist = Array.isArray(taskRow.history) ? taskRow.history : [];
    if (hist.length) {
      const nodes = hist.map((h) => ({
        historyId: h.id,
        kind: h.kind,
        at: h.at,
        excerpt: h.excerpt || h.feedback || '',
        feedback: h.feedback,
        quote: h.quote,
        attachmentCount: (h.attachments || []).length,
        current: false,
      }));
      nodes.push({
        historyId: null,
        kind: 'current',
        at: taskRow.lastReopenedAt || taskRow.createdAt || '',
        excerpt: tipEx,
        attachmentCount: 0,
        current: true,
      });
      return nodes;
    }

    // 2) fork 派生链（祖先 → 本条 → 子任务）
    const ancestors = Array.isArray(chainApi?.ancestors) ? [...chainApi.ancestors].reverse() : [];
    const children = Array.isArray(chainApi?.children) ? chainApi.children : [];
    if (!ancestors.length && !children.length && !taskRow.forkOf) return [];
    const nodes = [];
    for (const a of ancestors) {
      if (a.missing) continue;
      nodes.push({
        historyId: null,
        kind: a.forkKind || 'origin',
        at: a.createdAt || '',
        excerpt: a.excerpt || `#${a.id}`,
        attachmentCount: 0,
        current: false,
        taskId: a.id,
        dirKey: a.key,
      });
    }
    nodes.push({
      historyId: null,
      kind: 'current',
      at: taskRow.createdAt || '',
      excerpt: tipEx,
      attachmentCount: 0,
      current: true,
      taskId: Number(task),
      dirKey: topicKey || GLOBAL_KEY,
    });
    for (const c of children) {
      nodes.push({
        historyId: null,
        kind: c.forkKind || 'comment',
        at: c.createdAt || '',
        excerpt: c.excerpt || `#${c.id}`,
        attachmentCount: 0,
        current: false,
        taskId: c.id,
        dirKey: c.key,
      });
    }
    return nodes;
  }, [isDraft, taskRow, chainApi, task, topicKey]);

  const historyNode = useMemo(() => {
    if (historyId == null || !taskRow) return null;
    const want = Number(historyId);
    return (taskRow.history || []).find((h) => Number(h.id) === want) || null;
  }, [historyId, taskRow]);

  // #144 反馈只在链尖：已有任何派生子任务（后续轮次 / 评论派生）就不再是最新一轮，
  // 反馈入口收起并指到最新一轮——在过去的轮次上反馈会把链分叉。
  const chainChildren = Array.isArray(chainApi?.children) ? chainApi.children : [];
  const isChainTip = chainChildren.length === 0;
  const latestChild = chainChildren.length ? chainChildren[chainChildren.length - 1] : null;

  const openLatestRound = useCallback(() => {
    if (!latestChild || !app.openPage) return;
    // 组锚定页保持组锚（任务还在本组，只是看最新一轮）
    if (groupAnchored) app.openPage({ groupId, task: String(latestChild.id), name: `#${latestChild.id}` });
    else app.openPage({
      dirKey: String(latestChild.key || topicKey || GLOBAL_KEY),
      task: String(latestChild.id),
      name: `#${latestChild.id}`,
    });
  }, [latestChild, app.openPage, groupAnchored, groupId, topicKey]);

  /** 任务链节点 → 旁路查看：history 快照 / 祖先或子任务正文 */
  const openHistoryBeside = useCallback(
    (node) => {
      const m = model || app.model;
      if (!m || isDraft) return;
      if (node?.current) {
        toast('当前节点就是本页');
        return;
      }
      // 同任务 history 快照
      if (node?.historyId != null) {
        openBesideMain(m, {
          component: 'page',
          name: `链 #${task} · ${node.kind || node.historyId}`,
          config: {
            dirKey: topicKey || GLOBAL_KEY,
            task: String(task),
            historyId: Number(node.historyId),
          },
        });
        return;
      }
      // fork 祖先 / 子任务：打开对应任务页（旁路）
      if (node?.taskId != null && node?.dirKey) {
        openBesideMain(m, {
          component: 'page',
          name: node.excerpt ? String(node.excerpt).slice(0, 24) : `#${node.taskId}`,
          config: { dirKey: String(node.dirKey), task: String(node.taskId) },
        });
        return;
      }
      toast('这个节点没有可打开的内容');
    },
    [model, app.model, isDraft, topicKey, task, toast],
  );

  return {
    chainApi, chainNodes, historyNode, chainChildren, isChainTip, latestChild,
    openLatestRound, openHistoryBeside,
  };
}
