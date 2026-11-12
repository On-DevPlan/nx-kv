# kv-waittask-workflow — 阻塞等待用户回填任务的完整 SOP

> 归属 [[waitloop]]。当你要在一个对话里**不结束本轮**、靠一个阻塞工具
> 调用等用户继续回填任务时，按本 SOP 走。
>
> **循环是强制的：每完成一步、提交结果后，结束动作只能是 wait——领取新任务。
> 循环不自行终止，唯一合法的出口是 wait 返回 `timeout`。**

## 一、端到端时序

```
1. agent 正常干活（分析、读写文件、调用其它工具）。
2. 当前任务做完、阶段结果提交后【必须】：
     → 把「nx-kv localtask wait --summary "<当前现状总结>" --json」
       作为本轮【最后一个动作】调用，领取新任务；工具调用超时设为 300000 ms。
     不许做完就收尾停住——「结束动作不是 wait」即为违规。
3. wait 的行为：
     a. 若本目录主题队列已有待领取任务（含 kv-submit 委托排队的）→ 立即取走、
        不开窗、不阻塞（queued:true）；
     b. 否则在本机临时起一个 http 服务器（127.0.0.1，随机端口），
        自动打开浏览器弹窗，然后阻塞。
4. 用户看清现状，回填新任务。
5. wait 解除阻塞，stdout(--json) 返回 {status:"ok", task}，进程退出。
6. agent 从工具结果读 task.text（任务本体）与 instruction（系统区块的渲染结果，
   有则必读），继续干活、提交结果；做完【必须】回到第 2 步——
   循环，不许自行中断。
7. 若阻塞时限（默认 180 秒）内没有回填：wait 返回 {status:"timeout"}（exit 0），
   agent 不再等待，收尾并结束本轮——这是整个循环唯一的合法出口。
```

关键点：**第 2 步不是可选的**——它既是「等用户回填」的手段，也是「领取队列里
已排队任务」的手段；不调 wait，排着的任务（kv-submit 委托的、用户提前排队的）
就永远没人领。另外，第 2 步之后、工具结果回来之前，agent 不产生任何其它动作。
用户的回填正是通过这个工具结果进入对话的，等于用工具调用替代了在原始输入框
打字，agent 这一轮不会因为「等输入」而提前结束。

## 二、现状总结怎么写

wait 必带一句当前现状总结（≤2000 字，连续空白会折叠为单空格）：

- 它**只是状态展示**：并作为「本轮完成总结」记录在被取走
  的任务上（`task.roundSummary`），供用户和后续追溯。
- **它不参与队列分桶**：领取顺序只由本目录队列的先后决定，与措辞无关——同一
  目录的多次 wait（即便现状措辞不同）共用同一个任务队列。所以不必刻意保持
  逐字一致，每次如实写当前现状即可。
- 总结要让用户**不读整段对话也能快速了解现状**，建议包含三要素：
  1. 已经做到哪一步 / 产出了什么；
  2. 当前卡在哪、有哪些可选项；
  3. 具体等用户决定或补充什么。
- 一句话为宜。示例：
  - `已完成登录，等待选择工作空间`
  - `已生成 3 个方案（A/B/C），等待你选一个再细化`
  - `登录页已修复，等待验收反馈`

## 三、队列语义（按目录划分、可提前排队）

- **工作目录 + 项目组即主题**：wait 不传 `--cwd` 时按进程当前目录的**完整路径**
  与项目组派生主题 key（显示名取目录名；不同目录即使同名也不共用队列）；
  `add` 可用 `--cwd` 给任意目录的主题排任务。不同目录 → 不同主题 → 队列互不串。
- 用户回填的、或别人用 `localtask add`（kv-submit）
  提交的任务，都会以 `pending` 进入对应目录的队列。
- wait 总是取走该队列**最早的一条 pending**，标记为已领取（consumed）后返回：
  - 队列非空 → wait 立刻返回（`queued:true`），连弹窗都不打开；
  - 队列为空 → 才开窗阻塞（`delivered:true`）。
- 已领取的任务保留为历史（状态「已领取」），不会被二次取走。

