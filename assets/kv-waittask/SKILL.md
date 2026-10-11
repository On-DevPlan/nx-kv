---
name: kv-waittask
description: 在一个对话里通过工具调用实时接收任务（本机人机接力），替代在原始输入框打字——agent 完成当前任务、提交结果后，把 nx-kv localtask wait --summary "<当前现状总结>" 作为本轮最后一步强制调用；命令阻塞并自动打开浏览器弹窗，用户在面板看清现状、针对该现状回填后解除阻塞、把新任务作为工具结果返回，agent 继续；队列按工作目录划分，同目录的任务（含别人委托排队的）按序领取；超时未回填则收尾结束本轮。触发词：本地任务、下一条任务、继续给任务、连续提交任务、补充任务、回填任务、现状总结、在网页/弹窗里给任务、阻塞等待、挂起等用户、人机接力、等用户喂任务、localtask wait、localtask（旧称 sessiontask）、kv-waittask。凡是「agent 不结束本轮、靠一个阻塞工具调用等浏览器里继续喂任务」的场景，都走本 skill。反例：要「主动领取排给本目录的委托任务」用 kv-localget；要「把需求打包提交给别的 agent」用 kv-submit；要操作远程 KV 清单（todo）用 nx-kv。
---

# kv-waittask — 对话内本地任务接力（等待侧）

本质是一个循环：**agent 提交结果 → CLI 阻塞 → 用户在 web 看清现状、回填新任务 →
agent 接收并继续**。在一个对话里连续接收任务，不靠原始输入框。

agent 完成当前任务、需要下一条输入时，调用一个**阻塞式**工具
`nx-kv localtask wait`，并带上一句**当前现状总结**；它自动打开浏览器弹窗。
用户在面板/弹窗一眼看到现状，针对该现状回填，阻塞解除、新任务作为工具结果返回，
agent 接着干。如此循环。别人通过 kv-submit / 面板 / CLI 排进**本目录队列**的任务，
wait 也会按序取走。

> 纯本机协调：弹窗由 wait 进程临时起的 http 服务器直出，数据存本机文件
> （`~/.nx-kv/localtasks.json`），**不需要登录 KV 后端**。

## 四条硬规则（最重要）

1. **wait 必须是本轮最后一个动作。** 把它安排在所有分析与工具调用之后（阶段
   结果已经通过正常输出提交）；调用之后不要再安排任何别的工具、输出或推理——
   它会阻塞，直到拿到新任务或超时。
2. **这次工具调用的超时设为 `300000` ms（5 分钟）。** CLI 默认阻塞 180 秒、
   上限 600 秒；5 分钟覆盖默认值并留余量。若显式传了更长的 `--timeout`，
   工具超时要同步放大到比它更大。
3. **wait 必须带 `--summary "<当前现状总结>"`。** 总结写**当前做到哪、卡在哪、
   等用户决定什么**，让用户不读对话也能在面板快速了解现状；它展示在弹窗/面板
   顶部，并作为「本轮完成总结」记录在被取走的任务上。它**只是状态展示**——
   措辞不影响领取顺序，不必刻意保持逐字一致。
4. **返回 `status:"timeout"` 时直接收尾。** 用户在阻塞时限内没回填，就不要再
   追问、不要再次调用 wait，把当前结论交代清楚、结束本轮即可。

## 队列模型（一句话版）

**工作目录即主题，主题拥有一个任务队列。** wait 不传 `--cwd` 时以进程当前目录
（目录名）定位主题；同一目录的所有任务共用一个队列，wait 总是取走其中**最早的
待领取任务**。队列里有任务时 wait 立即返回（不开窗、不阻塞）；队列为空才开窗
阻塞。不同目录 → 不同主题 → 互不串。

## 核心命令

```bash
# 阻塞等待本目录的下一条任务（agent 本轮最后一步；务必加 --json）
nx-kv localtask wait --summary "<当前现状总结>" --json
```

返回形状：

| 返回 | 含义 | agent 怎么做 |
| --- | --- | --- |
| `{status:"ok", queued:true, task}` | 队列里已有**排队任务**（含 kv-submit 委托的） | 直接执行 task |
| `{status:"ok", delivered:true, task}` | 用户在弹窗/面板**实时回填** | 执行 task |
| `{status:"timeout", cwd, summary, timeoutMs}` | 阻塞时限内未收到回填 | 收尾、结束本轮 |

