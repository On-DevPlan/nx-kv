// plugin 模块的窄连接入口：只复用进程单例，不自己开库。
import { openStore, tx } from '../../../core/db/index.js';
import type { DbApi } from '../../../core/db/driver.js';

export function db(): DbApi {
  return openStore();
}

/** 写事务（IMMEDIATE）：与 localtask / templates 同款单写者纪律。 */
export function txw<T>(fn: (conn: DbApi) => T): T {
  return tx(fn, { db: openStore(), mode: 'IMMEDIATE' }) as T;
}
