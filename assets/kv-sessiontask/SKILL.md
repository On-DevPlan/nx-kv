---
name: kv-sessiontask
description: 在一个对话里通过工具调用实时向 agent 回填任务（本机人机接力），替代在原始输入框打字——agent 完成当前任务、提交结果后，把 nx-kv sessiontask wait --summary "<当前现状总结>" 作为本轮最后一步强制调用；现状总结作为等待点 key，命令阻塞并自动打开浏览器弹窗，用户在面板看清现状、针对该现状回填后解除阻塞、把新任务作为工具结果返回，agent 继续；不同现状分散为不同等待点、可分别回填；120 秒未回填则超时收尾。触发词：实时任务、下一条任务、继续给任务、连续提交任务、补充任务、回填任务、现状总结、在网页/弹窗里给任务、任务表提交、不想用输入框、用工具调用实现用户输入、阻塞等待、挂起等用户、人机接力、分散答复、sessiontask、session wait。凡是「agent 不结束本轮、靠一个阻塞工具调用等用户在浏览器里继续喂任务」的场景，都走本 skill。
---

# kv-sessiontask — 对话内实时任务接力

本质是一个循环：**agent 提交结果 → CLI 阻塞 → 用户在 web 看清现状、回填新任务 →
agent 接收并继续**。在一个对话里连续给任务，不靠原始输入框。

agent 完成当前任务、需要下一条输入时，调用一个**阻塞式**工具
`nx-kv sessiontask wait`，并带上一句**当前现状总结**；它自动打开浏览器弹窗。
用户在面板/弹窗一眼看到现状，针对该现状回填，阻塞解除、新任务作为工具结果返回，
agent 接着干。如此循环。

> 纯本机协调：弹窗由 wait 进程临时起的 http 服务器直出，数据存本机文件，
> **不需要登录 KV 后端**。

## 四条硬规则（最重要）

1. **wait 必须是本轮最后一个动作。** 把它安排在所有分析与工具调用之后（阶段
   结果已经通过正常输出提交）；调用之后不要再安排任何别的工具、输出或推理——
   它会阻塞，直到拿到新任务或超时。
2. **这次工具调用的超时设为 `120000` ms（2 分钟）。** 与 CLI 的阻塞上限一致，
   避免宿主在等待中途把调用杀掉。
3. **wait 必须带 `--summary "<当前现状总结>"`，现状总结就是等待点的 key。**
   - 回到**同一个现状**就用**同一句**总结（逐字一致，忽略首尾/连续空白差异），
     从而复用同一个等待点；
   - 进入**新的现状**就换一句新总结，自然分散成新的等待点。
   - 总结写**当前做到哪、卡在哪、等用户决定什么**，让用户不读对话也能在面板
     快速了解现状。
4. **返回 `status:"timeout"` 时直接收尾。** 用户 2 分钟内没回填，就不要再追问、
   不要再次调用 wait，把当前结论交代清楚、结束本轮即可。

## 核心命令

```bash
# 阻塞等待用户针对该现状回填（agent 本轮最后一步；务必加 --json）
nx-kv sessiontask wait --summary "<当前现状总结>" --json
```

返回形状：

| 返回 | 含义 | agent 怎么做 |
| --- | --- | --- |
| `{status:"ok", queued:true, task}` | 取到用户**提前排队**的回填（弹窗未开） | 直接执行 task |
| `{status:"ok", delivered:true, task}` | 用户在弹窗/面板**实时回填** | 执行 task |
| `{status:"timeout", key, summary, timeoutMs}` | 120 秒未收到回填 | 收尾、结束本轮 |

成功结果里带 `key` 与 `summary`；`task` 形如
`{id, text, status, createdAt, consumedAt}`，**任务内容在 `task.text`**。

## 一次循环长什么样

```
agent：干活 → 提交阶段结果
       → 最后一步：nx-kv sessiontask wait --summary "已完成登录，等待选择工作空间" --json
         （阻塞，弹窗/面板顶部显示这句现状）
用户：看清现状 → 回填「选择工作空间 A」→ 提交
agent：工具结果拿到 task.text → 继续干活、提交结果
       → 新现状再 wait（同现状用同一句，新现状换新句）……（循环）
若 120 秒没回填：wait 返回 timeout → agent 结束本轮
```

## 分散答复：多个等待点并存

- 每个不同的现状总结 = 一个等待点；面板「等待点总览」把它们并排展示，每张卡
  显示现状、等待状态/倒计时、待领取数。
- 用户点选任一等待点，即可**分别回填**（分散答复）；也可趁 agent 在忙，给几个
  等待点提前排队。
- agent 用对应现状调用 wait 时取走该等待点的任务，互不串。

## 配套命令（弹窗背后同一套，agent 一般不直接用）

```bash
nx-kv sessiontask list                                   # 等待点总览
nx-kv sessiontask add  "<回填内容>" --summary "<现状>"    # 针对现状排队/投递
nx-kv sessiontask get   --id <n> --summary "<现状>"       # 查看单条
nx-kv sessiontask update --id <n> --text "<新内容>" --summary "<现状>"
nx-kv sessiontask remove --id <n> --summary "<现状>"      # 删除
```

常驻面板（`nx-kv serve`）的「实时任务」页就是等待点总览，可直接点选回填；
wait 同样能取走（跨进程由轮询兜底）。

## 先判断你要做哪件事

| 你要做的事 | 读哪份 |
| --- | --- |
| 要在对话里阻塞等用户回填，需要**完整时序、现状 key、排队语义、避坑** | [[sessiontask-workflow]] |
| 只是查命令与返回形状 | 本页即可 |

## 与 nx-kv skill 的分工

- **nx-kv**：操作 KV **后端**上的清单（todo，需登录、按 groupId 隔离）。
- **kv-sessiontask（本 skill）**：**本机**实时人机接力，把用户在浏览器的回填
  变成阻塞工具的返回，现状即 key，不碰后端、不需登录。

两者可同时安装，各管一段，不冲突。

## 安装

```bash
nx-kv skill install kv-sessiontask     # 装到 ~/.claude/skills/kv-sessiontask
nx-kv skill list                        # 列出 nx-kv / kv-sessiontask
```
