// #137 · 新建任务模板只保留一条内置「ref 生成」，其余内置下线。
//
// 要守住三件事：
//   1. 新库：newtask 类目只有一条内置，且它是默认（用户的「新建任务」拿到的是它）；
//   2. 老库：旧的空骨架内置（default / bugfix / feature / research / doc）被**软删**
//      （下线，不是硬删 —— 用户自己复制出来的条目 builtin=0，不受影响）；
//   3. 内置正文就是那份「零知识起步 SOP」：agent 照着能走完
//      「摸清仓库 → 建 ref → 写问答 → 挂文档列表 → done」。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from '../support/test-store.mjs';
import { getDb } from '../../src/core/db/index.js';
import { seedBuiltinTemplates, RETIRED_BUILTIN_TEMPLATE_IDS } from '../../src/core/db/seed-templates.js';

beforeEach(async () => {
  await createTestStore();   // 临时库夹具：库路径必须在系统临时目录里
});

test('#137 新库：newtask 只有一条内置「ref 生成」，且它是默认', () => {
  const rows = getDb().all(
    `SELECT id, name, is_default, builtin, body FROM templates
      WHERE category = 'newtask' AND deleted_at IS NULL ORDER BY sort_order`,
  );
  assert.equal(rows.length, 1, '只保留一条内置任务模板');
  assert.equal(rows[0].id, 'newtask.ref');
  assert.equal(rows[0].name, 'ref 生成');
  assert.equal(rows[0].builtin, 1);
  assert.equal(rows[0].is_default, 1, '它是默认模板');
});

test('#137/#195 内置正文 = 零知识起步 SOP：五步 + 关键命令都在', () => {
  const row = getDb().get(
    `SELECT body FROM templates WHERE id = 'newtask.ref' AND deleted_at IS NULL`,
  );
  const body = String(row?.body || '');
  for (const must of [
    'nx-kv repo list --json',
    'nx-kv docs list --json',
    'nx-kv docs get --ref',
    'nx-kv docs ref add --owner repo --repo',
    'nx-kv docs set --ref <refId> --body-file',
    'nx-kv localtask done --id <id> --cwd',
  ]) {
    assert.ok(body.includes(must), `内置正文里少了：${must}`);
  }
  assert.ok(body.includes('## 本轮问题'), '要留出用户写问题的地方');
  assert.ok(body.includes('body-file'), '长文本走文件（不受命令行长度限制）');
  assert.ok(body.includes('--desc "<一句话短描述>"'), '必须要求给 desc（列表里的定位标签）');
  assert.ok(body.includes('# <标题>'), '必须要求正文首行是标题（# 标题）');
});

test('#195 内置正文：先判任务来源（board/boardMark）再绑对应宿主，避免绑到主篇', () => {
  const row = getDb().get(
    `SELECT body FROM templates WHERE id = 'newtask.ref' AND deleted_at IS NULL`,
  );
  const body = String(row?.body || '');
  // 判来源：frontmatter 的 board / show --json 的 boardMark，且警告不要用 __unbound__
  assert.match(body, /boardMark/, '要告诉 agent 用 boardMark 判来源');
  assert.match(body, /__unbound__/, '要警告 topic.repo_key 是哨兵、不能用来判归属');
  // 两种宿主各自的绑定命令
  assert.ok(body.includes('nx-kv docs ref add --owner group --group'), '组任务挂 group');
  assert.ok(body.includes('nx-kv docs ref add --owner repo --repo'), '仓库任务挂 repo（原断言）');
  assert.match(body, /不要用 group_repo/, '要说明 group_repo 会被覆盖，不能用于归档');
  // 「主篇 ≠ 绑定」口径：显式禁止 docs main / docs bind
  assert.match(body, /不是另一处绑定/, '要说清主篇只是位置不是绑定');
  assert.match(body, /docs main/, '要点名禁止 docs main');
  assert.match(body, /docs bind/, '要点名禁止 docs bind');
  // 步骤编号连贯（1 判来源插在第 2 步，后续顺延到 5）
  assert.match(body, /### 2\. 先判断任务来源/, '新步骤在第 2 步');
  assert.match(body, /### 5\. 收尾/, '收尾顺延到第 5 步');
});

test('#137 老库：旧内置被软删（用户自己的条目不受影响）', () => {
  const db = getDb();
  const at = Date.now();
  // 造一个「老库」的样子：旧的五条内置 + 一条用户自己复制出来的（且它是默认）
  db.run(`UPDATE templates SET is_default = 0 WHERE id = 'newtask.ref'`);
  for (const id of RETIRED_BUILTIN_TEMPLATE_IDS) {
    db.run(
      `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                              enabled, sort_order, builtin, state, version, deleted_at, created_at, updated_at)
       VALUES (:id, 'newtask', :name, 'suffix', '旧骨架', '[]', '{}', 0, 1, 9, 1, '', 0, NULL, :at, :at)`,
      { id, name: '旧内置', at },
    );
  }
  db.run(
    `INSERT INTO templates (id, category, name, slot, body, vars_schema, vars, is_default,
                            enabled, sort_order, builtin, state, version, deleted_at, created_at, updated_at)
     VALUES ('t_user_copy', 'newtask', '我自己的模板', 'suffix', '别删我', '[]', '{}', 1, 1, 1, 0, '', 0, NULL, :at, :at)`,
    { at },
  );

  seedBuiltinTemplates(db, at);

  const alive = db.all(
    `SELECT id, builtin FROM templates WHERE category = 'newtask' AND deleted_at IS NULL ORDER BY sort_order`,
  );
  const ids = alive.map((r) => r.id);
  assert.ok(ids.includes('newtask.ref'), '新内置在场');
  assert.ok(ids.includes('t_user_copy'), '用户自己的条目不受影响');
  for (const id of RETIRED_BUILTIN_TEMPLATE_IDS) {
    assert.ok(!ids.includes(id), `旧内置应该被下线：${id}`);
  }
  const dead = db.get(`SELECT deleted_at FROM templates WHERE id = 'default'`);
  assert.ok(Number(dead?.deleted_at) > 0, '是软删（deleted_at），不是硬删');
});
