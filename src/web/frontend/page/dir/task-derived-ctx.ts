// 派生上下文：frontmatter / 父任务锚点 / 工作组语义。
import { useMemo } from 'react';
import { titleFromMd } from '../../modules/md/md-parse.js';
import type { BoardRow, LocalTask, LocalTopic, RepoRow } from '../../types.js';
import type { PretaskContext } from '@nx-kv/plugin-sdk';
import type { AppSlice, BoardCtx, DocFm, DocState, ParentRef } from './task-utils.js';

interface UseDerivedCtxArgs {
  doc: DocState | null;
  beside: boolean;
  topicKey: string;
  topic: LocalTopic | null;
  task: string;
  app: AppSlice;
}

/** 任务页的 pretask 作用域：目录页只到仓库，组页带组/看板/归属项目。 */
export interface PretaskScope {
  ctx: PretaskContext;
  repoKey: string;
  groupKey: string;
}

export function pretaskScopeOf(input: {
  topicKey: string;
  dirKey: string;
  groupAnchored: boolean;
  groupId: string;
  topic: LocalTopic | null;
  boards: BoardRow[];
}): PretaskScope {
  const topic = input.topic as LocalTopic & { repo?: { key?: string; name?: string } };
  const board = input.groupAnchored
    ? input.boards.find((b) => b.id === input.groupId || b.key === input.groupId) || null
    : null;
  const repoKey = String(topic?.repo?.key || '');
  const groupKey = input.groupAnchored ? String(board?.key || '') : '';
  const groupId = input.groupAnchored ? input.groupId : '';
  const boardId = input.groupAnchored ? String(board?.id || input.groupId) : '';
  const project = input.groupAnchored ? repoKey : '';
  const location = input.groupAnchored
    ? { dirKey: input.topicKey, groupId, board: boardId, project }
    : { dirKey: input.dirKey };
  const ctx: PretaskContext = {
    topicKey: input.topicKey,
    repoKey,
    groupKey,
    cwd: String(topic?.cwd || ''),
    dirKey: input.groupAnchored ? input.topicKey : input.dirKey,
    ...(input.groupAnchored ? { groupId, board: boardId, project } : {}),
    topic: {
      key: input.topicKey,
      name: String(topic?.name || ''),
      kind: input.groupAnchored ? 'group' : 'repo',
      cwd: String(topic?.cwd || ''),
      repoKey,
      groupKey,
      repoName: String(topic?.repo?.name || ''),
      groupName: String(board?.name || ''),
      repoRoot: String(topic?.cwd || ''),
    },
    location,
  };
  return { ctx, repoKey, groupKey };
}

export function useDerivedCtx({ doc, beside, topicKey, topic, task, app }: UseDerivedCtxArgs) {
  // 工作组语义：**草稿的结构化字段**（#197 起不再读写正文 frontmatter）——
  // 组面板「新增任务」创建的草稿带 boardKey/projectKey，提交按 projectKey 路由。
  const docFm = useMemo<DocFm>(
    () => (doc
      ? { board: doc.boardKey || '', project: doc.projectKey || '', parent: doc.parentTask || '', parentDir: doc.parentDir || '' }
      : {}),
    [doc && doc.boardKey, doc && doc.projectKey, doc && doc.parentTask, doc && doc.parentDir],
  );

  // 评论任务的原文锚点：草稿的 parentTask（新建评论写入）；旧数据从「锚定自「标题」」回推
  const parentRef = useMemo<ParentRef | null>(() => {
    if (beside) return null; // 旁路原文自己不再开旁路
    const pid = String(docFm.parent || '').trim();
    const pdir = String(docFm.parentDir || topicKey || '').trim();
    if (pid && !/^draft/i.test(pid)) {
      return { dirKey: pdir || topicKey, task: pid, name: `#${pid}` };
    }
    const body = String(doc?.body || '');
    const m = body.match(/>\s*锚定自「([^」]+)」/);
    if (!m) return null;
    // 捕获组命中即存在（noUncheckedIndexedAccess 下仍需守卫）
    const captured = m[1];
    if (!captured) return null;
    const title = captured.trim();
    const hit = (topic?.tasks || []).find((t: LocalTask) => {
      if (String(t.id) === String(task)) return false;
      return titleFromMd(t.text || '') === title || String(t.text || '').includes(`# ${title}`);
    });
    if (!hit) return null;
    return { dirKey: topicKey, task: String(hit.id), name: `#${hit.id}` };
  }, [beside, docFm.parent, docFm.parentDir, doc?.body, topicKey, topic, task]);

  const boardCtx = useMemo<BoardCtx | null>(() => {
    const bid = docFm.board;
    if (!bid) return null;
    const allBoards = (app.repoData && app.repoData.boards) || [];
    const b = allBoards.find((x) => x.id === bid || x.key === bid || x.name === bid);
    if (!b) return null;
    const allRepos = (app.repoData && app.repoData.repos) || [];
    const byKey = new Map<string, RepoRow>(allRepos.map((r) => [r.key, r] as [string, RepoRow]));
    const groupRepos: Array<{ key: string }> = b.repos || [];
    const members = groupRepos
      .map((m) => byKey.get(m.key))
      .filter((r): r is RepoRow => !!r)
      .map((r) => ({ key: r.key, name: r.name }));
    return { board: b, members };
  }, [docFm.board, app.repoData]);

  return { docFm, parentRef, boardCtx };
}
