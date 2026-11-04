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
