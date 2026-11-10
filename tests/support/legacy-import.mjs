// db-migrate-from-json 系列单测的共享助手：夹具导入、路径与哈希。
// 被 tests/unit/db-migrate-from-json-*.test.mjs 共同引用。
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createTestStore } from './test-store.mjs';

export const execFileAsync = promisify(execFile);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BIN = join(ROOT, 'bin', 'cli.mjs');
export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/** 建一个"legacy 数据已就位、库还没建"的 store，然后跑导入。 */
export async function importFixture(name = 'legacy-json') {
  const s = await createTestStore({ open: false });
  s.seedFixtureDir(name);
  s.open();
  return s;
}
