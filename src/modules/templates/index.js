// 任务模板模块：MD 工作台「新建页」的起始正文，本机可配置（增删/设默认）。
//
// 与 localtask 是近亲但独立成模块：模板是「怎么开一页」的编辑器偏好，不是队列数据；
// 生命周期也不同（队列按目录漂移，模板全机共享）。落在 ~/.nx-kv/templates.json。
//
// 不声明 resource：模板没有「改单条」与「查单条」（改 = 删了重加，或面板里
// 直接改默认），不凑 CRUD 五件的数，免得为了凑数造出没人用的命令。
import * as service from './service.js';
import { badInput } from '../../core/errors.js';
import { topicKeyOf } from '../../core/topic-key.js';
import { resolve as resolvePath } from 'node:path';

const renderList = (d) => {
  const lines = [`模板 ${d.templates.length} 个（默认: ${d.defaultId}）`];
  for (const t of d.templates) {
    const head = String(t.body || '').split('\n').find((l) => l.trim()) || '（空）';
    const scopeMark = d.scoped
      ? `  · ${t.perm && t.perm.edit ? '本主题可编辑' : '仅可用'}`
      : '';
    lines.push(`  ${t.id === d.defaultId ? '★' : ' '} ${t.id}${t.builtin ? ' [内置]' : ''}  ${t.name}  ·  ${head.trim().slice(0, 40)}${scopeMark}`);
  }
  return lines.join('\n');
};

// 槽位值：CLI 传 JSON 字符串，HTTP 传对象——两种都收，解析失败给明确报错。
function parseValues(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim();
  if (!s) return undefined;
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('不是对象');
    return v;
  } catch (e) {
    throw badInput(`--values 要传 JSON 对象（形如 {"背景":"要做的事"}）：${e.message || e}`);
  }
}

