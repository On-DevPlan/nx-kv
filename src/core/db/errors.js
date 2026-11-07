// SQLite / 存储层的错误类型与映射。
//
// 分工（与 core/errors.js 的契约一致）：
//   - **失败**（约束冲突、库锁死、迁移校验不过）→ throw AppError 子类
//   - **业务结果**（已是当前版本、没有 legacy 数据）→ 返回 { status }，不抛
//
// 映射规则（设计文档 §15）：
//   SQLITE_CONSTRAINT_UNIQUE     → conflict()
//   SQLITE_CONSTRAINT_FOREIGNKEY → badInput()
//   触发器 RAISE(ABORT)          → badInput(原消息)  ← 消息是写给用户看的，原样透传
//   SQLITE_BUSY / LOCKED         → badInput('存储忙，请重试')
//
// 不认识的错误一律原样抛出：包一层 `INTERNAL` 会丢掉 errcode，排障时无从下手。
import { AppError, CODES, badInput, conflict } from '../errors.js';

/** SQLite 主错误码（`err.errcode`，不是字符串 `err.code`）。 */
export const SQLITE = {
  ERROR: 1,
  BUSY: 5,
  LOCKED: 6,
  READONLY: 8,
  CONSTRAINT: 19,
  CONSTRAINT_UNIQUE: 2067,
  CONSTRAINT_PRIMARYKEY: 1555,
  CONSTRAINT_FOREIGNKEY: 787,
  CONSTRAINT_TRIGGER: 1811,
};

/** 这个错误是不是「库被别的进程锁着」（可退避重试）。 */
export function isBusyError(err) {
  const code = Number(err && err.errcode);
  if (code === SQLITE.BUSY || code === SQLITE.LOCKED) return true;
  return /database is locked|database table is locked|busy/i.test(String((err && err.message) || ''));
}

/**
 * 这个错误是不是「连接被降级成只读」。
 *
 * 实测场景：两个进程同时首启、其中一个正把库切到 WAL（切换要短暂排它锁）时，
 * 另一个连接的第一次写会拿到 `attempt to write a readonly database`（errcode 8）。
 * **这是瞬时的**——先到的进程提交完之后，重开连接一切正常。所以 bootstrap 会为它
 * 退避重试几次；重试用尽仍然只读，才是真的文件权限问题（照常报错）。
 */
export function isReadOnlyError(err) {
  if (Number(err && err.errcode) === SQLITE.READONLY) return true;
  return /attempt to write a readonly database|readonly database/i.test(String((err && err.message) || ''));
}

/** 这个错误是不是唯一约束 / 主键冲突。 */
export function isUniqueError(err) {
  const code = Number(err && err.errcode);
  if (code === SQLITE.CONSTRAINT_UNIQUE || code === SQLITE.CONSTRAINT_PRIMARYKEY) return true;
  return /UNIQUE constraint failed|PRIMARY KEY must be unique/i.test(String((err && err.message) || ''));
}

/** 这个错误是不是外键约束。 */
export function isForeignKeyError(err) {
  const code = Number(err && err.errcode);
  if (code === SQLITE.CONSTRAINT_FOREIGNKEY) return true;
  return /FOREIGN KEY constraint failed/i.test(String((err && err.message) || ''));
}

/** 这个错误是不是触发器 RAISE(ABORT)（身份不可改那条）。 */
export function isTriggerAbortError(err) {
  const code = Number(err && err.errcode);
  if (code === SQLITE.CONSTRAINT_TRIGGER) return true;
  return /任务身份不可修改|RAISE\(ABORT\)/i.test(String((err && err.message) || ''));
}

/**
 * 把 node:sqlite 抛出的错误映射成业务错误。
 * 认不出来的一律原样返回（保留 errcode / stack，排障需要）。
 */
export function mapSqliteError(err) {
  if (!err) return err;
  if (err instanceof AppError) return err;
  if (isBusyError(err)) {
    // errcode 必须留在**顶层**：tx.js / WAL 切换的重试判据读的是 err.errcode，
    // 塞进 details 会让「可退避重试」退化成「直接失败」。
    const e = badInput('存储忙，请重试', { errcode: err.errcode });
    e.errcode = Number(err.errcode) || SQLITE.BUSY;
    if (err.code) e.sqliteCode = String(err.code);
    return e;
  }
  if (isTriggerAbortError(err)) return badInput(String(err.message || '数据库约束拒绝本次写入'));
  if (isUniqueError(err)) return conflict('记录已存在（唯一约束冲突）', { message: String(err.message || '') });
  if (isForeignKeyError(err)) return badInput('引用的记录不存在（外键约束）', { message: String(err.message || '') });
  return err;
}

/**
 * 迁移失败（整体回滚、JSON 一字节不动、退出码 2）。
 *
 * `details.logPath` 必须给出：用户要能自己去 diff 失败明细，而不是只看到
 * 「迁移失败」四个字。
 */
export class StoreMigrationError extends AppError {
  constructor(message, details) {
    super(CODES.STORE_MIGRATION_FAILED, message, details);
    this.name = 'StoreMigrationError';
  }
}

/**
 * 库比程序新（`user_version > CURRENT`）：**绝不降级写**。
 * 降级写的后果是新版本写过的列被旧代码当垃圾覆盖，而且不报错。
 */
export class StoreTooNewError extends AppError {
  constructor(found, current) {
    super(
      CODES.CONFLICT,
      `存储版本 ${found} 比当前程序支持的 ${current} 新，请升级 nx-kv（本次不做任何写入）`,
      { found, current }
    );
    this.name = 'StoreTooNewError';
  }
}

/**
 * 有表但没有 `meta.store_kind`：这不是 nx-kv 的存储文件（典型场景：用户把别的
 * SQLite 文件改名成 nxkv.db）。
 *
 * **绝不自动建表 / 自动认领** —— 那会把别人的库就地改成我们的结构。
 */
export class NotNxKvStoreError extends AppError {
  constructor(path) {
    super(
      CODES.CONFLICT,
      `这不是 nx-kv 的存储文件（缺 meta.store_kind）: ${path}\n` +
        '请改用 NX_KV_DB 指定别的路径，或先把它移开再重试（不会自动建表）。',
      { path }
    );
    this.name = 'NotNxKvStoreError';
  }
}

/** `db migrate --dry-run` 的收尾信号：事务回滚，但**不是**失败。 */
export class DryRunRollback extends Error {
  constructor(value) {
    super('dry-run：事务已回滚');
    this.name = 'DryRunRollback';
    this.value = value;
  }
}
