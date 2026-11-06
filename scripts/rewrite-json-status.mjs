#!/usr/bin/env node
// 一次性过渡工具（仅开发机）：把 localtasks.json 里的旧状态词重写成新词表。
//
// 背景：T02 之后代码只认 pending/claimed/done/cancelled，但存储仍是 JSON、
// 里面还是 legacy 词（consumed/archived）。切库（T03）之前，开发机上的
// nx-kv 要能继续读自己的数据，就需要这一步把存量数据先换到新词表。
//
// **不进运行时、不进 files 字段**。生产用户的路径不经过这里——
// 他们是「旧 JSON 直接被 DB 导入」，走 core/db/import-json.js 的 mapLegacyStatus。
//
// 判据与迁移器**同源**：直接 import mapLegacyStatus，不复制第二份逻辑。
// 幂等：已是新词的行原样保留；先备份再写；写坏了不会有半份文件（tmp + rename）。
//
// 用法：
//   node scripts/rewrite-json-status.mjs [--apply]
// 不带 --apply 只预览（dry-run），不写盘。
import process from 'node:process';
import { readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// 与测试隔离同一套环境约定：NX_KV_HOME / NX_KV_LOCALTASK_STORE 都认。
const home = process.env.NX_KV_HOME || join(process.env.USERPROFILE || process.env.HOME || tmpdir(), '.nx-kv');
const storeFile = process.env.NX_KV_LOCALTASK_STORE || join(home, 'localtasks.json');

const APPLY = process.argv.includes('--apply');
const NEW_WORDS = new Set(['pending', 'claimed', 'done', 'cancelled']);

// core 层不得 import shared；这里是 scripts/，不受 eslint 分层约束，
// 且复用迁移器的判据正是本脚本存在的意义（两份逻辑迟早分叉）。
const { mapLegacyStatus } = await import('../src/core/db/import-json.js');

if (!existsSync(storeFile)) {
  console.error(`找不到 ${storeFile}（可用 NX_KV_LOCALTASK_STORE 覆盖）`);
  process.exit(2);
}

const raw = JSON.parse(readFileSync(storeFile, 'utf8'));
const topics = raw.topics || {};
let changed = 0;
let alreadyNew = 0;
const unknownTasks = [];

for (const [topicKey, topic] of Object.entries(topics)) {
  for (const task of topic.tasks || []) {
    if (NEW_WORDS.has(task.status)) { alreadyNew++; continue; }
    const before = task.status;
    const mapped = mapLegacyStatus(task);            // 注意：传整行，判据在迁移器里
    task.status = mapped.status;
    if (mapped.unknown) unknownTasks.push(`#${task.id} @ ${topicKey}（原 status=${JSON.stringify(before)}）`);
    changed++;
  }
}

console.log(`文件: ${storeFile}`);
console.log(`改了 ${changed} 条 / 已是新词 ${alreadyNew} 条 / 未知语义 ${unknownTasks.length} 条（已按 pending 保守处理并在上面列出）`);
for (const line of unknownTasks) console.log(`  未知: ${line}`);
if (!APPLY) {
  console.log('dry-run：未写盘。确认无误后加 --apply 执行。');
  process.exit(0);
}

// 备份 → tmp 写 → rename（与 json-store 同款原子写套路）。
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const backup = `${storeFile}.bak-${stamp}`;
renameSync(storeFile, backup);
const tmp = `${storeFile}.${randomBytes(4).toString('hex')}.tmp`;
writeFileSync(tmp, JSON.stringify(raw, null, 2));
renameSync(tmp, storeFile);
console.log(`已备份: ${backup}（${statSync(backup).size} 字节）`);
console.log(`已写入: ${storeFile}`);
