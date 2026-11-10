// 残留 -shm 自愈（#93）：识别 → 只改名留档 → 只重试一次；活进程嫌疑时不插手。
//
// 这条 bug 是 Windows 专属现场（另一进程/上一进程退出后留下 shm，新连接在恢复
// wal-index 时 truncate 失败 → `disk I/O error`），CI 未必能复现同一个系统调用；
// 所以这里钉的是**判定逻辑与改名契约**：认哪些扩展码、什么条件下动手、动完文件
// 变成什么样。真正的打开重试由 openRaw 包着，健康库上必须一次成功、零改名。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isStaleShmError,
  quarantineStaleShm,
  healStaleShmOnce,
  openRaw,
} from '../../src/core/db/driver.js';

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'nxkv-stale-shm-'));
}

/** 造一份「主库在、shm 残留、wal 可指定大小」的现场。 */
function fixture({ walBytes = 0 } = {}) {
  const dir = tmpDir();
  const dbPath = join(dir, 'nxkv.db');
  writeFileSync(dbPath, 'mock-db');
  writeFileSync(`${dbPath}-shm`, Buffer.alloc(32768, 0x5a));
  if (walBytes !== null) writeFileSync(`${dbPath}-wal`, Buffer.alloc(walBytes, 0x00));
  return { dir, dbPath };
}

const staleFiles = (dir) => readdirSync(dir).filter((n) => n.includes('.stale-'));

test('isStaleShmError：认 TRUNCATE / SHMMAP 扩展码，也认裸 disk I/O error', () => {
  assert.equal(isStaleShmError({ errcode: 1546 }), true, '1546 = SQLITE_IOERR_TRUNCATE');
  assert.equal(isStaleShmError({ errcode: 5386 }), true, '5386 = SQLITE_IOERR_SHMMAP');
  assert.equal(isStaleShmError({ message: 'disk I/O error' }), true, '缺扩展码时退回消息');
  assert.equal(isStaleShmError({ errcode: 5, message: 'database is locked' }), false, '有别的扩展码就不是它');
  assert.equal(isStaleShmError({ message: 'unable to open database file' }), false);
});

test('quarantineStaleShm：shm 与 0 字节 wal 都改名留档，内容一个字节不改', () => {
  const { dir, dbPath } = fixture({ walBytes: 0 });
  try {
    const renamed = quarantineStaleShm(dbPath, Date.UTC(2026, 10, 10, 4, 5, 6));
    assert.equal(renamed.length, 2);
    assert.equal(existsSync(`${dbPath}-shm`), false, '原 shm 已让位');
    assert.equal(existsSync(`${dbPath}-wal`), false, '0 字节 wal 一并让位');
    assert.match(renamed[0], /nxkv\.db-shm\.stale-\d{8}-\d{6}$/);
    assert.match(renamed[1], /nxkv\.db-wal\.stale-\d{8}-\d{6}$/);
    assert.deepEqual(readFileSync(renamed[0]), Buffer.alloc(32768, 0x5a), '留档内容原样');
    assert.equal(readFileSync(dbPath, 'utf8'), 'mock-db', '主库不动');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quarantineStaleShm：wal 非空时只动 shm，不碰 wal（可能在途事务）', () => {
  const { dir, dbPath } = fixture({ walBytes: 4096 });
  try {
    const renamed = quarantineStaleShm(dbPath);
    assert.equal(renamed.length, 1);
    assert.equal(existsSync(`${dbPath}-wal`), true, '有内容的 wal 必须留着');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quarantineStaleShm：没有 shm 时是空操作', () => {
  const dir = tmpDir();
  try {
    const dbPath = join(dir, 'nxkv.db');
    writeFileSync(dbPath, 'mock-db');
    assert.deepEqual(quarantineStaleShm(dbPath), []);
    assert.deepEqual(staleFiles(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('healStaleShmOnce：IOERR + shm 在就改名重试（wal 有内容也只动 shm）', () => {
  const { dir, dbPath } = fixture({ walBytes: 0 });
  try {
    assert.equal(healStaleShmOnce(dbPath, { errcode: 1546 })?.length, 2);
    // 已经改过名，没有 shm 了 → 不再动
    assert.equal(healStaleShmOnce(dbPath, { errcode: 1546 }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const hot = fixture({ walBytes: 4096 });
  try {
    const renamed = healStaleShmOnce(hot.dbPath, { errcode: 1546 });
    assert.equal(renamed.length, 1, '只改名 shm，不动有内容的 wal');
    assert.equal(existsSync(`${hot.dbPath}-wal`), true);
  } finally {
    rmSync(hot.dir, { recursive: true, force: true });
  }

  const noShm = tmpDir();
  try {
    const dbPath = join(noShm, 'nxkv.db');
    writeFileSync(dbPath, 'mock-db');
    assert.equal(healStaleShmOnce(dbPath, { errcode: 1546 }), null);
  } finally {
    rmSync(noShm, { recursive: true, force: true });
  }
});

test('健康库上 openRaw 一次成功、不产生任何 .stale 留档', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'nxkv.db');
  try {
    const db = openRaw(dbPath);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    db.run('INSERT INTO t (v) VALUES (?)', ['x']);
    assert.equal(db.scalar('SELECT count(*) FROM t'), 1);
    db.close();
    assert.deepEqual(staleFiles(dir), [], '不该有自愈动作');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('打开失败的错误带路径与 errcode（不再只有裸 disk I/O error）', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'missing-dir', 'nxkv.db');
  try {
    assert.throws(
      () => openRaw(join(dir, 'no-such-file.db'), { readOnly: true }),
      (err) => {
        assert.match(err.message, /库文件不存在/);
        return true;
      }
    );
    // 只读打开一个「目录」当库文件：SQLite 报 unable to open database file，
    // 驱动层必须把它换成带路径与 errcode 的错误。
    assert.throws(
      () => openRaw(dir, { readOnly: true }),
      (err) => {
        assert.match(err.message, /打开库失败/);
        assert.match(err.message, /errcode=/);
        assert.match(err.message, /不会删除任何库文件/);
        assert.equal(err.details.path, dir);
        return true;
      }
    );
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
