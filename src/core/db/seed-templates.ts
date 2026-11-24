// 内置提示词模板的 seed（bootstrap 打开库时 INSERT OR IGNORE）。
//
// 为什么 seed 在 core/db：模板表（templates）的「内置永远在场」取代了旧
// templates/service.js「读到缺失就补回」的代码纠数据逻辑 —— 补数据是存储
// 引导的一部分，与 ensureSentinelRepo（哨兵仓库）同类，必须在 core 层做
// （core 不得 import modules）。
//
// **内置模板不可改，出厂正文随版本升级自动覆盖**（#195 新口径，取代旧 T06「不覆盖
// 用户编辑」裁决）：builtin 行由这里 UPSERT——body / name / schema / vars / 顺序覆盖，
// 但 is_default / enabled / deleted_at 不碰（不抢默认位、不复活已下线的）。
// 配套：templates/service.updateTemplate 拒绝改 builtin，前端隐藏内置模板的编辑按钮。
// 用户要定制 → 新建一条自己的模板（builtin=0，seed 永不覆盖）。
//
// #191 起模板表只服务一件事：**按模板初始化 task 草稿**（newtask category）。
// 出厂只有一条「ref 生成」内置模板；delivery / enhance / context 三条提示词段
// 已下线（见 RETIRED_BUILTIN_TEMPLATE_IDS）——提示词模板走独立引擎
// （modules/promptplug/plugins/* 的 BUILTIN），与本表无关系。
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


---

## 怎么干（零知识起步的 SOP）

你没有这个仓库 / 项目组的既有知识，**不要凭空回答**。按五步走：

### 1. 先摸清仓库（只读）

\`\`\`bash
nx-kv repo list --json                              # 仓库清单（key / 名称 / 路径）
nx-kv docs list --json                              # 这个仓库已有的文档（refs）
nx-kv docs get --ref <refId>                        # 读某篇文档的正文
nx-kv localtask show --id <id> --cwd "<项目目录>"   # 任务本体 + 附件清单
\`\`\`

### 2. 先判断任务来源，决定文档挂哪里（关键，别跳过）

归档文档必须挂在**任务来源的宿主**上：仓库提交的任务挂仓库，组提交的任务挂组。
判断依据只有一处——任务正文开头的 \`---\` frontmatter（或 show --json 的 \`boardMark\`）：

\`\`\`bash
nx-kv localtask show --id <id> --cwd "<项目目录>" --json   # 看 text 里的 frontmatter / boardMark
\`\`\`

- 有 \`board:\`（boardMark 非空）→ **组任务**（组页「新增任务」提交的）。
  \`board\` 是组 id / key，\`project\` 是组内归属仓库的 key。文档挂**组**：
  \`\`\`bash
  nx-kv docs ref add --owner group --group <board> --desc "<一句话短描述>" --json
  \`\`\`
  **不要用 group_repo**——那是「组对某成员仓库的组内描述」，一个 (组,仓库) 只有一篇，会被覆盖。
- 没有 \`board:\`（boardMark 为空）→ **仓库任务**（目录页提交的；可能只有 \`project:\`，也可能没有 frontmatter）。
  文档挂**仓库**：
  \`\`\`bash
  nx-kv docs ref add --owner repo --repo <仓库key> --desc "<一句话短描述>" --json
  \`\`\`
  \`<仓库key>\` 优先取 frontmatter 的 \`project\`；没有就用第 1 步 \`repo list\` 里 \`path\` 匹配 <项目目录> 的那条 key。
  **不要看 topic 的 repo_key**（老库常是 \`__unbound__\` 哨兵，不是真实归属）。

### 3. 初始化：给这轮问答建一篇 ref

ref 是**文档库里的一篇文档**（正文进 ref_bodies，身份是 \`ref:<16位hex>\`），
不是附件；按第 2 步判断的宿主绑定，挂上就出现在那个宿主的「文档列表」里。

**标题与 desc 都要给**（缺一个，列表里就只是一行没头没尾的条目）：

- **desc** = 一句话短描述（列表 / 提示词模板里的定位标签，如「面板扩展附件类型的九个改动点」）；
- **标题（title）** = 正文第一行的 \`# <标题>\`（文档标题，取用与列表里显示的就是它）。

按第 2 步的宿主二选一执行（仓库任务）：

\`\`\`bash
nx-kv docs ref add --owner repo --repo <仓库key> --desc "<一句话短描述>" --json
\`\`\`

这一步就按第 2 步判断的宿主**完成绑定**：仓库任务 → repo，组任务 → group。
**主篇 / 附加篇只是这个宿主文档列表里的位置**（position=0 是主篇），**不是另一处绑定**：
不要调用 \`docs main\` / \`docs bind\` 去「争主篇」——那是换主篇操作，不是归档。
同一篇只 \`ref add\` 一次（重复挂会在列表里出现两条）。

### 4. 回答问题，再把这轮问答写进那篇 ref

正文**第一行必须是 \`# <标题>\`**（就是上面说的标题），长文本**写进文件**再传
（不受命令行长度限制）：

\`\`\`bash
nx-kv docs set --ref <refId> --body-file <本轮问答.md> --json
\`\`\`

### 5. 收尾

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
  // #191：任务模板只负责「按模板初始化 task 草稿」，与提示词模板无关——提示词
  // 有自己的引擎（promptplug 插件 BUILTIN，见 modules/promptplug/plugins/*）。
  // 这三条是提示词段，历史上混在模板表里出现在任务模板列表，现下线（软删 builtin 行）。
  'delivery.main',
  'enhance.timegoal',
  'context.main',
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
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         body = excluded.body,
         vars_schema = excluded.vars_schema,
         vars = excluded.vars,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at
       WHERE templates.builtin = 1`,
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