这让「趁 agent 还在忙，先把后面几条排好」成为可能：agent 每次 wait 都能立刻
拿到下一条，不打断节奏。

## 四、返回形状与退出码

成功（exit 0）：

```json
{
  "status": "ok",
  "cwd": "D:\\code\\a_js\\proj\\demo",
  "summary": "已完成登录，等待选择工作空间",
  "task": { "id": 3, "text": "选择工作空间 A", "status": "consumed",
            "createdAt": "2026-10-11 10:00:00", "consumedAt": "2026-10-11 10:00:04",
            "roundSummary": "已完成登录，等待选择工作空间" },
  "instruction": "<nx-kv><nx-kv.context>…项目 / 组上下文…</nx-kv.context><nx-kv.timecheck>〔时间目标「demo」剩余 2.5 小时〕</nx-kv.timecheck><nx-kv.ack>完成之后必须调用 nx-kv localtask done --id 3 --summary \"<完成总结>\" 汇报结果。</nx-kv.ack></nx-kv>",
  "delivered": true,
  "queued": false,
  "source": "local"
}
```

- `delivered:true` = 实时回填；`queued:true` = 取到队列里排队的任务（二者互斥）。
- `source` = 任务来自哪个队列：`"local"`（本目录队列，含实时回填）或 `"global"`
  （全局任务池）；agent 不必区分，照常执行 `task.text`。
- **任务内容永远读 `task.text`**，多行换行原样保留。
- **`instruction` 有则必读**：系统区块的服务端渲染结果——项目 / 组上下文、附件清单与
  本地路径、时间目标状态（任务级目标另带 check 指令）、时间目标特殊提示（goalhint）、
  ack 汇报指令、项目级持续 get 指令。
  字段缺席 = 本轮没有可渲染内容，直接执行任务。
- **配置模型（一份共享变量 + Handlebars 模板）**：所有系统段落都由同一份入参列表渲染——
  项目（`repo.*`）、项目组（`group.*`，含组定位 / 本项目位置 / 成员 / 绑定文档）、
  任务（`task.*`）、附件（`attach.*`）、时间目标（`goal.*`）、持续 get（`getloop.*`），
  外加 `source / summary / cwd / name / params`。引擎是 **Handlebars 4.x**：
  `{{var}}` 取值、`{{#if x}}…{{else}}…{{/if}}` 条件、`{{#each list}}…{{/each}}` 循环。
  另有内置 helper：比较 `eq / ne / gt / gte / lt / lte / between`（拿不到数 → `false`）、
  逻辑 `and / or / not`、数值 `add / sub / mul / div / mod / round / floor / ceil /
  percent / ratio / clamp`（坏输入 → 可见的 `NaN`；`percent a b [位数]` 算百分比）、
  串 `includes / length / default`、时间 `formatDuration`。helper 永不抛错，
  可直接写 `{{#if (gte (percent goal.elapsedSec goal.durationSec) 50)}}`。
  列表类变量是**结构化数组**（`group.peers` / `repo.docs` / `group.docs` / `attach.list` /
  `groups`），模板用循环组织，服务端不预拼多行文本。
  `attach.list` 每条按 `kind` 分型：`file`（`file.localPath/fileId/exists/syncCmd`）、
  `url`（`url.href/host`）、`task`（`task.seq/title/status/showCmd/address`）、
  `ref`（`ref.refId/title/desc/readCmd`）；取用命令优先用 `{{usage}}` / `{{cmd}}`，
  模板里不要写死命令格式。单条附件是否可达看该条自己的 `file.exists` / `file.localPath`。
  旧语法**已废弃、不再兼容**：`{{#repo}}…{{/repo}}` 这类旧闸门、旧纯文本占位符
  （`{{group.peers}}` / `{{repo.docs}}` / `{{attach.list}}` / `{{groups}}`）、
  `{{attach.sync}}` / `{{attach.syncText}}` 旧别名、`{{block.content}}` 旧包装都不再生效；
  保存时直接拒绝并提示改用 `{{#if}}` / `{{#each}}`，运行期遇到按坏模板回落内置模板。
  旧模板不保证可用；升级前请按新语法改写（迁移说明见 CHANGELOG）。
  语法错误**保存时直接拒绝**并指出模板与区块；渲染期若仍遇到坏模板，该区块回落到
  内置模板，并在返回载荷的 `renderWarnings` 里给出原因（不静默、不阻断领取）。
