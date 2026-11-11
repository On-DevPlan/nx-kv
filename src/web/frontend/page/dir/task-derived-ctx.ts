// 派生上下文：frontmatter / 父任务锚点 / 工作组语义。
import { useMemo } from 'react';
import { parseFrontmatter, titleFromMd } from '../../modules/md/md-parse.js';
import type { LocalTask, LocalTopic, RepoRow } from '../../types.js';
import type { AppSlice, BoardCtx, DocFm, DocState, ParentRef } from './task-utils.js';

interface UseDerivedCtxArgs {
  doc: DocState | null;
  beside: boolean;
  topicKey: string;
  topic: LocalTopic | null;
  task: string;
  app: AppSlice;
}

export function useDerivedCtx({ doc, beside, topicKey, topic, task, app }: UseDerivedCtxArgs) {
  // 工作组语义（frontmatter）：组面板「新增任务」创建的草稿带 board/project——
  // 工具区给「归属项目」下拉（限本组成员），提交按 project 路由进对应项目的队列。
  const docFm = useMemo<DocFm>(() => (doc ? parseFrontmatter(doc.body) : {}), [doc && doc.body]);

  // 评论任务的原文锚点：frontmatter.parent（新建评论写入）；旧数据从「锚定自「标题」」回推
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
