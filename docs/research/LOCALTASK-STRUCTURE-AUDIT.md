# localtask 结构审计（只读）

审计对象：`src/modules/localtask/{service.js,index.js,view.jsx,board.js}`、
`src/modules/timegoal/`、`src/runtime/{spec.js,cli.js,api.js}`、`src/web/frontend/App.jsx`。
方法：通读源码 + 三条只读 CLI 调用（`presence` / `events` / `reorder --before-id`）。
行号以审计当时为准（后续改动会漂移，**以函数名为准**）。

## 模块地图

| 文件 | 职责 | 行区间（当时） |
| --- | --- | --- |
| `service.js`（~1467 行） | 全部后端语义 | 1-27 契约注释｜28-43 常量｜45-62 收尾追加语｜64-81 全局主题｜83-98 store 路径｜100-124 **寻址**｜126-160 归一化｜162-271 **存储**｜273-315 topic/task 模型｜317-369 **等待判据**｜371-427 进程内 waiter｜429-508 等待生命周期｜510-620 settings/目录登记/总览/prune｜622-760 **CRUD**｜762-839 主题删除｜841-888 调序｜890-1089 **`waitForTask`**｜1091-1156 观测｜1158-1284 主面板编排｜1286-1426 事件流 |
| `index.js` | 15 条 action = CLI + HTTP + 渲染器 | 16-19 flag｜24-91 渲染器｜102-334 actions |
| `view.jsx`（~1425 行） | 看板 + 队列 + 设置 + timegoal 编辑器 | 141-158 拉取｜176-196 轮询/SSE｜398-448 投递目标｜461-533 删除｜567-618 队列与调序｜675-815 看板表｜865-1111 队列表｜1145-1212 设置 |
| `board.js` | 纯视图模型（全局池占位 + localtask/timegoal 合并） | 10-11 全局常量｜17-37 占位｜40-54 补全局行｜56-95 合并 |
| `timegoal/service.js` | 独立 store，**复制**了 localtask 的寻址算法 | 47-75 `stampNow/topicKeyFor/normalizeCwd` |

## 发现

1. **P0 · 主题按「目录名」而非路径认** —— `service.js:121-124` 只哈希 `basename`。
   用户症状：面板按路径显示目录，用户以为锁定了某路径；两个同名目录共用一个队列。
2. **P0 · wait 深链打不开对页面、也不选中主题** —— `service.js:1244-1246` 生成
   `#/localtask?key=…&cwd=…`，而 `App.jsx:9-12` 的 `viewFromHash()` 把**整条 hash**
   （含 query）拿去比视图 id，必然不匹配 → 回到持久化的上次视图。
   连锁：面板不在 localtask 页 → 不建 SSE → `panelPresence` 恒 0 → 反复开页。
3. **P0 · 整店 read-modify-write，跨进程丢更新** —— `service.js:248-271` 的 `saveQueue`
   只串行化「写」，不串行化「读-改-写」整体。wait 进程的 `consumeFirstPending`、
   `clearWaiting`、`setWaiting` 与面板进程的 `addTask` 各自覆盖整文件。
   面板已提示「已排入队列」，任务却被 wait 的旧快照抹掉。
4. **P1 · CLI `localtask events` 必崩** —— `index.js:332` 摸 `ctx.__raw.req`，
   而 `__raw` 只在 HTTP 传输下注入（`runtime/api.js:100-104`），CLI 走 `runtime/cli.js:344-345`。
   实测 → `Cannot read properties of undefined (reading 'req')`，exit 1。
5. **P1 · CLI `localtask presence` 恒为 0** —— `panelPresence()` 统计本进程 `sseConns`，
   只有 serve 进程才有连接。
6. **P1 · reorder 的帮助文案与真实 flag 不同名** —— `index.js:251` 写 `--before-id`，
   真实 flag 是 `beforeId`/`afterId`（`:254-255`）。实测 `--before-id` → 「未知参数」。
7. **P1 · 面板把待领取队列倒序显示，CLI 按领取序** —— `view.jsx:567` 的
   `active.tasks.slice().reverse()`，而 `view.jsx:572` 的 `pendingOrder` 是正序。
   用户症状：面板最上面一行其实**最后**才被领；点「提前」后该行反而下移。
8. **P1 · 「现状」有两个写入者、一个字段** —— `service.js:448`（wait 写 agent 现状）与
   `service.js:669`（add 用提交方 `--summary` 覆盖同一字段 `t.summary`）。
9. **P1 · `--key` 与 `--cwd` 同给时静默以 key 为准** —— `service.js:623-626` 与 `765-768`
   （两份重复实现）：`if (rawKey) return key;` → 改错 key 就动到别的目录的队列。
10. **P2 · 删除语义有四套** —— 删任务（不管等待中）、删主题（等待中需 `--force`）、
    批量（等待中跳过 + 全局受保护）、`prune`（再跳过 manual）。面板只暴露两套。
11. **P2 · 面板超时下拉只有 6 档，CLI 接受 1-600** —— `view.jsx:1150-1162` vs
    `service.js:599-620` → `--timeout 90` 后面板 select 的 value 无对应 option → 空白下拉。
12. **P2 · 面板永远有「全局池」行，CLI 没有** —— `service.js:546-548` vs `board.js:40-54`
    → 两层的「主题数」对不上。
13. **P2 · 同名目录合并后 `cwd` 被后来者覆盖** —— `service.js:291` `if (cwd) t.cwd = cwd;`
    → 面板显示的路径、投递用的路径，都可能是另一个同名目录的。