成功结果里带 `cwd` 与 `summary`；`task` 形如
`{id, text, status, createdAt, consumedAt, roundSummary}`，**任务内容在 `task.text`**。

## 一次循环长什么样

```
agent：干活 → 提交阶段结果
       → 最后一步：nx-kv localtask wait --summary "已完成登录，等待选择工作空间" --json
         （队列空 → 阻塞，弹窗/面板顶部显示这句现状）
用户：看清现状 → 回填「选择工作空间 A」→ 提交
agent：工具结果拿到 task.text → 继续干活、提交结果
       → 需要下一条再 wait……（循环）
若阻塞时限内没回填：wait 返回 timeout → agent 结束本轮
```

## 弹窗与常驻面板

- 弹窗顶部「当前现状」显示 wait 传入的现状总结；大输入框 **Enter 提交、
  Shift+Enter 换行**；状态栏倒计时归零即本轮结束；下方是该主题的任务表
  （待领取 / 已领取，可删除）。
- 常驻面板（`nx-kv serve`）的「本地任务」页按主题展示所有目录的队列与现状，
  可直接点选回填；正在阻塞的 wait 通过轮询（约每 0.5 秒）取走，不依赖弹窗本身。
- 弹窗没自动打开时，终端输出里有本次地址（`http://127.0.0.1:<端口>/`），手动
  打开即可；该窗口只在本次 wait 期间有效，wait 结束即关闭。

## 配套命令（队列管理，agent 一般不直接用）

```bash
nx-kv localtask list                                   # 主题总览（各目录、现状、待领取数）
nx-kv localtask add  "<回填内容>" --cwd "<目录>"        # 给某目录的队列排任务
nx-kv localtask get   --id <n> [--cwd "<目录>"]         # 查看单条
nx-kv localtask update --id <n> --text "<新内容>"       # 编辑任务内容
nx-kv localtask remove --id <n> [--cwd "<目录>"]        # 删除单条任务
nx-kv localtask reorder --id <n> --before-id <m>        # 调整待领取优先级（或 --after-id）
nx-kv localtask topic remove --cwd "<工作目录>"          # 删除整个主题（等待中需 --force）
nx-kv localtask topic remove-many --keys "<key,key>"    # 批量删除主题（或 --cwds / --all）
```

> 删除主题：面板「本地任务」页每张主题卡有「删除主题」，勾选后可「批量删除」。
> 等待中的主题默认不删（避免让阻塞的 agent 干等），确认要删会二次提示并以
> `--force` 强删、agent 随后超时收尾。

## 先判断你要做哪件事

| 你要做的事 | 用哪个 |
| --- | --- |
| 干完活，**等用户在浏览器里继续喂下一条** | 本 skill（wait） |
| 主动**领取排给本目录的委托任务**（他人 / 其它 agent 提交的） | kv-localget |
| 把当前对话的需求**打包提交给别的 agent** | kv-submit |
| 操作远程 KV 后端上的清单（todo，需登录） | nx-kv |

要完整时序、返回字段、排队语义与避坑清单，读 [[kv-waittask-workflow]]（按需加载，
只是查命令不必读）。

## 与其它 skill 的分工

- **kv-waittask（本 skill）**：等待侧——阻塞等浏览器回填，人机接力的「等」。
- **kv-localget**：领取侧——主动把排给本目录的任务领走执行，附队列管理。
- **kv-submit**：提交侧——总结上下文、提炼用户需求，委托给别的目录的 agent。
- **nx-kv**：远程 KV 后端的 todo 清单（需登录、按 groupId 隔离）。

三者共享同一份本机任务存储与按目录划分的队列：kv-submit 提交的、面板回填的、
CLI add 排队的，wait / kv-localget 都能取走。可与 nx-kv 同时安装，各管一段。

## 安装

```bash
nx-kv skill install kv-waittask           # 装到 ~/.claude/skills/kv-waittask
nx-kv skill list                        # 列出 nx-kv / kv-waittask / kv-submit / kv-localget
```
