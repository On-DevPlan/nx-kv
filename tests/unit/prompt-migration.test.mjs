// 旧设置 → 每区块模板列表模型的迁移（repo/settings.js 的首次读取派生）。
//
// 老库没有 `lt.blockTemplates`，只有旧键：`lt.deliveryTemplate / lt.attachTemplate /
// lt.taskSuffix / lt.ackPrompt`（以及可能的 `lt.xmlBlocks` / 旧的整组模板）。
// 首次读取必须把**有效的新语法模板**装进对应区块的列表并设为生效；
// 旧语法模板（`{{block.content}}` 等）不再兼容，不会被迁移进新列表。
// 旧 rule 区块已删除：其内容（整体模板 / xmlBlocks / lt.taskSuffix）统一并入 ack。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLocaltaskStore } from '../../src/modules/localtask/repo/open.js';
import { closeDb } from '../../src/core/db/index.js';
import * as svc from '../../src/modules/localtask/service.js';
import { BLOCK_DEFS, BUILTIN_TEMPLATE_ID } from '../../src/shared/prompt-blocks.js';

const tmp = mkdtempSync(join(tmpdir(), 'nx-kv-migrate-'));
const dbFile = join(tmp, 'nxkv.db');
process.env.NX_KV_DB = dbFile;

process.on('exit', () => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* 清理失败不影响结果 */
  }
});

function seedLegacySettings() {
  // 先建表，再关掉连接，直接写旧键（模拟升级前的老库）
  openLocaltaskStore();
  closeDb();
  const db = new DatabaseSync(dbFile);
  db.exec("DELETE FROM settings WHERE key LIKE 'lt.%'");
  const put = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  put.run('lt.deliveryTemplate', JSON.stringify('CTX {{task.id}}'));
  put.run('lt.attachTemplate', JSON.stringify('ATT {{attach.count}}'));
  put.run('lt.taskSuffix', JSON.stringify(['收尾一', '收尾二 {{task.id}}']));
  put.run('lt.ackPrompt', JSON.stringify([]));
  put.run('lt.appendMode', JSON.stringify('plain'));
  put.run(
    'lt.xmlBlocks',
    JSON.stringify({
      ack: { enabled: true, template: 'ACK 外壳 {{block.content}}' }, // 旧语法：不迁移
      timecheck: { enabled: false, items: ['T1', 'T2'], wrapper: '[{{block.content}}]' }, // 旧结构：不迁移
    })
  );
  db.close();
}

function rawBlockTemplates() {
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('lt.blockTemplates');
    return row ? JSON.parse(row.value) : null;
  } finally {
    db.close();
  }
}

const activeOf = (s, id) => {
  const b = s.blockTemplates[id];
  return b.list.find((t) => t.id === b.active);
};

test('旧键首次读取 → 每个区块各自列表，rule 内容并入 ack，旧语法模板不迁移', async () => {
  seedLegacySettings();
  const s = await svc.getSettings();
  // 旧的「整体模板集合」概念已删除
  assert.equal(s.activePromptTemplate, undefined);
  assert.equal(s.promptTemplates, undefined);
  assert.equal(s.xmlBlocks, undefined);
  assert.equal(s.taskSuffixList, undefined, '旧收尾指令视图随 rule 区块一起删除');

  assert.equal(activeOf(s, 'context').template, 'CTX {{task.id}}', 'deliveryTemplate → context');
  assert.equal(activeOf(s, 'attachment').template, 'ATT {{attach.count}}', 'attachTemplate → attachment');
  assert.equal(s.blockTemplates.rule, undefined, 'rule 不再作为区块存在');
  const ack = activeOf(s, 'ack');
  assert.equal(ack.id, 'legacy-rule', '旧 taskSuffix 并入 ack 的迁移条目');
  assert.match(ack.template, /localtask done/, 'ack 内置 done 指令保留');
  assert.match(ack.template, /收尾一\n\n收尾二 {{task\.id}}/, '旧收尾内容不丢，并入 ack');
  assert.equal(activeOf(s, 'timecheck').builtin, true, '旧 items/wrapper 结构不迁移，保留内置');

  // 每个区块至少一个内置模板
  for (const def of BLOCK_DEFS) {
    const b = s.blockTemplates[def.id];
    assert.ok(b, `缺 ${def.id}`);
    assert.equal(b.list[0].id, BUILTIN_TEMPLATE_ID, `${def.id} 内置模板必须存在`);
    assert.equal(b.list[0].builtin, true);
  }

  // 旧派生视图与旧键语义对齐（ack 未迁移时如实反映内置模板）
  assert.equal(s.appendMode, 'plain', '旧 appendMode 保留为全局设置');
  assert.deepEqual(
    s.ackPromptList,
    [
      '完成之后必须调用 nx-kv localtask done --id {{task.id}} --summary "<完成总结>" 汇报结果。',
      '收尾一',
      '收尾二 {{task.id}}',
    ],
    '旧 ack 未迁移 → 生效模板来自 ack 内置 + 并入的收尾内容'
  );
  assert.equal(s.deliveryTemplate, 'CTX {{task.id}}');
  assert.equal(s.attachTemplate, 'ATT {{attach.count}}');
});