// 可见域：CLI 传 JSON 数组字符串（或逗号分隔短写），HTTP 传数组——归一（含非法
// 条目校验）在 service 层。cmd.exe 里塞 JSON 引号太痛苦，裸条目按逗号拆。
function parseScope(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return raw;
  const s = raw.trim();
  if (!s) return undefined;
  if (s.startsWith('[')) return s; // JSON 数组
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

// --cwd → 创建主题锚（与 localtask 同一派生：完整 cwd 小写折叠、无组上下文）。
function topicFromCwd(raw) {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  return topicKeyOf(resolvePath(s), '');
}

export default {
  id: 'templates',
  title: '任务模板（MD 工作台新建页的起始正文）',
  order: 22,
  // 无独立面板：管理入口在 MD 工作台（落地页「模板」菜单 / 工具栏「模板管理」）

  actions: [
    {
      id: 'templates.list',
      cli: ['template', 'list'],
      http: ['GET', '/api/templates'],
      summary: '列出任务模板（含默认模板 id；新建页的起始正文按默认模板取）',
      flags: {
        topic: { type: 'string', hint: '按队列 topics.key 过滤（可与 --group/--repo 组合；响应带 scoped:true）' },
        group: { type: 'string', hint: '按项目组 repos.key 过滤（#132：组本身是可见主体，与 topic/repo 平级）' },
        repo: { type: 'string', hint: '按项目 repos.key 过滤' },
      },
      run: (ctx) =>
        ctx.topic || ctx.group || ctx.repo
          ? service.listTemplatesForTopic({ topic: ctx.topic, group: ctx.group, repo: ctx.repo })
          : service.listTemplates(),
      render: renderList,
    },
    {
      id: 'templates.add',
      cli: ['template', 'add'],
      http: ['POST', '/api/templates'],
      summary: '新增任务模板（--body 给 Markdown 正文；多行正文用 --body-file <文件> 或 --body - 读管道；--setDefault 同时设为默认；--scope 设可见域、--topic 记创建主题并默认仅该主题可见）',
      args: ['name'],
      flags: {
        body: { type: 'string', hint: '模板正文（Markdown；首行写 `# 标题` 则提交时作为任务标题）' },
        bodyFile: { type: 'string', hint: '从文件读模板正文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
        setDefault: { type: 'boolean', hint: '新增后立即设为默认模板' },
        'set-default': { type: 'boolean', hint: '同 --setDefault（连字符写法）' },
        scope: { type: 'raw', hint: '可见域（#128/#131）：* 全局 / topic:<key> 队列 / repo:<key> 项目 / group:<key> 组——JSON 数组或逗号短写；缺省空（未配置，不默认全局）；带 --topic 时默认仅该主题' },
        topic: { type: 'string', hint: '创建主题锚（topics.key）：默认仅该主题可见，origin_topic 记它' },
        cwd: { type: 'string', hint: '同 --topic，但给工作目录（按目录派生主题 key）' },
      },
      // 读文件/读管道只给 CLI：HTTP 是面板的通道，不该变成「任意读本机文件」的入口
      run: (ctx, opts) =>
        service.addTemplate({
          name: ctx.name,
          body: ctx.body,
          bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']),
          setDefault: ctx.setDefault ?? ctx['set-default'],
          scope: parseScope(ctx.scope),
          topic: ctx.topic || topicFromCwd(ctx.cwd),
        }),
      render: (d) =>
        `已新增模板「${d.template.name}」（${d.template.id}）${d.defaultId === d.template.id ? '，并设为默认' : ''}${
          Array.isArray(d.template.scope) && !d.template.scope.includes('*')
            ? `，可见域 ${JSON.stringify(d.template.scope)}`
            : ''
        }`,
    },
    {
      id: 'templates.update',
      cli: ['template', 'update'],
      http: ['PATCH', '/api/templates/:id'],
      summary: '编辑任务模板（--name 改名 / --body 改正文 / --scope 改可见域，只改传入项；多行正文用 --body-file；内置模板的正文也可改）',
      args: ['id'],
      flags: {
        name: { type: 'string', hint: '新名字（不传保持不变）' },
        body: { type: 'string', hint: '新正文（Markdown；不传保持不变）' },
        bodyFile: { type: 'string', hint: '从文件读新正文（--body 优先）；`-` = 读标准输入' },
        'body-file': { type: 'string', hint: '同 --bodyFile（连字符写法）' },
        scope: { type: 'raw', hint: '可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写（不传保持不变）' },
        values: {
          type: 'string',
          hint: '槽位值 JSON（形如 {"背景":"要做的事"}）——老模板正文里的 {{槽位名}} 处填这段文字（新模板直接写正文即可）',
        },
      },
      run: (ctx, opts) =>
        service.updateTemplate({
          id: ctx.id,
          name: ctx.name,
          body: ctx.body,
          bodyFile: opts && opts.transport === 'http' ? undefined : (ctx.bodyFile ?? ctx['body-file']),
          scope: parseScope(ctx.scope),
          values: parseValues(ctx.values),
        }),
      render: (d) => `已更新模板「${d.template.name}」（${d.template.id}）`,
    },
    {
      id: 'templates.remove',
      cli: ['template', 'remove'],
      http: ['DELETE', '/api/templates/:id'],
      summary: '删除任务模板（内置默认模板不可删；删的是默认模板则默认回落到内置）',
      args: ['id'],
      run: (ctx) => service.removeTemplate({ id: ctx.id }),
      render: (d) => `已删除模板「${d.removed.name}」（${d.removed.id}）${d.wasDefault ? '，默认模板回落为内置' : ''}`,
    },
    {
      id: 'templates.default',
      cli: ['template', 'default'],
      http: ['PATCH', '/api/templates/default'],
      // 这条路由同时管两件事——**字面量路由优先于 :id**（runtime/api.js 的路由排序：
      // 字面量段在前），所以 id 恰是 'default' 的模板，正文更新会被这条路由截走：
      //   带 name/body/values/scope → 改**默认模板本身**（id 就是 default）
      //   只带 id                  → 把默认模板换成它
      // 不分派的话，「默认模板」永远存不进去（面板里改默认模板 400，2026-11-07 任务 #87 实锤）。
      summary: '设置默认模板（新建页的起始正文换成它）；带 --body/--name/--scope 则改默认模板本身',
      args: ['id'],
      // flag 声明补齐（之前一个都没声明）：CLI 的 --body/--name/--scope 会撞
      // 「未知参数」；声明之后 CLI 能传，HTTP 的 body 字段也照常落在 ctx 上。
      // values/scope 用 raw：值本身是对象/数组，不能被 String() 压掉。
      flags: {
        name: { type: 'string', hint: '新名字（配合 --body/--scope 时改默认模板本身）' },
        body: { type: 'string', hint: '新正文（配合时改默认模板本身）' },
        values: { type: 'raw', hint: '槽位值 JSON（CLI 传 JSON 串；HTTP 可直接给对象）' },
        scope: { type: 'raw', hint: '可见域（#128）：* / topic:<key> / repo:<key> / group:<key>，JSON 数组或逗号短写' },
      },
      run: (ctx) => {
        if (
          ctx.body !== undefined || ctx.name !== undefined ||
          ctx.values !== undefined || ctx.scope !== undefined
        ) {
          return service.updateTemplate({
            id: ctx.id || 'default',
            name: ctx.name,
            body: ctx.body,
            values: parseValues(ctx.values),
            scope: parseScope(ctx.scope),
          });
        }
        return service.setDefaultTemplate({ id: ctx.id });
      },
      render: (d) => `默认模板已设为「${d.template.name}」（${d.template.id}）`,
    },
  ],
};