14. **P2 · 面板硬编码后端常量与时间格式** —— `view.jsx:311` 复制 timegoal 时长上限；
    时间戳解析三份（`view.jsx:14`、`view.jsx:60`、`service.js:1109`、`timegoal/service.js:55`）；
    `board.js:10-11` 复制 `GLOBAL_KEY`。
15. **P2 · wait 结果的 `delivered`/`queued` 在三条唤醒路径里语义不一致** —— 早退路径
    `queued:true`；跨进程轮询路径 `delivered:false` 但 `queued:false` → `index.js:63`
    把它渲染成「实时回填」，其实是 500ms 轮询捡走的。

## 寻址规则

| 命令 | 目标如何解析 | 用户搞错时 |
| --- | --- | --- |
| `localtask list` | 全部主题 + settings | — |
| `get/update/remove/reorder` | `--key` 优先，否则 `--cwd`→目录名哈希 | key 写错 → 静默改到别的目录的队列 |
| `add` | `--cwd`→目录名哈希；`--global` 时 cwd 被忽略 | 同名目录 → 投错；`--global+--cwd` → cwd 静默失效 |
| `wait` | 只认 `--cwd`（默认进程 cwd） | 等的是别的队列；且**永远**兜底领全局 |
| `cancel` | `--key` 优先，否则 `--cwd` | 错的 key → 关掉别人的等待 |
| `topic add` | `--cwd` 必填 | 相对路径按**服务端进程**的 cwd 解析 |
| `topic remove / remove-many` | key 或 cwds；`--all` 含全局但受保护 | 跳过项只在「跳过」清单里 |
| `presence` | 读本进程 SSE 表 | CLI 侧恒 0 |
| `events` | cwd 或 key 过滤 | CLI 走不通 |
| 面板（HTTP） | 目录行用 `cwd`、全局行用 `key` | 面板永不用 key 寻址本地目录 → 同名目录合并成一行 |

## 漂移风险

1. 队列顺序：面板倒序 vs CLI 正序。
2. 全局池是否存在：面板有 vs CLI 无。
3. `delivered`/`queued` 组合在三路径下不一致。
4. 「现状」两写一存。
5. 超时值域：面板 6 档 vs CLI 1-600。
6. 面板投递目标与 CLI `--cwd/--global` 是两套入口，落到同一队列但显示的目录名可能不同。
7. `presence` 在 HTTP 有效、CLI 恒 0。
8. 深链选中能力：CHANGELOG 承诺 vs 现状无解析。
9. `localtask.get` 的 HTTP 路由无面板消费者（CLI-only 读路径）。

## 死代码清单

| 符号 | 位置 | 状态 |
| --- | --- | --- |
| `getSettings` | `service.js:561` | 无 CLI/HTTP/面板消费者；仅测试用 |
| `DEFAULT_TIMEOUT_MS` | `service.js:38` | 全仓无消费者；与 `DEFAULT_TIMEOUT_SEC:40` 重复表达同一时长 |
| `normalizeSummary`（导出） | `service.js:129` | 仅模块内使用 |
| `MAX_SUMMARY`/`MAX_TIMEOUT_SEC`/`clampTimeoutSec`/`GLOBAL_CWD` | `service.js:42,41,173,77` | 导出但无外部消费者（内部在用） |
| `deadlineMsOf` | `service.js:319` | 外部仅出现在测试注释 |
| `consumeFirstPending` | `service.js:417` | 外部仅测试 |
| `topicKeyFor` | `service.js:121` | 外部仅测试；timegoal 自带复制版 —— 两份实现必须永远一致 |
| `waiters.get(GLOBAL_KEY)` 分支 | `service.js:677-684` | 死路径：wait 的 key 永远是 16 位 hex |
| `topicView().cancelRequested` | `service.js:363` | 透出到视图模型但面板不读 |
| `board.js` 的 `GLOBAL_KEY`/`GLOBAL_NAME` | `board.js:10-11` | 与 `service.js:75-76` 是两份真值 |
| `prune` 的 `--all-finished`/`--dry-run` | `index.js:236-238` | 面板无入口，仅 CLI |
| `wait` 的 `--no-open` | `index.js:284` | 仅测试/CI 语义 |
| `localtask.presence` 的 CLI 形态 | `index.js:313-318` | 恒返回 0 |

## 建议的收敛方向

1. **寻址单一化**：cwd 为唯一真源，key 降级为派生别名（需保留旧 key 回退查找，否则老 store 的历史队列会"消失"）。
2. **删除模型统一**：一个删除入口 + `scope=task|topic|all` + 单一 force 语义
   （保留旧命令为别名，flags 不动）。
3. **等待态单一真源**：store 字段为真相，进程内表只做唤醒加速
   （`{status:'timeout', cancelled:true}` 已被 agent 依赖，只能新增字段不能改语义）。
4. **渲染同源**：CLI / `--json` / 面板 / `CliHints` 共用渲染，一次渲染两端一致
   （人读输出文本属既有契约，只能改文案不可删字段；`--json` 载荷形状必须逐字保持）。
5. **并发写收敛**：单主题文件或带 `rev` 的乐观锁重试（**风险最高**：改 store schema
   违背向后兼容承诺，若要做须保留 v4 读路径并双写过渡）。

## 未验证 / 风险

- 本审计是纯静态阅读 + 3 条只读 CLI 调用；丢更新窗口（F3）**未做并发压测复现**。
- 深链落点（F2）未实际开浏览器验证，仅依据 `App.jsx:9-12` 的 hash 匹配逻辑与构建产物。
