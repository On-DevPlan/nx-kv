// 从 src/core/db/seed-templates.ts 搬来：出厂「ref 生成」任务正文。
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
判断依据只有一处——\`show --json\` 的 \`boardMark\`（组任务归属来自库内关联；
正文是纯 markdown，**没有也不会有** frontmatter 头）：

\`\`\`bash
nx-kv localtask show --id <id> --cwd "<项目目录>" --json   # 看 boardMark / repoKey
\`\`\`

- \`boardMark\` 非空 → **组任务**（组页「新增任务」提交的）。文档挂**组**：
  \`\`\`bash
  nx-kv docs ref add --owner group --group <boardMark> --desc "<一句话短描述>" --json
  \`\`\`
  **不要用 group_repo**——那是「组对某成员仓库的组内描述」，一个 (组,仓库) 只有一篇，会被覆盖。
- \`boardMark\` 为空 → **仓库任务**（目录页提交的）。文档挂**仓库**：
  \`\`\`bash
  nx-kv docs ref add --owner repo --repo <仓库key> --desc "<一句话短描述>" --json
  \`\`\`
  \`<仓库key>\` 直接用 show --json 的 \`repoKey\`（任务归属仓库的 key）；没有就用第 1 步
  \`repo list\` 里 \`path\` 匹配 <项目目录> 的那条 key。

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
