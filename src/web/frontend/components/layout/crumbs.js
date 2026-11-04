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