test('落盘 blockTemplates 里残留 rule → 读时并入 ack；保存后不再有 rule 键', async () => {
  seedLegacySettings();
  // 先把 ack 恢复内置，再写入带 rule 的旧 v5 数据（模拟已升级过的库）
  await svc.updateSettings({ ackPrompt: [] });
  const db = new DatabaseSync(dbFile);
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('lt.blockTemplates');
  const lists = JSON.parse(row.value);
  lists.rule = {
    active: 'r1',
    list: [{ id: 'r1', name: '旧 rule', template: '通用收尾约束 {{task.id}}' }],
  };
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify(lists), 'lt.blockTemplates');
  db.close();

  const s = await svc.getSettings();
  assert.equal(s.blockTemplates.rule, undefined, '读出的模型里没有 rule');
  const ack = activeOf(s, 'ack');
  assert.equal(ack.id, 'legacy-rule');
  assert.match(ack.template, /localtask done/);
  assert.match(ack.template, /通用收尾约束 {{task\.id}}/, '残留 rule 内容并入 ack，不静默丢');

  // 再保存一次（不改 blockTemplates，仅恢复 context 内置），落盘值里应已无 rule 键
  await svc.updateSettings({ deliveryTemplate: '' });
  const raw = rawBlockTemplates();
  assert.equal(raw.rule, undefined, 'lt.blockTemplates 不再写 rule 键');
  assert.deepEqual(Object.keys(raw).sort(), ['ack', 'attachment', 'context', 'ext', 'getloop', 'timecheck']);
});

test('写旧便捷键 → 落到对应区块的「命令行」条目并启用；置空恢复内置', async () => {
  seedLegacySettings();
  const s = await svc.updateSettings({ ackPrompt: ['新 ack {{task.id}}'] });
  assert.equal(activeOf(s, 'ack').template, '新 ack {{task.id}}');
  assert.equal(activeOf(s, 'ack').id, 'cli');
  // 再读（列表已落盘）仍一致
  const again = await svc.getSettings();
  assert.deepEqual(again.ackPromptList, ['新 ack {{task.id}}']);

  // 恢复内置：空串 → active 指回 builtin
  const reset = await svc.updateSettings({ deliveryTemplate: '', attachTemplate: '' });
  assert.equal(reset.blockTemplates.context.active, BUILTIN_TEMPLATE_ID);
  assert.equal(reset.blockTemplates.attachment.active, BUILTIN_TEMPLATE_ID);
  assert.equal(reset.deliveryTemplate, '', '旧视图把内置视为空串（= 用内置）');
  assert.equal(reset.attachTemplate, '');
});

test('旧语法模板保存被拒绝（不再维护新旧两套语法）', async () => {
  seedLegacySettings();
  await assert.rejects(
    svc.updateSettings({
      deliveryTemplate: '{{#repo}}旧闸门{{/repo}}',
    }),
    /已废弃/
  );
});
