/**
 * 路由 → 面包屑层级（组 / 项目 / 草稿或任务号）。
 * 纯函数，供面板与单测共用。
 * @param {object} route {view, key, task}
 * @param {object} ctx   {boardName, dirName, pageTitle}
 */
export function crumbsOf(route, ctx = {}) {
  if (!route || !route.view) return [];
  switch (route.view) {
    case 'dir': {
      const out = [];
      if (ctx.boardName) out.push(ctx.boardName);
      if (ctx.dirName) out.push(ctx.dirName);
      if (route.task) {
        // 验收例：[ nx/nx-kv/draft ]——草稿统一显示 draft，不暴露 draft-N
        if (/^draft/i.test(String(route.task))) out.push('draft');
        else out.push(ctx.pageTitle || `#${route.task}`);
      }
      return out;
    }
    case 'group':
      return ctx.boardName ? [ctx.boardName] : ['项目组'];
    case 'repos':
      return ['仓库管理'];
    case 'cloud':
      return ['云端总览'];
    case 'overview':
      return ['全部目录总览'];
    case 'templates':
      return ['任务模板'];
    default:
      return [];
  }
}

/**
 * 上一级路由（面包屑条上的「← 返回」用）。
 *   任务页 → 该目录的任务表；目录页 → 所属项目组（无组则总览）；组页 → 总览。
 * 没有上一级时返回 ''（不画返回键）。
 * @param {object} route {view, key, task}
 * @param {object} ctx   {boardId}
 */
export function parentRouteOf(route, ctx = {}) {
  if (!route || !route.view) return '';
  switch (route.view) {
    case 'dir':
      if (route.task) return `#/dir/${encodeURIComponent(route.key || '')}`;
      return ctx.boardId ? `#/group/${encodeURIComponent(ctx.boardId)}` : '#/overview';
    case 'group':
      return '#/overview';
    case 'overview':
      return '';
    default:
      return '#/overview';
  }
}

/**
 * 面包屑上下文（组名 / 目录名 / 页标题）——由路由 + 队列 + 仓库登记算出。
 * 面包屑条现在挂在**各主面板内部**（#44：不该在窗口顶部），所以这段要能被面板共用。
 * @param {object} route {view, key, task}
 * @param {object[]} rows   /api/localtasks 的裸 topic 列表
 * @param {object} repoData {boards, repos}
 */
export function crumbCtxOf(route, rows = [], repoData = {}) {
  if (!route) return { boardName: '', boardId: '', dirName: '', pageTitle: '' };
  // group 路由的 key = 看板 id；dir 路由的 key = 主题 key——两组身份别混。
  const boardById = (repoData.boards || []).find((b) => b.id === route.key);
  const topic = (rows || []).find((r) => r.key === route.key);
  const repo =
    (topic && topic.repo) ||
    (repoData.repos || []).find((r) => topic && (r.id === topic.repo?.id || r.path === topic.cwd)) ||
    null;
  const boardFromRepo = (repo && repo.boards && repo.boards[0]) || null;
  const taskRow =
    topic && route.task
      ? (topic.tasks || []).find((t) => String(t.id) === String(route.task))
      : null;
  return {
    boardName: (boardById && boardById.name) || (boardFromRepo && boardFromRepo.name) || '',
    boardId: (boardById && boardById.id) || (boardFromRepo && boardFromRepo.id) || '',
    dirName: topic ? topic.name : '',
    pageTitle: taskRow ? `#${taskRow.id}` : '',
  };
}
