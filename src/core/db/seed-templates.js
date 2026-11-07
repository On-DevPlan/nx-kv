// 内置提示词模板的 seed（bootstrap 打开库时 INSERT OR IGNORE）。
//
// 为什么 seed 在 core/db：模板表（templates）的「内置永远在场」取代了旧
// templates/service.js「读到缺失就补回」的代码纠数据逻辑 —— 补数据是存储
// 引导的一部分，与 ensureSentinelRepo（哨兵仓库）同类，必须在 core 层做
// （core 不得 import modules）。
//
// **INSERT OR IGNORE 是唯一的写入方式**：用户改过 builtin 的 body / vars 后，
// 重启绝不能被代码里的出厂文本覆盖（T06 裁决：builtin 标记不覆盖用户编辑）。
// 所以升级内置模板正文 = 改这里的出厂文本 + 用户手动重置（没有自动覆盖）。
//
// 四个 category = 面板「提示词 / 模板」的四个 tab：
//   newtask   新建任务的骨架正文（MD 工作台；出厂即文字，用户直接改这段文字）
//   delivery  领取/交付时包在正文外面的段
//   enhance   条件增强段（{{#if goal}}…{{/if}}：这次数据适用才出现）
//   context   组/仓库上下文（参考文档地址、关键要求）

/**
 * 新建任务骨架（与前端 md-parse.js 的 NEW_TEMPLATE 保持同构 —— 见 templates/service.js 头注释）。
 *
 * 骨架里**不再留 {{槽位}} 标记**（任务 #87：「直接文字就是模板」）：出厂正文就是
 * 可读的文字，用户在设置里直接改这段文字即可。渲染结果与旧版逐字一致
 * （旧版 {{背景}} 渲染出来也是这句默认文字）。
 */
export const NEWTASK_BODY = `## 背景

（一句话说清要改什么）

## 验收
- [ ] …

## 约束
- …

## 附件
`;

/** 内置模板各槽位的默认文字（渲染时的兜底：没填就显示这些）。 */
export const NEWTASK_VARS = {
  背景: '（一句话说清要改什么）',
  验收: '…',
  约束: '…',
  附件: '',
};

