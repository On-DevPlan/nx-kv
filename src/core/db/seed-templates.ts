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
import type { DbApi } from './driver.js';

/**
 * 内置「ref 生成」任务模板的正文（#137）。
 *
 * 它是**新任务正文骨架**：用户在这个仓库里提一个问题 → agent 按正文里的
 * 「零知识起步 SOP」走一遍 → 这轮问答被归档成一篇 ref，挂进该仓库的文档列表。
 *
 * 为什么是这段文字而不是一段模板占位符：#87 之后「直接文字就是模板」——
 * 出厂正文要能被 agent **直接照着执行**（命令、顺序、检查点都在里面）。
 */
export const NEWTASK_REF_BODY = `## 本轮问题

（把你要问这个仓库的问题写在这里）

---

## 怎么干（零知识起步的 SOP）

你没有这个仓库的既有知识，**不要凭空回答**。按四步走：

### 1. 先摸清仓库（只读）

\`\`\`bash
nx-kv repo list --json                              # 仓库清单（key / 名称 / 路径）
nx-kv docs list --json                              # 这个仓库已有的文档（refs）
nx-kv docs get --ref <refId>                        # 读某篇文档的正文
nx-kv localtask show --id <id> --cwd "<项目目录>"   # 任务本体 + 附件清单
\`\`\`

### 2. 初始化：给这轮问答建一篇 ref

ref 是**文档库里的一篇文档**（正文进 ref_bodies，身份是 \`ref:<16位hex>\`），
不是附件；它能挂到仓库 / 组 / 组内仓库，挂上就出现在那个宿主的「文档列表」里。

**标题与 desc 都要给**（缺一个，列表里就只是一行没头没尾的条目）：

- **desc** = 一句话短描述（列表 / 提示词模板里的定位标签，如「面板扩展附件类型的九个改动点」）；
- **标题（title）** = 正文第一行的 \`# <标题>\`（文档标题，取用与列表里显示的就是它）。

\`\`\`bash
nx-kv docs ref add --owner repo --repo <仓库key> --desc "<一句话短描述>" --json
\`\`\`

这一步就**把 ref 挂进仓库了**：仓库有主篇 → 它是附加篇；没有主篇 → 它就是主篇。
**不要再挂一次**（同一篇挂两次，列表里会出现两条）。

### 3. 回答问题，再把这轮问答写进那篇 ref

正文**第一行必须是 \`# <标题>\`**（就是上面说的标题），长文本**写进文件**再传
（不受命令行长度限制）：

\`\`\`bash
nx-kv docs set --ref <refId> --body-file <本轮问答.md> --json
\`\`\`

### 4. 收尾

\`\`\`bash
nx-kv localtask done --id <id> --cwd "<项目目录>" --summary "<回答了什么 + 这篇文档的标题>"
\`\`\`

**收尾报告这篇文档的标题**（如「面板如何扩展附件类型」）——用户看的是标题，
\`refId\` 是内部地址，不用报给用户；但它要写进交付正文里，方便以后取用。`;

/**
 * 下线的内置模板 id（#137）。
 *
 * 新建任务模板只保留一条「ref 生成」——其余几条（缺陷修复 / 功能开发 / 调研任务 /
 * 文档修订）是**空骨架**，用户新建任务时只会拿到一堆占位小节，没有任何价值。
 *
 * 下线 = 软删（deleted_at）：只动 builtin 行，用户自己复制/新建的条目（builtin=0）不受影响。
 * 老库里这些行已经存在（seed 是 INSERT OR IGNORE），所以要在 seed 里显式下线。
 */
export const RETIRED_BUILTIN_TEMPLATE_IDS = Object.freeze([
  'default',
  'newtask.bugfix',
  'newtask.feature',
  'newtask.research',
  'newtask.doc',
]);

/** 内置模板清单（顺序即 sort_order）。id 稳定：升级不改 id，用户配置跟着 id 走。 */
export const BUILTIN_TEMPLATES = Object.freeze([
  {
    id: 'newtask.ref',
    category: 'newtask',
    name: 'ref 生成',
    slot: 'suffix',
    body: NEWTASK_REF_BODY,
    varsSchema: [],
    vars: {},
    isDefault: 1,
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
      '{{#each repo.docs}}',
      '  📄 {{this.desc}}{{#if this.refId}}（nx-kv docs get --ref {{this.refId}}）{{/if}}',
      '{{/each}}',
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
 *
 * #137：**先下线、再插入**。下线走软删（deleted_at）：被下线的内置条目
 * （新建任务模板只留「ref 生成」一条）从面板消失，但用户自己复制/新建的条目
 * （builtin=0）一律不动。先下线再插入，是为了让 is_default 的守卫看不到
 * 旧的内置默认位——否则新内置拿不到默认，用户的「新建任务」仍然用旧骨架。
 */
export function seedBuiltinTemplates(conn: DbApi, atMs: number): number {
  // ① 下线旧内置（只动 builtin 行）
  for (const id of RETIRED_BUILTIN_TEMPLATE_IDS) {
    conn.run(
      `UPDATE templates SET deleted_at = :at, updated_at = :at
        WHERE id = :id AND builtin = 1 AND deleted_at IS NULL`,
      { id, at: atMs },
    );
  }
  // ② 插入（内置永远在场）
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
