// 工作空间（group）模块：列出、查看当前、切换。
//
// 后端没有 group 的增删改接口（只有 `GET /api/v1/groups`），所以本模块**不是** CRUD 资源——
// 硬凑 create/update/remove 会得到一堆调不通的命令。它是「动作集合」，
// 但仍然满足底线要求：每个 action 两端可达。
//
// 切换是**本机态**：只改 ~/.nx-kv/config.json 的 groupId，不动服务端任何数据。
// 之后所有 todo 读写都带上它，后端按 groupId 隔离（实测 190 组与默认组数据不同）。
import { loadConfig, updateConfig } from '../../core/config.js';
import { listGroups } from '../../core/kvapi.js';
import { requireAuth } from '../../core/config.js';
import { badInput, notFound } from '../../core/errors.js';

// 把用户给的定位符解析成 groupId：
//   "24" / 24        → 24
//   "0" / "default"  → 0（默认组，不传 groupId）
//   "shared"         → 按名字匹配（大小写不敏感）
async function resolveGroupId(locator) {
  const s = String(locator ?? '').trim();
  if (!s) throw badInput('必须给出工作空间 id 或名称（nx-kv group list 可查看）');
  if (s === '0' || s.toLowerCase() === 'default') return { id: 0, name: '默认组' };

  const groups = await listGroups();
  if (/^\d+$/.test(s)) {
    const id = Number(s);
    const hit = groups.find((g) => g.id === id);
    if (!hit) throw notFound(`工作空间不存在或无权访问: ${id}（nx-kv group list 查看可用项）`);
    return { id, name: hit.name };
  }
  const hit = groups.find((g) => g.name.toLowerCase() === s.toLowerCase());
  if (!hit) throw notFound(`找不到工作空间: ${s}（nx-kv group list 查看可用项）`);
  return { id: hit.id, name: hit.name };
}

export default {
  id: 'group',
  title: '工作空间（= Web「工作空间」切换）',
  order: 20,
  view: () => import('./view.jsx'),

  actions: [
    {
      id: 'group.list',
      cli: ['group', 'list'],
      http: ['GET', '/api/groups'],
      summary: '列出我的工作空间（* 为当前）',
      run: async () => {
        await requireAuth();
        const [groups, cfg] = await Promise.all([listGroups(), loadConfig()]);
        return {
          current: cfg.groupId,
          groups: groups.map((g) => ({ ...g, current: g.id === cfg.groupId })),
        };
      },
      render: (d) => {
        if (!d.groups.length) return '（没有可用工作空间）';
        const w = Math.max(...d.groups.map((g) => g.name.length));
        return d.groups
          .map(
            (g) =>
              `${g.current ? '*' : ' '} ${String(g.id).padStart(4)}  ${g.name.padEnd(w)}  ${g.myRole}${g.description ? '  ' + g.description : ''}`
          )
          .join('\n');
      },
    },
    {
      id: 'group.current',
      cli: ['group', 'current'],
      http: ['GET', '/api/group'],
      summary: '查看当前工作空间',
      run: async () => {
        const cfg = await loadConfig();
        if (!cfg.groupId) return { id: 0, name: '默认组' };
        // 名字是尽力而为：后端不可达时不该让「看当前是什么」失败
        const groups = await listGroups().catch(() => []);
        const hit = groups.find((g) => g.id === cfg.groupId);
        return { id: cfg.groupId, name: hit ? hit.name : `#${cfg.groupId}` };
      },
      render: (d) => `当前工作空间: ${d.name}（${d.id === 0 ? '默认组，不传 groupId' : 'id=' + d.id}）`,
    },
    {
      id: 'group.use',
      // `switch` 是更符合直觉的别名，两条路径等价
      cli: [['group', 'use'], ['group', 'switch']],
      http: ['POST', '/api/group'],
      summary: '切换当前工作空间（id 或名称；0 / default 回默认组）',
      args: ['locator'],
      run: async (ctx) => {
        await requireAuth();
        const g = await resolveGroupId(ctx.locator);
        await updateConfig({ groupId: g.id });
        return g;
      },
      render: (d) =>
        d.id === 0
          ? '已切回默认组（后续读写不传 groupId）'
          : `已切换到工作空间: ${d.name}（id=${d.id}）`,
    },
  ],
};