/** 内置模板清单（顺序即 sort_order）。id 稳定：升级不改 id，用户配置跟着 id 走。 */
export const BUILTIN_TEMPLATES = Object.freeze([
  {
    id: 'default',
    category: 'newtask',
    name: '默认模板',
    slot: 'suffix',
    body: NEWTASK_BODY,
    varsSchema: [],
    vars: NEWTASK_VARS,
    isDefault: 1,
  },
  {
    id: 'newtask.bugfix',
    category: 'newtask',
    name: '缺陷修复',
    slot: 'suffix',
    body: [
      '## 现象',
      '',
      '{{现象}}',
      '',
      '## 复现步骤',
      '',
      '{{复现}}',
      '',
      '## 期望结果',
      '',
      '{{期望}}',
      '',
      '## 验收',
      '- [ ] {{验收}}',
      '',
      '## 约束',
      '- {{约束}}',
      '',
      '## 附件',
    ].join('\n'),
    varsSchema: [],
    vars: {
      现象: '（描述实际看到的错误 / 异常表现）',
      复现: '1. …\n2. …\n3. …',
      期望: '（描述正确行为应该是什么）',
      验收: '修复后回归通过，且不引入新的同类错误',
      约束: '（不能动的模块 / 兼容性要求）',
    },
    isDefault: 0,
  },
  {
    id: 'newtask.feature',
    category: 'newtask',
    name: '功能开发',
    slot: 'suffix',
    body: [
      '## 目标',
      '',
      '{{目标}}',
      '',
      '## 背景',
      '',
      '{{背景}}',
      '',
      '## 验收',
      '- [ ] {{验收}}',
      '',
      '## 约束',
      '- {{约束}}',
      '',
      '## 附件',
    ].join('\n'),
    varsSchema: [],
    vars: {
      目标: '（一句话说清要交付什么能力）',
      背景: '（为什么要做、当前痛点）',
      验收: '（可观察的完成标准）',
      约束: '（技术栈 / 接口 / 兼容性要求）',
    },
    isDefault: 0,
  },
  {
    id: 'newtask.research',
    category: 'newtask',
    name: '调研任务',
    slot: 'suffix',
    body: [
      '## 问题',
      '',
      '{{问题}}',
      '',
      '## 范围',
      '',
      '- {{范围}}',
      '',
      '## 交付物',
      '',
      '- [ ] {{交付物}}',
      '',
      '## 判断标准',
      '',
      '{{判断}}',
    ].join('\n'),
    varsSchema: [],
    vars: {
      问题: '（要回答的核心问题）',
      范围: '（需要覆盖的代码 / 文档 / 外部资料）',
      交付物: '结论 + 依据 + 后续建议',
      判断: '（什么样的结论算可信、可落地）',
    },
    isDefault: 0,
  },
  {
    id: 'newtask.doc',
    category: 'newtask',
    name: '文档修订',
    slot: 'suffix',
    body: [
      '## 要改的文档',
      '',
      '{{文档}}',
      '',
      '## 本次修订',
      '',
      '{{修订}}',
      '',
      '## 验收',
      '- [ ] {{验收}}',
      '',
      '## 约束',
      '- 保持既有结构与术语一致',
    ].join('\n'),
    varsSchema: [],
    vars: {
      文档: '（文档路径，例如 docs/xxx.md）',
      修订: '（改哪几节、补什么内容）',
      验收: '（读者能按新文档完成什么操作）',
    },
    isDefault: 0,
  },
  {
    id: 'delivery.main',
    category: 'delivery',
    name: '交付文本骨架',
    slot: 'suffix',
    body: [
      '{{task.text}}',
      '',
      '{{#if repo}}📁 项目：{{repo.name}}{{#if repo.desc}} —— {{repo.desc}}{{/if}}{{/if}}',
      '{{#each repo.docs}}\n  📄 {{this.path}}{{#if this.tag}} [{{this.tag}}]{{/if}}{{/each}}',
    ].join('\n'),
    varsSchema: [],
    vars: {},
    isDefault: 1,
  },
  {
    id: 'enhance.timegoal',
    category: 'enhance',
    name: '时间目标提醒',
    slot: 'suffix',
    body: [
      '{{#if goal}}',
      '⏱ 本次任务有 {{goal.durationHuman}} 的时间目标，{{goal.remainingHuman}}内应交付；',
      '到点前先执行 timegoal check 汇报现状，未到点不得标记完成。',
      '{{/if}}',
    ].join('\n'),
    varsSchema: [],
    vars: {},
    isDefault: 1,
  },
  {
    id: 'context.main',
    category: 'context',
    name: '仓库/组上下文',
    slot: 'suffix',
    body: [
      '{{#if group}}🗂 项目组「{{group.name}}」{{#if group.desc}}：{{group.desc}}{{/if}}{{/if}}',
      '{{#each group.docs}}\n  - {{this.path}}{{/each}}',
    ].join('\n'),
    varsSchema: [],
    vars: {},
    isDefault: 1,
  },
]);

/**
 * seed 内置模板（幂等；必须在外层事务内跑）。
 * INSERT OR IGNORE：任何已有行（用户改过的 builtin、legacy 导入的模板）原样保留。
 *
 * is_default 的取值带守卫：某个 category 已经有默认模板（比如 legacy 导入时
 * defaultId 指到别的模板）时，内置不再抢默认 —— 否则 ux_templates_default 唯一索引
 * 会让 bootstrap 直接失败（seed 在 import 之后跑）。
 */
export function seedBuiltinTemplates(conn, atMs) {
  for (const [index, t] of BUILTIN_TEMPLATES.entries()) {
    conn.run(
      `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                              enabled, sort_order, builtin, state, version, deleted_at,
                              created_at, updated_at)
       VALUES (:id, :category, :name, :slot, :body, :schema, :vars,
               CASE WHEN :isDefault = 1 AND EXISTS (
                 SELECT 1 FROM templates
                  WHERE category = :category AND is_default = 1 AND deleted_at IS NULL
               ) THEN 0 ELSE :isDefault END,
               1, :sort, 1, '', 0, NULL, :at, :at)
       ON CONFLICT(id) DO NOTHING`,
      {
        id: t.id,
        category: t.category,
        name: t.name,
        slot: t.slot,
        body: t.body,
        schema: JSON.stringify(t.varsSchema || []),
        vars: JSON.stringify(t.vars || {}),
        isDefault: t.isDefault ? 1 : 0,
        sort: index,
        at: atMs,
      }
    );
  }
  return BUILTIN_TEMPLATES.length;
}
