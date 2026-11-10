---
name: kv-get
description: 领取与完成排给本工作目录的本地任务（别人通过 kv-submit 委托的、用户排队的，都落在按「完整 cwd + 项目组」派生的主题里）——用 localtask get 取活（默认直接领；项目开启「持续 get」后自动阻塞等人回填）、localtask wait 挂着等人接力、localtask done 标记完成（带时间目标的任务未到点会被拒绝，提示派 sub agent 重提需求）、localtask reopen **就地重开原任务**（历史进 history 链，已完成则回到待领取）。触发词：领取本地任务、看看有没有排给我的任务、本地队列、领取委托任务、拿任务、本目录的任务、排队任务、localtask get、localtask wait、标记完成、任务完成、修改反馈、重新执行、kv-get。凡「主动获取排给本目录的任务」以及「把任务标记完成/按反馈重开」的场景都走本 skill。反例：把需求提交/委托给别的目录用 kv-submit；查本机仓库/项目组与参考仓库用 kv-repo；操作远程 KV 清单（todo）用 nx-kv。
---

# kv-get — 领取、执行、完成（领取侧）

一个 skill 覆盖本机任务的**完整生命周期**：领 → 干 → 标完成 → 按反馈重开。
细节拆在 references 里，按需读：

- [[localget]] — 领取侧：队列管理、单条查看/编辑/删除/调序
- [[waitloop]] — 等待侧契约：wait 是本轮最后一步，唯一合法出口是 timeout
- [[timegoal]] — 时间目标：目录级与**任务级**（领取即计时）的 check 门禁
- [[wait-workflow]] / [[timegoal-workflow]] — 两套循环的细则

## 三个动作，三种语义（别混用）

| 动作 | 命令 | 语义 |
| --- | --- | --- |
| **领活** | `nx-kv localtask get --json` | 队列有任务**立即领走**；没有就**立即返回 timeout**（不阻塞、不开窗）——「暂时没活」是正常业务结果 |
| **等人** | `nx-kv localtask wait --timeout 30 --json` | 阻塞等人回填；**本轮最后一步**，唯一合法出口是 timeout |
| **挂着领** | 同上，但项目开启了「持续 get」 | `get` 升级为 waitgoal：无任务时**阻塞等待**项目配置的分钟数，期间用户回填就直接领到；领到的交付文本自带「继续 get 直到超时」的项目模板 |

「持续 get」是**项目级**开关（`repo update --get-loop on` 开启），默认关闭——默认就是「直接 get」。

## 领取到的东西必须读全

```bash
nx-kv localtask get --json
# → { status:"ok", task:{id,text,...}, instruction:"…" }
```

- `task.text` = 任务正文（Markdown），**永远读它**；
- `instruction` = 服务端渲染的指令段，**有则必读**（与 task.text 一起构成这一轮的根指令）：
  - **项目组上下文**（领的是组内仓库时）：组定位、组介绍、本项目在组里的位置、兄弟成员的角色、项目组绑定文档（`group.docs` / `repo.docs`）的**可读路径**——这些路径是磁盘上的真实文件，需要细节就直接读；
  - **ack 完成总结**（默认「完成后调用 `localtask done --summary` 回填结果」，可在
    面板「设置 → 提示词模板 → ack」里改；这是完成指令与收尾要求的唯一出口）；
  - **附件识别**（任务带附件时）；
  - **任务级时间目标的 check 指令**（见下）。

## 时间目标：领取即计时，未到点不许标完成

发布方可以给单条任务带时长（`localtask add … --duration 2h`）。这种任务被领取时
**自动起表**，交付文本里带一条固定指令：

```bash
nx-kv timegoal check --task task:<topicKey>:<taskId> --summary "<本轮现状>"
```

每轮推进先跑一次 check（它会原文回显时间目标提示词，防长对话漂移）。
**时间未到不能标完成**——`localtask done` 会返回业务结果（不是错误）：

```json
{ "status": "blocked", "reason": "goal_not_reached", "remainingSec": 1830,
  "hint": "时间未到，不能标记完成——请派出 sub agent 重新提出新的需求；到点后…再来标完成" }
```

此时**不要**硬标完成、也不要自己改时间：按提示**派 sub agent 重新提出新的需求**，
再继续推进；到点（check 返回 `reached:true`）后再 `done`：

```bash
nx-kv localtask done --id <n> --summary "<完成总结>" --json
```

没有时间目标的任务直接 done 即可。目录级 timegoal（`timegoal set --cwd …`）是另一回事：
它是「这个目录整体要跑多久」的预算，见 [[timegoal]]。

## 完成与反馈：闭环的两端

```bash
# 标记完成（完成总结必填——它就是下一轮 agent 能看到的「上轮做了什么」）
nx-kv localtask done --id <n> --summary "<完成总结>"

# 用户看了结果提修改意见 → **就地重开原任务**（同号回写，旧态压进 history）
nx-kv localtask reopen --id <n> [--text "<改后的正文（Markdown）>"] [--kind reopen|comment] --json

# 查任务链：同任务 history 节点（origin/reopen/comment/current）+ 旧 forkOf 派生（若有）
nx-kv localtask chain --id <n> --json
```

`reopen` **回写同一条任务**：正文 = `--text`；上一轮完成总结等压进 `history[]`。
若任务已完成（有 `completedAt`），清领取/完成标记并回到 `pending` 等待再领；
未完成则只改正文 + 记链。面板的验收重做与划选评论共用这一入口（可带附件）。

## 硬规则

1. **同一个目录同一时刻只挂一个 wait**（waiters 是进程内注册表，一个 key 只能有一个）。
2. **timeout 是业务结果，不是错误**（exit 0）：按「暂时没活」收尾，**不要**当失败重试。
3. **wait 是本轮最后一步**：拿到任务或超时之前，不要提前结束本轮。
4. **instruction 有则必读**：里面的组上下文/时间目标/收尾要求都是硬约束。
5. **带时间目标的任务不许提前标完成**——被拒绝就按提示派 sub agent 重提需求。
6. **同一时刻只挂一个 wait**；`get` 与 `wait` 不要并发跑（都在同一队列上抢任务）。

## 队列管理（需要时）

```bash
nx-kv localtask list --json                # 全部主题：目录、现状、等待中、待领取数
nx-kv localtask show   --id <n> --json      # 查看单条（get 已是「领取」动词）
nx-kv localtask update --id <n> --text "<新内容>" --json   # 改正文；--duration 2h 设时间目标、--clear-goal 清除（仅未领取时可改）
nx-kv localtask remove --id <n> --json      # 软删除（CLI restore 可恢复）
nx-kv localtask reorder --id <n> --before-id <m> --json
nx-kv localtask topic remove --cwd "<目录>" # 删整个主题（等待中需 --force）
```

以上都不传 `--cwd` 时按进程当前目录定位。
