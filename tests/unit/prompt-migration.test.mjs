// 旧设置键的处置（S3 纯校验后：**不做旧配置兼容**——方案 §11）。
//
// 老库只有旧键（lt.deliveryTemplate / lt.attachTemplate / lt.taskSuffix / lt.ackPrompt /
// lt.xmlBlocks）时：ensurePromptTemplates 把出厂快照整份落库（版本键从无到有），
// getSettings 返回纯出厂快照——**旧键内容被忽略，不折算**（迁移逻辑 S3 已删）。
// 落盘 blockTemplates 里残留的 rule 键同样被忽略（normalize 只认 8 个区块 id）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLocaltaskStore } from '../../src/modules/localtask/repo/open.js';
import { closeDb } from '../../src/core/db/index.js';
import * as svc from '../../src/modules/localtask/service.js';
import { BUILTIN_TEMPLATE_ID, PROMPT_BLOCK_IDS } from '../../src/shared/prompt-blocks.js';
import { readSettingRaw, writeSettingRaw } from '../../src/core/db/settings.js';
import { LT_BLOCK_TEMPLATES } from '../../src/modules/promptplug/keys.js';

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

/** 写一份「只有旧键」的老库（删掉 lt.blockTemplates 与版本键，模拟升级前的老库）。 */
function seedLegacySettings() {
  openLocaltaskStore(); // 建表 + ensure（首次 reset 后由这里建表）
  closeDb();
  const db = new DatabaseSync(dbFile);
  db.exec("DELETE FROM settings WHERE key IN ('lt.blockTemplates', 'lt.promptTemplatesVersion')");
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
      ack: { enabled: true, template: 'ACK 外壳 {{block.content}}' },
      timecheck: { enabled: false, items: ['T1', 'T2'], wrapper: '[{{block.content}}]' },
    })
  );
  db.close();
}

const activeOf = (s, id) => {
  const b = s.blockTemplates[id];
  return b.list.find((t) => t.id === b.active);
};

test('旧键老库：ensure 落库出厂快照，旧键内容忽略不折算（§11 不做旧配置兼容）', async () => {
  seedLegacySettings();
  const s = await svc.getSettings();
  // 旧键概念全部不存在
  assert.equal(s.activePromptTemplate, undefined);
  assert.equal(s.promptTemplates, undefined);
  assert.equal(s.xmlBlocks, undefined);
  assert.equal(s.taskSuffixList, undefined);

  // 8 段齐、全部是出厂快照的内置模板（旧 deliveryTemplate/attachTemplate/taskSuffix 不折算）
  for (const id of PROMPT_BLOCK_IDS) {
    const b = s.blockTemplates[id];
    assert.ok(b, `缺 ${id}`);
    assert.equal(b.list[0].id, BUILTIN_TEMPLATE_ID, `${id} 内置模板必须存在`);
    assert.equal(b.list[0].builtin, true);
  }
  assert.equal(s.blockTemplates.rule, undefined, 'rule 不再作为区块存在');
  assert.notEqual(activeOf(s, 'context').template, 'CTX {{task.id}}', '旧键不折算进 context');
  assert.match(activeOf(s, 'ack').template, /localtask done/, 'ack 是出厂快照内置');
});

test('落盘 blockTemplates 里残留 rule 键 → 读时忽略（normalize 只认 8 段），保存后消失', async () => {
  seedLegacySettings();
  const conn = openLocaltaskStore();
  const lists = JSON.parse(JSON.stringify(readSettingRaw(conn, LT_BLOCK_TEMPLATES)));
  lists.rule = {
    active: 'r1',
    list: [{ id: 'r1', name: '旧 rule', template: '通用收尾约束 {{task.id}}' }],
  };
  writeSettingRaw(conn, LT_BLOCK_TEMPLATES, lists);

  const s = await svc.getSettings();
  assert.equal(s.blockTemplates.rule, undefined, '读出的模型里没有 rule');

  // 再保存一次（仅恢复 context 内置），落盘值里应已无 rule 键
  await svc.updateSettings({ deliveryTemplate: '' });
  const db = new DatabaseSync(dbFile);
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LT_BLOCK_TEMPLATES);
    const raw = JSON.parse(row.value);
    assert.equal(raw.rule, undefined, 'lt.blockTemplates 不再写 rule 键');
    assert.deepEqual(
      Object.keys(raw).sort(),
      ['ack', 'attachment', 'context', 'doneguard', 'ext', 'getloop', 'goalhint', 'timecheck'],
    );
  } finally {
    db.close();
  }
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

// #104 探针：设置面板「提示词模板」PATCH 发的是驼峰 `blockTemplates` / `appendMode`，
// 而 localtask.config 的契约只声明了 kebab（`block-templates` / `append-mode`）——
// zod 默认丢弃未声明键，patch 落空 → 服务端报「请至少指定一项」，web 端模板完全存不进去。
// 这里把 HTTP 线缆口径钉住：驼峰键必须在契约里、真的落库。
test('#104 HTTP 驼峰键 blockTemplates / appendMode 不被剥掉，真的落库', async () => {
  const { ACTIONS } = await import('../../src/runtime/registry.js');
  const { parseZodInput } = await import('../../src/runtime/zod-bridge.js');
  const act = ACTIONS.find((a) => a.id === 'localtask.config');
  assert.ok(act, 'localtask.config 已注册');

  seedLegacySettings();
  const lists = {
    context: {
      active: 'bt_web',
      list: [
        { id: BUILTIN_TEMPLATE_ID, name: '系统内置', template: 'X', builtin: true },
        { id: 'bt_web', name: '面板里改的', template: '〔面板 {{repo.name}}〕', builtin: false },
      ],
    },
  };
  const parsed = parseZodInput(act.input, { blockTemplates: lists, appendMode: 'plain' }, 'usage');
  assert.ok(parsed.blockTemplates, '驼峰 blockTemplates 必须在契约里（否则被 zod 丢掉）');
  assert.equal(parsed.appendMode, 'plain');

  const out = await act.run(parsed, { transport: 'http' });
  assert.equal(out.appendMode, 'plain', 'appendMode 落库');
  const s = await svc.getSettings();
  assert.equal(s.appendMode, 'plain');
  assert.equal(s.blockTemplates.context.active, 'bt_web', 'blockTemplates 落库');
  assert.equal(s.blockTemplates.context.list.find((t) => t.id === 'bt_web').template, '〔面板 {{repo.name}}〕');
});
