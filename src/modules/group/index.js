// 工作空间（group）模块：完整 CRUD + 切换 + 成员查看。
//
// 后端实际支持：`POST /groups`（建）、`GET /groups`（列）、`PATCH /groups/:id`（改）、
// `DELETE /groups/:id`（解散）、`GET /groups/:id/members`（成员）。
// 所以这是一个**集合资源**，声明 `resource: 'group'` —— 五个 CRUD 操作齐备且两端可达，
// tests/unit/registry.test.mjs 会据此断言。
//
// `current` / `use` / `members` 不是 CRUD，用动作动词命名。
//
// 切换是**本机态**：只改 ~/.nx-kv/config.json 的 groupId，不动服务端任何数据。
// 之后所有 todo 读写都带上它，后端按 groupId 隔离。
import { loadConfig, updateConfig, requireAuth } from '../../core/config.js';
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  listGroupMembers,
} from '../../core/kvapi.js';
import { badInput, notFound } from '../../core/errors.js';

// 纯文本渲染用：把一行的关键信息摆齐
const renderGroupLine = (g, current) =>
  `${current ? '*' : ' '} ${String(g.id).padStart(4)}  ${g.name.padEnd(14)}  ${(g.myRole || '').padEnd(6)}  ${g.memberCount} 人  ${g.description || ''}`;

// 按 id 或名字定位。后端没有「取单个组」的接口，所以从列表里找。
async function findGroup(locator) {
  const s = String(locator ?? '').trim();
  if (!s) throw badInput('必须给出工作空间 id 或名称（nx-kv group list 可查看）');
  const groups = await listGroups();
  const hit = /^\d+$/.test(s)
    ? groups.find((g) => g.id === Number(s))
    : groups.find((g) => g.name.toLowerCase() === s.toLowerCase());
  if (!hit) {
    throw notFound(`工作空间不存在或无权访问: ${s}（nx-kv group list 查看可用项）`);
  }
  return hit;
}

export default {
  id: 'group',
  title: '工作空间（= Web「工作空间」页）',
  order: 20,
  view: () => import('./view.jsx'),

  // 集合资源：建 / 查（列表、单条）/ 改 / 散 都齐备
  resource: 'group',

  actions: [
    // ─── CRUD 五操作 ───────────────────────────────────────────
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
        return d.groups.map((g) => renderGroupLine(g, g.current)).join('\n');
      },
    },
    {
      id: 'group.get',
      cli: ['group', 'get'],
      http: ['GET', '/api/groups/:id'],
      summary: '查看单个工作空间',
      args: ['id'],
      run: async (ctx) => {
        await requireAuth();
        const g = await findGroup(ctx.id);
        const cfg = await loadConfig();
        return { ...g, current: g.id === cfg.groupId };
      },
      render: (g) =>
        [
          `${g.name}${g.current ? '  ← 当前' : ''}`,
          `  id:     ${g.id}`,
          `  角色:   ${g.myRole || '-'}`,
          `  成员:   ${g.memberCount} 人`,
          `  描述:   ${g.description || '-'}`,
          `  创建:   ${String(g.createdAt || '').slice(0, 10) || '-'}`,
        ].join('\n'),
    },
    {
      id: 'group.add',
      cli: ['group', 'add'],
      http: ['POST', '/api/groups'],
      summary: '新建工作空间',
      args: ['name'],
      flags: { description: { type: 'string', hint: '描述' } },
      run: async (ctx) => {
        await requireAuth();
        return createGroup({ name: ctx.name, description: ctx.description });
      },
      render: (g) => `已新建工作空间: ${g.name}（id=${g.id}）\n用 nx-kv group use ${g.id} 切过去`,
    },
    {
      id: 'group.update',
      cli: ['group', 'update'],
      http: ['PATCH', '/api/groups/:id'],
      summary: '改名 / 改描述（只改传入的字段）',
      args: ['id'],
      flags: {
        name: { type: 'string', hint: '新名称' },
        description: { type: 'string', hint: '新描述' },
      },
      run: async (ctx) => {
        await requireAuth();
        const g = await findGroup(ctx.id); // 支持按名字定位，再拿真实 id
        return updateGroup(g.id, { name: ctx.name, description: ctx.description });
      },
      render: (g) => `已更新工作空间: ${g.name}（id=${g.id}）`,
    },
    {
      id: 'group.remove',
      cli: ['group', 'remove'],
      http: ['DELETE', '/api/groups/:id'],
      summary: '解散工作空间（后端要求组内已无 KV）',
      args: ['id'],
      run: async (ctx) => {
        await requireAuth();
        const g = await findGroup(ctx.id);
        const cfg = await loadConfig();
        if (g.id === cfg.groupId) {
          // 解散当前空间会导致后续所有读写打到一个不存在的组上，先拦住
          throw badInput(`不能解散当前正在使用的工作空间（${g.name}），先 nx-kv group use default 切走`);
        }
        await deleteGroup(g.id);
        return { id: g.id, name: g.name };
      },
      render: (d) => `已解散工作空间: ${d.name}（id=${d.id}）`,
    },

    // ─── 非 CRUD：切换与成员 ───────────────────────────────────
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
      cli: [['group', 'use'], ['group', 'switch']],
      http: ['POST', '/api/group'],
      summary: '切换当前工作空间（id 或名称；0 / default 回默认组）',
      args: ['locator'],
      run: async (ctx) => {
        await requireAuth();
        const s = String(ctx.locator ?? '').trim();
        if (s === '0' || s.toLowerCase() === 'default') {
          await updateConfig({ groupId: 0 });
          return { id: 0, name: '默认组' };
        }
        const g = await findGroup(s);
        await updateConfig({ groupId: g.id });
        return g;
      },
      render: (d) =>
        d.id === 0
          ? '已切回默认组（后续读写不传 groupId）'
          : `已切换到工作空间: ${d.name}（id=${d.id}）`,
    },
    {
      id: 'group.members',
      cli: ['group', 'members'],
      http: ['GET', '/api/groups/:id/members'],
      summary: '查看工作空间成员',
      args: ['id'],
      run: async (ctx) => {
        await requireAuth();
        const g = await findGroup(ctx.id);
        return { group: { id: g.id, name: g.name }, members: await listGroupMembers(g.id) };
      },
      render: (d) => {
        if (!d.members.length) return `${d.group.name}: （没有成员）`;
        const w = Math.max(...d.members.map((m) => m.email.length));
        return d.members
          .map((m) => `  ${m.email.padEnd(w)}  ${m.role.padEnd(8)}  ${m.nickname}`)
          .join('\n');
      },
    },
  ],
};
