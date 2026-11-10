# 决策：残留 `-shm` 的打开自愈（只改名、重试一次）

- date: 2026-11-10
- status: accepted
- schema: 无变更（只动打开路径与错误文案）
- producers: `src/core/db/driver.js`（`isStaleShmError` / `quarantineStaleShm` / `healStaleShmOnce` / `decorateOpenError`）
- consumers: `src/core/db/bootstrap.js`（`openRaw` 的唯一上层）、一切「serve 在跑时 CLI 打不开库」的现场

## 背景

Windows 实测：上一个进程（多为 `serve` / 一条刚退出的 CLI）没走 `sqlite3_close` 就结束时，
库目录里会留下 `nxkv.db-shm`（`nxkv.db-wal` 常为 0 字节）。之后任何新进程以读写方式打开，
SQLite 在恢复 wal-index 时要 truncate 这个 shm，却拿到 `disk I/O error`：

- 扩展码 `1546` = `SQLITE_IOERR_TRUNCATE`（偶发 `5386` = `SQLITE_IOERR_SHMMAP`）；
- 库本身、WAL 内容都是好的：只读校验 `integrity_check` / `quick_check` 通过，
  把 shm 改名（不删）后**立刻**能正常打开、写入、`localtask get` / `done` 全部可用。

用户的硬约束：**不静默删除任何库文件**，改名留档；不要无限重试；错误要能指路。

## 决策

1. **在驱动层（`openRaw`）自愈，而不是让每个命令各自处理**：打开 = 构造连接 +
   设连接级 PRAGMA（`busy_timeout` / `foreign_keys` / `synchronous` / `journal_mode=WAL`），
   这整段放进 `openOnce()`；失败时先**关掉半成品连接**（Windows 不允许 rename 仍有映射的 shm）。
2. **判定条件收窄**，避免误伤正常库：
   - 错误是 `1546` / `5386`（无扩展码时退回消息 `disk I/O error`）；
   - 同目录确实存在 `-shm`；
   - **rename 即活性探针**：Windows 不允许改名仍被其他进程映射的文件；活进程
     （serve / 另一条 CLI）持有时会 `EBUSY`，此处视为「不是残留、有人在用」→ 不动手，
     直接抛出带指引的错误。
3. **只改名、不删除**：`-shm` 与 **0 字节** `-wal` 改名为 `<file>.stale-<YYYYMMDD-HHmmss>`；
   `-wal` 有内容时一个字节都不碰（里面可能有未 checkpoint 的已提交事务），
   新连接会按 WAL 自行恢复。主库 `nxkv.db` 永不改名、永不删除。
4. **只重试一次**：第二次仍失败 → 抛出带路径、errcode、处置建议的错误
   （`StoreOpenError`，保留 `errcode` 供上层重试判据使用），不再循环。
5. **只对读写打开自愈**：`readOnly` 连接（`db status` 这类）不做改名副作用；
   它失败时同样能拿到带路径 / errcode 的清晰错误。
6. **顺带修 `unable to open database file` 的上下文**：所有打开失败都经
   `decorateOpenError` 追加 `路径 + errcode + 建议`（目录不可写 / 被占用 / 盘符不存在），
   原始消息不吞。

## 影响

- 现场：`serve` 已退出、库目录留了 shm / 非空 wal → 下一条 CLI 会自动改名 shm 并成功打开，
  用户不再需要手工处理；留档的 `.stale-*` 可以随时人工删除（程序不删）。
- 现场：`serve` 正在运行（shm 被映射）→ rename 失败，CLI 得到明确错误，并提示改用
  `POST /api/localtasks/claim`（0.44.2 起可用）或先停 serve；不会破坏 serve。
- 排障：`disk I/O error` 不再裸奔——错误里能看到库路径、扩展码与「改名留档」事实。
- 单测：`tests/unit/db-stale-shm.test.mjs` 钉住判定码、改名契约（含 0 字节 wal 与非空
  wal 的分支）、健康库零副作用、错误装饰。

## 不做

- 不删除任何 `-shm` / `-wal` / `.stale-*`（留档给人判断）；
- 不在 `-wal` 非空时改名（并发安全优先）；
- 不做「无限重试 / 退避轮询」掩盖真实占用；
- 不改 SQLite 的 journal 模式，也不引入第三方 SQLite 绑定。