- **ack（完成指令与收尾要求的唯一出口）**：默认已内置——`完成之后必须调用 nx-kv
  localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。`；在面板
  「设置 → 提示词模板 → ack 完成总结」里可见、可编辑、可复制后改。`--ack ""`
  恢复内置模板（不是关闭：每个区块始终保留系统内置模板）；多条用 `--ack-list` 整体替换。
  旧 `rule`（回调提示词）区块已删除：`--suffix*` 与 `taskSuffix*` 视图字段一并移除；
  旧数据里的 rule 内容（含 `lt.taskSuffix` / 残留的 `blockTemplates.rule`）首次读取时
  按空行并入 ack 当前生效模板，不丢内容。
- **系统上下文默认是 XML 区块**：`instruction` 里每段系统内容各包一个标签——
  `<nx-kv.context>`（组 / 项目上下文）、`<nx-kv.attachment>`（附件清单与识别要求）、
  `<nx-kv.timecheck>`（时间目标状态 / check 指令）、
  `<nx-kv.goalhint>`（时间目标特殊提示，任务级目标才有）、
  `<nx-kv.ext>`（同主题待领取队列，队列空时不出现）、
  `<nx-kv.ack>`（完成总结汇报指令，默认内置）、`<nx-kv.getloop>`（项目开启持续 get 时），
  整体再包一层 `<nx-kv>`。看到这些标签就知道是系统追加内容，`task.text` 仍是任务原文。
  `<nx-kv.doneguard>` 不进正常交付：只有未到点就想 `done` 时，出现在 blocked 返回的
  `guard` 字段里（可用「设置 → 提示词模板 → 完成门禁提示」定制）。
  追加模式可配：`--append-mode xml|plain`（默认 `xml`；`plain` = 按空行直拼）。
- **每个区块各自一份模板列表**：context / attachment / timecheck / goalhint / doneguard /
  ext / ack / getloop 各自有独立的列表与生效项（共 8 个区块）。面板「设置 → 提示词模板」按区块新建 / 编辑 /
  复制 / 删除 / 启用；CLI 用 `--block-templates '<JSON>'` 整体或按区块更新。
  每个区块始终保留系统内置模板（不可删除）；用户模板删光后按内置渲染。
  旧配置（`{{block.content}}` 包装模板、多段 items、`deliveryTemplate/attachTemplate/
  taskSuffix/ackPrompt`、整组模板与 `xmlBlocks`）在首次读取时自动迁移到对应区块，
  其中 rule 内容并入 ack，不丢内容；旧语法模板不迁移（旧模板不保证可用）。

超时（exit 0，业务结果而非错误）：

```json
{ "status": "timeout", "cwd": "D:\\code\\a_js\\proj\\demo",
  "summary": "已完成登录，等待选择工作空间", "timeoutMs": 180000 }
```

- 超时**不是失败**：退出码 0，按「用户没继续」收尾，不要按错误处理。
- 阻塞时限：默认 180 秒，最大 600 秒，可用 `--timeout <秒>`
  覆盖（超上限自动截断）。
- 参数非法（如缺 `--summary`、缺 `--id`）才是错误（exit 1，文本带「用法」），
  按宿主失败流程处理。

## 五、多主题并存

- 每个工作目录一个主题，各自独立：用户可在任意主题回填或提前排队，互不干扰。
- agent 在哪个目录跑 wait（或 `--cwd` 指哪个目录），就取哪个目录队列的任务，
  互不串。

## 六、全局任务池（跨目录共享，工作窃取）

除本地队列外还有一个**跨所有目录共享**的「全局任务池」：任何目录的 agent 在
本地队列空时自动领取池里的任务，全局也空才阻塞——类似 Go 调度器的 global runq
（本地空 → 全局拿 → 都空才 park）。

