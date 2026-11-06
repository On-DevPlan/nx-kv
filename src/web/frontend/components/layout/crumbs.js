import { findGroupTask } from '../../modules/board/board-view.js';

/**
 * 路由 → 面包屑层级（仓库 / 页；组页单独一组）。
 * 纯函数，供面板与单测共用。
 *
 * #84：仓库是独立模块、项目组只是指向它的指针（侧栏 2026-11-03 语义化改版），
 * 但面包屑还按旧容器语义拼组名（[ nx/nx-kv/#81 ]）——侧栏里的「单独仓库」
 * 一进面板左上角又变回「组/仓库」，两个视图自相矛盾。现在仓库页/任务页的
 * 面包屑只到仓库（[ nx-kv/#81 ]）；组名只在组页（#/group/<id>）出现——
 * 那是组这个实体自己的页面，不是仓库的容器前缀。
 * #86：组任务详情路由 #/group/<boardId>?task=N 挂在组页之下（[ 组名 / #N ]）。
 * @param {object} route {view, key, task}
 * @param {object} ctx   {boardName, dirName, pageTitle}
 */
export function crumbsOf(route, ctx = {}) {
  if (!route || !route.view) return [];
  switch (route.view) {
    case 'dir': {
      const out = [];
      if (ctx.dirName) out.push(ctx.dirName);
      if (route.task) {
        // 草稿统一显示 draft，不暴露 draft-N
        if (/^draft/i.test(String(route.task))) out.push('draft');
        else out.push(ctx.pageTitle || `#${route.task}`);
      }
      return out;
    }
    case 'group':
      // 组任务页（#86）：[ 组名 / #N ]——组任务详情有自己的路由，层级挂在组下
      if (route.task) {
        const out = [ctx.boardName || '项目组'];
        if (/^draft/i.test(String(route.task))) out.push('draft');
        else out.push(ctx.pageTitle || `#${route.task}`);
        return out;
      }
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
 *   任务页 → 该目录/组的任务表面；目录页 → 总览（仓库是顶层模块，上面没有组）；
 *   组任务页 → 组页（#86）；组页 → 总览。
 * 没有上一级时返回 ''（不画返回键）。
 * @param {object} route {view, key, task}
 */
export function parentRouteOf(route) {
  if (!route || !route.view) return '';
  switch (route.view) {
    case 'dir':
      if (route.task) return `#/dir/${encodeURIComponent(route.key || '')}`;
      return '#/overview';
    case 'group':
      if (route.task) return `#/group/${encodeURIComponent(route.key || '')}`;
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
 * boardName 只认 group 路由的 key（看板 id）——仓库路由不再向上挂组（#84 根因：
 * 之前从 repo.boards[0] 回落取组名，仓库只要登记过组，侧栏再独立面包屑也带组前缀）。
 * @param {object} route {view, key, task}
 * @param {object[]} rows   /api/localtasks 的裸 topic 列表
 * @param {object} repoData {boards, repos}
 */
export function crumbCtxOf(route, rows = [], repoData = {}) {
  if (!route) return { boardName: '', dirName: '', pageTitle: '' };
  // group 路由的 key = 看板 id；dir 路由的 key = 主题 key——两组身份别混。
  const boardById = (repoData.boards || []).find((b) => b.id === route.key);
  if (route.view === 'group' && route.task) {
    // 组任务页（#86）：成员队列里搜这条任务（组路由的 key 不是队列 key，
    // 复用组页本组任务同一套寻址原语）
    const g = findGroupTask(rows, repoData.boards || [], route.key, route.task);
    return {
      boardName: (g.board && g.board.name) || (boardById && boardById.name) || '',
      dirName: g.topic ? g.topic.name : '',
      pageTitle: g.taskRow ? `#${g.taskRow.id}` : '',
    };
  }
  const topic = (rows || []).find((r) => r.key === route.key);
  const taskRow =
    topic && route.task
      ? (topic.tasks || []).find((t) => String(t.id) === String(route.task))
      : null;
  return {
    boardName: (boardById && boardById.name) || '',
    dirName: topic ? topic.name : '',
    pageTitle: taskRow ? `#${taskRow.id}` : '',
  };
}
