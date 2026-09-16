// 清单模块：四把 key（open / done / freeze / topics）上的任务管理。
//
// 声明了 `resource: 'todo'`，因此必须齐备 CRUD 五操作且两端可调用 ——
// tests/unit/registry.test.mjs 会据此断言。非 CRUD 的动作（完成/冻结/归档/topic/prompt）
// 用动作动词命名，不受五动词约束，但同样两端可达。
import * as service from './service.js';

// 所有动作都接受 --group 覆盖当前工作空间；默认取本机配置里的当前值
const GROUP = { type: 'number', hint: '工作空间 id（默认取当前）' };

// 完成时间显示：只取到分钟，表格里塞不下完整时间戳
const shortTime = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

function renderTaskList(d) {
  const groups = [
    ['open', '待办'],
    ['done', '已完成'],
    ['freeze', '冻结'],
  ].filter(([k]) => d[k]);

  const lines = [];
  if (d.topic) lines.push(`topic=${d.topic}`);
  for (const [key, label] of groups) {
    const items = d[key];
    if (!items) continue;
    if (!items.length) {
      lines.push(`${label}: （空）`);
      continue;
    }
    lines.push(`${label}（${items.length}）:`);
    const w = Math.max(...items.map((t) => String(t.id).length));
    for (const t of items) {
      const mark = key === 'done' ? `✓ ${shortTime(t.doneAt)}` : key === 'freeze' ? `❄ ${shortTime(t.frozenAt)}` : '';
      lines.push(`  ${String(t.id).padStart(w)}  [${t.topic}] ${t.text}${mark ? '  ' + mark : ''}`);
      if (t.note) lines.push(`  ${' '.repeat(w)}    note: ${t.note.slice(0, 100)}`);
    }
  }
  return lines.join('\n');
}