- **领取是无条件兜底**：显式传 `--cwd` 也不例外——本地取不到就一定去全局扫一眼。
  不要假设「传了 cwd 就只看本地」。
- **本地优先**：本目录有排队任务时 wait 先取本地的，不会去抢全局的。
- **发布**：`nx-kv localtask add --global "<任务文本>" --json`（`--global` 时
  `--cwd` 被忽略）。适合放不限定接收方、谁闲谁领的通用任务；「只能某人做」的
  任务不要放池子，用 `--cwd` 指名提交。
- **公平**：多个 agent 同时阻塞时，全局任务按阻塞先后（先到先得）投递。
- **返回标记**：`source: "local" | "global"` 标明任务来自本目录队列还是全局池；
  agent 不必区分，照常执行 `task.text`。
- **管理**：`nx-kv localtask list` 中全局主题永远置顶（名称「全局任务」，key 固定
  `__GLOBAL__`）；受保护——`topic remove --key __GLOBAL__` 默认拒绝，`--force`
  才能清空；`topic remove-many --all` 默认跳过它。

## 七、删除主题与批量删除

主题（工作目录）可整体删除，不必逐条删任务：

- **单个删除**：`nx-kv localtask topic remove --cwd "<工作目录>"`（或 `--key <key>`）。
- **批量删除**：`nx-kv localtask topic remove-many --keys "<key,key>"`，也可
  `--cwds "<dir,dir>"`，或 `--all` 清空。
- **安全保护**：等待中的主题默认不删（删了阻塞的 agent 只能等到超时）；
  命令需加 `--force` 才连等待中一起删，agent 随后超时收尾。
- **返回**：单个 `{status:"removed",topic}`；批量 `{count,removed,skipped}`，
  skipped 列出被跳过的「等待中 / 不存在」主题。

## 八、常见错误与避坑

| 错误做法 | 后果 | 正确做法 |
| --- | --- | --- |
| 做完当前任务直接收尾、不调 wait | 强制循环被打破：队列里排着的任务（kv-submit 委托、用户提前排队的）没人领，用户喂的任务石沉大海 | 每一步的结束动作都必须是 wait；只有 timeout 才结束本轮 |
| wait 后又安排别的工具/推理 | wait 阻塞，后续动作被卡住、顺序全乱 | wait 严格放在最后一步，之后只处理返回 |
| 工具超时没设 / 设成 120000 | CLI 默认阻塞 180 秒，宿主会在阻塞中途杀掉调用 | 工具超时设 `300000` ms；用更长的 `--timeout` 时同步放大 |
| wait 不带 / 空着 --summary | 无法展示现状，命令报错退出 | 每次 wait 都写一句现状总结 |
| 刻意维持现状措辞逐字一致 | 白费功夫——现状只是展示，不影响领取 | 每次如实写当前现状即可 |
| 在错误的目录调 wait（没传 --cwd） | 取到别的目录队列的任务，或开出一个没人看的弹窗 | 确认进程 cwd 或显式 `--cwd "<目标目录>"` |
| 把 timeout 当报错、反复重试 | 用户想停却被反复弹窗 | timeout 即收尾结束本轮 |
| 读 `task.id` 当任务内容 | id 只是编号，内容在 `task.text` | 一律读 `task.text` |
| 同时开多个 wait（同一目录主题） | 只有一个收到回填，另一个等到超时 | 同一目录同一时刻只调一个 wait |
| 没用 --json | 输出人读文本，宿主难以可靠解析 | agent 调用一律加 `--json` |

## 九、排障

- 用户回填不一定要等弹窗：已起常驻面板（`nx-kv serve`）时在面板回填，正在阻塞的
  wait 通过轮询（约每 0.5 秒）取走。
- 弹窗没自动打开时：终端输出里有本次地址（`http://127.0.0.1:<端口>/`）。
- wait 结束（拿到任务或超时）后本次网页随即关闭，再提交要等下一次 wait
  开新窗口，或直接在常驻面板回填。
