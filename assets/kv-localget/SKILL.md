---
name: kv-localget
description: 领取排给本工作目录的本地任务——别人通过 kv-submit 委托的、用户在面板/弹窗排队的，都落在「目录名即主题」的队列里；agent 在自己目录里用 nx-kv localtask list 查看待领取，用 wait（队列非空时立即返回、不阻塞）按序取走执行，附单条查看/编辑/删除/调序等队列管理。触发词：领取本地任务、看看有没有排给我的任务、本地队列、领取委托任务、拿任务、本目录的任务、排队任务、localtask list、kv-localget。凡「主动获取排给本目录的任务」的场景都走本 skill。反例：干完活等用户在浏览器回填下一条用 kv-waittask；把需求提交/委托给别的目录用 kv-submit；操作远程 KV 清单（todo）用 nx-kv。
---
# kv-localget — 领取本目录的本地任务（领取侧）

任务队列按**工作目录**划分（目录名即主题）：kv-submit 委托的、用户在面板/弹窗
排队的，都进各自目录的队列。你在哪个目录工作，就领哪个目录的队列——不传
`--cwd` 时命令自动按进程当前目录定位。数据在本机文件（`~/.nx-kv/localtasks.json`），
**不需登录**。

## 领取流程

```bash
# 1. 看总览：找到自己目录的主题，看待领取数（pending）与现状
nx-kv localtask list --json
# → {topics:[{key,cwd,name,summary,waiting,pending,total,tasks:[...]}], waiting, settings}

# 2. 有待领取 → 取走最早的一条（队列非空时 wait 立即返回，不开窗不阻塞）
nx-kv localtask wait --summary "<本轮现状，如：空闲，领取新任务>" --timeout 30 --json
# → {status:"ok", queued:true, task:{id,text,...}}

# 3. 执行 task.text（内容永远读 task.text，id 只是编号），产出落在本目录
```

- `queued:true` = 从队列取到任务，直接执行。
- `{status:"timeout"}`（exit 0，不是错误）= 时限内没有新任务：想继续等就再
  wait（挂起等待，期间别人提交的会立刻送达），不想等就收工。
- `--timeout <秒>`：阻塞上限（缺省用页面配置 180 秒，最大 600）；「查完就走」
  用短超时，「挂着等活」用长超时。

## 队列管理（需要时）

```bash
nx-kv localtask get    --id <n>                        # 查看单条
nx-kv localtask update --id <n> --text "<新内容>"       # 改写任务内容
nx-kv localtask remove --id <n>                        # 删除单条
nx-kv localtask reorder --id <n> --before-id <m>       # 调整领取顺序（或 --after-id）
nx-kv localtask topic remove --cwd "<目录>"             # 删除整个主题（等待中需 --force）
```

以上都不传 `--cwd` 时同样按进程当前目录定位。

## 硬规则

1. **内容读 `task.text`**，`task.id` 只是编号；领取顺序 = 队列里待领取任务的
   先后（可用 reorder 校正）。
2. **同一目录同一时刻只挂一个 wait**——两个 wait 抢同一队列，只有一个拿得到。
3. **timeout 是业务结果**（exit 0）：按「暂时没活」处理，不要当错误重试。
4. **确认目录对不对**：`list` 里自己主题的 `cwd` 与你工作的目录一致才领取；
   跨目录代领需显式 `--cwd "<目标目录>"`（目录名相同即同一队列）。

## 什么时候不用

| 场景                                                     | 用哪个      |
| -------------------------------------------------------- | ----------- |
| 你干完活、**等用户在浏览器回填**下一条（人机接力） | kv-waittask |
| 把这个对话的需求**提交/委托**给别的目录的 agent    | kv-submit   |
| 操作远程 KV 后端的 todo 清单（需登录、按 groupId 隔离）  | nx-kv       |

wait / kv-localget 共用同一个队列与同一条取数命令（`wait`）：区别只在意图——
kv-waittask 把 wait 当「本轮最后一步等人接力」，kv-localget 把 wait 当「领活」。

## 安装

```bash
nx-kv skill install kv-localget          # 装到 ~/.claude/skills/kv-localget
nx-kv skill list                       # 列出 nx-kv / kv-waittask / kv-submit / kv-localget
```