const renderTask = (t) =>
  [
    `#${t.id}  [${t.topic}]  ${t.text}`,
    `  状态:   ${t.doneAt ? '已完成' : t.frozenAt ? '冻结' : '待办'}${t.bucket ? `（在 ${t.bucket}）` : ''}`,
    `  创建:   ${t.createdAt}`,
    t.doneAt ? `  完成:   ${t.doneAt}` : '',
    t.frozenAt ? `  冻结:   ${t.frozenAt}` : '',
    t.note ? `  备注:   ${t.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

export default {
  id: 'todo',
  title: '清单（= Web「清单」页）',
  order: 30,
  view: () => import('./view.jsx'),

  // CRUD 资源声明：任务的增删查改必须齐备，且 CLI 与面板都能调用
  resource: 'todo',

  actions: [
    // ─── CRUD 五操作 ───────────────────────────────────────────
    {
      id: 'todo.list',
      cli: ['todo', 'list'],
      http: ['GET', '/api/todo'],
      summary: '列出任务（--topic / --status 过滤；默认三个桶全列）',
      flags: {
        topic: { type: 'string', hint: '只看某个主题' },
        status: { type: 'string', enum: ['open', 'done', 'freeze', 'all'], default: 'all' },
        group: GROUP,
      },
      run: (ctx) => service.listTodos({ topic: ctx.topic, status: ctx.status, groupId: ctx.group }),
      render: renderTaskList,
    },
    {
      id: 'todo.get',
      cli: ['todo', 'get'],
      http: ['GET', '/api/todo/:id'],
      summary: '查看单个任务（自动在待办/已完成/冻结里找）',
      args: ['id'],
      flags: {
        topic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) => service.getTodo(Number(ctx.id), { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group }),
      render: renderTask,
    },
    {
      id: 'todo.add',
      cli: ['todo', 'add'],
      http: ['POST', '/api/todo'],
      summary: '新增任务到待办（topic 不在快捷列表时自动补上）',
      args: ['text'],
      flags: { topic: { type: 'string', required: true, hint: '主题，路由维度' }, group: GROUP },
      run: (ctx) => service.addTodo({ topic: ctx.topic, text: ctx.text, groupId: ctx.group }),
      render: (d) =>
        `已加入待办: #${d.id} [${d.task.topic}] ${d.task.text}` +
        (d.topicAdded ? `\n（已把 ${d.task.topic} 加入快捷 topic）` : ''),
    },
    {
      id: 'todo.update',
      cli: ['todo', 'update'],
      http: ['PATCH', '/api/todo/:id'],
      summary: '编辑任务（只改传入的字段）',
      args: ['id'],
      flags: {
        topic: { type: 'string', hint: '改成这个主题' },
        text: { type: 'string' },
        note: { type: 'string' },
        matchTopic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) =>
        service.updateTodo(Number(ctx.id), {
          topic: ctx.topic,
          text: ctx.text,
          note: ctx.note,
          matchTopic: ctx.matchTopic,
          pick: ctx.pick,
          groupId: ctx.group,
        }),
      render: (d) => `已更新 #${d.task.id}（在 ${d.bucket}）`,
    },
    {
      id: 'todo.remove',
      cli: ['todo', 'remove'],
      http: ['DELETE', '/api/todo/:id'],
      summary: '删除任务（只删命中的那一条）',
      args: ['id'],
      flags: {
        topic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) => service.removeTodo(Number(ctx.id), { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group }),
      render: (d) => `已删除 #${d.removed.id} [${d.removed.topic}] ${d.removed.text}`,
    },

    // ─── 状态流转 ──────────────────────────────────────────────
    {
      id: 'todo.done',
      cli: ['todo', 'done'],
      http: ['POST', '/api/todo/:id/done'],
      summary: '标记完成（--result 写进 note 作为完成结果）',
      args: ['id'],
      flags: {
        result: { type: 'string', hint: '完成结果摘要' },
        topic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) =>
        service.doneTodo(Number(ctx.id), { result: ctx.result, topic: ctx.topic, pick: ctx.pick, groupId: ctx.group }),
      render: (d) => `已完成 #${d.task.id} [${d.task.topic}] ${d.task.text}\n  ${d.task.doneAt}`,
    },
    {
      id: 'todo.freeze',
      cli: ['todo', 'freeze'],
      http: ['POST', '/api/todo/:id/freeze'],
      summary: '冻结任务（id 保留，解冻时校验冲突）',
      args: ['id'],
      flags: {
        topic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) => service.freezeTodo(Number(ctx.id), { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group }),
      render: (d) => `已冻结 #${d.task.id} [${d.task.topic}] ${d.task.text}`,
    },
    {
      id: 'todo.unfreeze',
      cli: ['todo', 'unfreeze'],
      http: ['POST', '/api/todo/:id/unfreeze'],
      summary: '解冻回待办（id 撞车时自动换新 id）',
      args: ['id'],
      flags: {
        topic: { type: 'string', hint: '消歧：同 id 有多条时用主题定位' },
        pick: { type: 'number', hint: '消歧：同 id 多条时按编号选（配合报错里的列表）' },
        group: GROUP,
      },
      run: (ctx) => service.unfreezeTodo(Number(ctx.id), { topic: ctx.topic, pick: ctx.pick, groupId: ctx.group }),
      render: (d) =>
        `已解冻 #${d.task.id} [${d.task.topic}] ${d.task.text}` +
        (d.reIded ? '\n（原 id 与现有待办冲突，已分配新 id）' : ''),
    },
    {
      id: 'todo.archive',
      cli: ['todo', 'archive'],
      http: ['POST', '/api/todo/archive'],
      summary: '把已完成里较旧的条目归档到冷 key（默认 30 天前）',
      flags: {
        before: { type: 'string', hint: '截止日期，如 2026-08-01' },
        group: GROUP,
      },
      run: (ctx) => service.archiveDone({ before: ctx.before, groupId: ctx.group }),
      render: (d) =>
        d.moved
          ? `已归档 ${d.moved} 条 -> ${d.coldKey}（已完成剩 ${d.remaining} 条，冷 key 共 ${d.total} 条）`
          : '没有需要归档的条目',
    },

    // ─── 快捷 topic（动作集合，非 CRUD）───────────────────────
    {
      id: 'topic.list',
      cli: ['topic', 'list'],
      http: ['GET', '/api/topics'],
      summary: '快捷主题列表（含各状态任务数）',
      flags: { group: GROUP },
      run: (ctx) => service.listTopics({ groupId: ctx.group }),
      render: (list) => {
        if (!list.length) return '（暂无快捷主题）';
        const w = Math.max(...list.map((t) => t.name.length));
        return list
          .map((t) => `${t.name.padEnd(w)}  待办 ${t.open}  完成 ${t.done}  冻结 ${t.freeze}`)
          .join('\n');
      },
    },
    {
      id: 'topic.add',
      cli: ['topic', 'add'],
      http: ['POST', '/api/topics'],
      summary: '加入快捷主题',
      args: ['name'],
      flags: { group: GROUP },
      run: (ctx) => service.addTopic(ctx.name, { groupId: ctx.group }),
      render: (d) => (d.added ? `已加入快捷主题: ${d.name}` : `${d.name} 已在快捷列表中`),
    },
    {
      id: 'topic.remove',
      cli: ['topic', 'remove'],
      http: ['DELETE', '/api/topics'],
      summary: '移出快捷主题（不动已有任务；仍被任务使用时会在结果里提示）',
      args: ['name'],
      flags: { group: GROUP },
      run: (ctx) => service.removeTopic(ctx.name, { groupId: ctx.group }),
      render: (d) => {
        if (!d.removed) return `${d.name} 本就不在快捷列表中`;
        return d.inUse
          ? `已移出快捷主题: ${d.name}\n注意: 仍有 ${d.inUse} 条任务在用它，主题名不会消失，只是不再出现在候选里`
          : `已移出快捷主题: ${d.name}`;
      },
    },

    // ─── 主题提示词（给 agent 的上下文）───────────────────────
    {
      id: 'prompt.get',
      cli: ['prompt', 'get'],
      http: ['GET', '/api/prompts/:topic'],
      summary: '读取某主题的上下文提示词',
      args: ['topic'],
      flags: { group: GROUP },
      run: (ctx) => service.getPrompt(ctx.topic, { groupId: ctx.group }),
      render: (d) => (d.hasPrompt ? d.prompt : `（${d.topic} 没有配置提示词）`),
    },
    {
      id: 'prompt.set',
      cli: ['prompt', 'set'],
      http: ['POST', '/api/prompts/:topic'],
      summary: '写入某主题的上下文提示词（覆盖）',
      args: ['topic', 'text'],
      flags: { group: GROUP },
      run: (ctx) => service.setPrompt(ctx.topic, ctx.text, { groupId: ctx.group }),
      render: (d) => `已写入 ${d.topic} 的提示词（${d.bytes} 字节）`,
    },
    {
      id: 'prompt.remove',
      cli: ['prompt', 'remove'],
      http: ['DELETE', '/api/prompts/:topic'],
      summary: '删除某主题的提示词',
      args: ['topic'],
      flags: { group: GROUP },
      run: (ctx) => service.removePrompt(ctx.topic, { groupId: ctx.group }),
      render: (d) => (d.removed ? `已删除 ${d.topic} 的提示词` : `${d.topic} 本就没有提示词`),
    },
  ],
};
