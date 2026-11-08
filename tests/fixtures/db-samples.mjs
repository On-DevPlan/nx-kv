// 版本样本库构造脚本（v1 最小样本）。
//
// 目的：给「任意历史版本 → 当前版本」的迁移留一份**可重复构造**的样本，
// 不把二进制 .db 提交进仓库（换机器/换 SQLite 版本都能重建）。
//
// 样本覆盖真实迁移里最容易出错的几处：
//   · 正文里同一个 fileId 出现两次（应合并成 1 条关系）；
//   · 正文里有外部 URL（迁成 kind=url 资源）；
//   · manifest 台账里有一条正文没引用的文件（应成为无关系孤儿，而不是被乱挂）；
//   · 正文里有 nxkv://task 内部引用（迁成 kind=task 资源）；
//   · docs 树有一篇 md（迁成 refs + ref_attach 可查）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSchemaSql } from '../../src/core/db/migrator.js';

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');

export const SAMPLE = {
  repoKey: 'github.com/acme/sample',
  topicKey: 'topic-sample',
  fileId: 'a'.repeat(32),
  orphanId: 'b'.repeat(32),
  url: 'https://example.com/spec',
  docRel: 'repo/github.com/acme/sample/docs/sample.md',
};

/**
 * 在临时 store 上构造一个 v1 库（不经过 bootstrap）。
 * @param {object} store createTestStore({ open:false }) 的句柄
 * @param {object} [sample] 覆盖 SAMPLE 里的值
 */
export function buildV1Sample(store, sample = SAMPLE) {
  const at = Date.UTC(2026, 10, 7, 8, 0, 0);
  const db = store.core.openRaw(store.dbPath);
  db.exec(readSchemaSql('v1.sql'));

  db.run(
    `INSERT INTO repos (key, type, name, description, path, remote, sort_order, ext, state, version, deleted_at, created_at, updated_at)
     VALUES (:key, 'repo', 'sample', '', 'd:/sample', '', 0, '{}', '', 0, NULL, :at, :at)`,
    { key: sample.repoKey, at }
  );
  db.run(
    `INSERT INTO topics (key, repo_key, cwd, group_key, name, next_seq, ext, state, version, deleted_at, created_at, updated_at)
     VALUES (:key, :repo, 'd:/sample', NULL, 'sample', 3, '{}', '', 0, NULL, :at, :at)`,
    { key: sample.topicKey, repo: sample.repoKey, at }
  );
  const topicId = db.get('SELECT id FROM topics WHERE key = :k', { k: sample.topicKey }).id;

  const body1 = [
    `季度报表 ![报表.pdf](${sample.fileId})`,
    `再贴一次 ![报表备份](${sample.fileId})`,
    `参考资料 [规格](${sample.url})`,
  ].join('\n');
  db.run(
    `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at, from_src,
                        blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at)
     VALUES (:tid, 1, '', 'done', 0, :body, '{}', '完成', :at, 'panel', 0, :at, :at, 1, NULL, :at, :at)`,
    { tid: topicId, body: body1, at }
  );
  const t1 = db.get('SELECT id FROM tasks WHERE topic_id = :tid AND seq = 1', { tid: topicId }).id;

  const body2 = `看这条 [任务 #1](nxkv://task/${t1})`;
  db.run(
    `INSERT INTO tasks (topic_id, seq, type, status, version, body, ext, feedback, feedback_at, from_src,
                        blocks_following, claimed_at, done_at, round, deleted_at, created_at, updated_at)
     VALUES (:tid, 2, '', 'pending', 0, :body, '{}', '', NULL, 'panel', 0, NULL, NULL, 1, NULL, :at, :at)`,
    { tid: topicId, body: body2, at }
  );

  // 文档树里的 md 在 v1 就登记进 refs（真实库的写法）
  db.run(
    `INSERT INTO refs (id, type, locator, state, version, deleted_at, created_at, updated_at)
     VALUES (:id, 'md', :locator, '', 0, NULL, :at, :at)`,
    { id: 'ref_' + sha1(sample.docRel).slice(0, 16), locator: sample.docRel, at }
  );

  db.run("INSERT INTO settings (key, value, updated_at) VALUES ('app.autoSyncAttachments', 'false', :at)", { at });
  db.exec('PRAGMA user_version = 1');
  db.run("INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '1', :at)", { at });
  // bootstrap 的有表分支要求 store_kind 存在且等于 sqlite（否则按"别人的库"拒绝）
  db.run("INSERT INTO meta (key, value, updated_at) VALUES ('store_kind', 'sqlite', :at)", { at });
  store.core.closeDb();

  // manifest.json 台账：1 条正文引用 + 1 条被手删正文行的孤儿
  const manifestDir = join(store.appDir, 'attachments', 'local');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, 'manifest.json'),
    JSON.stringify(
      {
        dir: manifestDir,
        groupId: 0,
        files: {
          [sample.fileId]: { name: '报表.pdf', contentType: 'application/pdf', size: 12, syncedAt: at },
          [sample.orphanId]: { name: '孤儿.txt', contentType: 'text/plain', size: 5, syncedAt: at },
        },
      },
      null,
      2
    ),
    'utf8'
  );
  // 台账里指向的字节也造出来（迁移后的 local_path 必须是可读的真实文件）
  writeFileSync(join(manifestDir, '报表.pdf'), 'PDF-SAMPLE!!', 'utf8');
  writeFileSync(join(manifestDir, '孤儿.txt'), 'abcde', 'utf8');
  // docs 树：迁移会扫描并登记 refs + 引用关系
  store.seedDocs({ [sample.docRel]: '# sample\n\n[链接](https://example.com/spec)\n' });
  return { topicId, taskId: t1, sample };
}
