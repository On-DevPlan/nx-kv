#!/usr/bin/env node
// schema 决策记录检查（CI 门禁）：
//
//   1. 每张 CREATE TABLE 上方必须有 `@decision docs/decisions/<文件名>.md`；
//   2. 指向的决策文件必须存在，正文里的 `date:` 与文件名日期前缀一致；
//   3. 每个 DROP TABLE 上方必须有 `@decision`，且该决策文件里 `drops:` 包含这张表；
//   4. 最新版本快照里带 `@sunset YYYY-MM-DD` 的表，超过日落日期直接报错；
//   5. 每个版本 vN.sql 都必须有一份 `docs/decisions/versions/*-vN.md` 版本说明。
//
// 历史快照（非最新版本）只检查 1/2/3/5；sunset 只对最新版本强制——历史文件
// 不可改，里面被后续版本删除的表本来就该带着日落日期留在档案里。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS = join(ROOT, 'src', 'core', 'db', 'migrations');
const DECISIONS = join(ROOT, 'docs', 'decisions');

const RE_DECISION = /^\s*--\s*@decision\s+(\S+)\s*$/;
const RE_SUNSET = /^\s*--\s*@sunset\s+(\d{4}-\d{2}-\d{2})/;
const RE_CREATE = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)\s*(?:\(|$)/i;
const RE_DROP = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_]+)\s*;/i;

function versionFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^v\d+\.sql$/.test(f))
    .map((f) => ({ file: f, version: Number(f.match(/^v(\d+)/)[1]) }))
    .sort((a, b) => a.version - b.version);
}

function readDecision(root, decisionPath) {
  const abs = join(root, decisionPath.replace(/^\//, ''));
  if (!existsSync(abs)) return { exists: false, abs };
  const text = readFileSync(abs, 'utf8');
  const date = (text.match(/^[-*]?\s*date:\s*(\d{4}-\d{2}-\d{2})\s*$/m) || [])[1] || '';
  const drops = (text.match(/^[-*]?\s*drops:\s*(.+)$/m) || [])[1] || '';
  const producers = /^[-*]?\s*producers:/m.test(text);
  const consumers = /^[-*]?\s*consumers:/m.test(text);
  return { exists: true, abs, text, date, drops, producers, consumers };
}

function dateFromFilename(path) {
  return (path.split(/[\\/]/).pop().match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
}

export function checkSchemaDecisions(root = ROOT) {
  const issues = [];
  const tables = [];
  const versions = versionFiles();
  const latest = versions.length ? versions[versions.length - 1].version : 0;

  for (const v of versions) {
    const sql = readFileSync(join(MIGRATIONS, v.file), 'utf8');
    let pendingDecision = '';
    let pendingSunset = '';
    for (const raw of sql.split('\n')) {
      const line = raw.trim();
      const dm = line.match(RE_DECISION);
      if (dm) {
        pendingDecision = dm[1];
        continue;
      }
      const sm = line.match(RE_SUNSET);
      if (sm) {
        pendingSunset = sm[1];
        continue;
      }
      const cm = line.match(RE_CREATE);
      if (cm) {
        const table = cm[1];
        const entry = { version: v.version, file: v.file, table, decision: pendingDecision, sunset: pendingSunset };
        tables.push(entry);
        if (!pendingDecision) {
          issues.push(`${v.file}: CREATE TABLE ${table} 上方缺少 @decision 决策注释`);
        } else {
          const doc = readDecision(root, pendingDecision);
          if (!doc.exists) {
            issues.push(`${v.file}: ${table} 指向的决策文件不存在: ${pendingDecision}`);
          } else {
            const fdate = dateFromFilename(pendingDecision);
            if (!fdate) issues.push(`${v.file}: 决策文件名没有日期前缀: ${pendingDecision}`);
            else if (doc.date !== fdate) {
              issues.push(`${v.file}: 决策文件日期(${doc.date || '缺失'}) 与文件名(${fdate}) 不一致: ${pendingDecision}`);
            }
            if (!doc.producers || !doc.consumers) {
              issues.push(`${v.file}: 决策文件缺少 producers/consumers 字段: ${pendingDecision}`);
            }
            if (v.version === latest && pendingSunset && pendingSunset < today()) {
              issues.push(`${v.file}: 表 ${table} 已过 sunset ${pendingSunset}，必须删除或更新替代方案`);
            }
          }
        }
        pendingDecision = '';
        pendingSunset = '';
        continue;
      }
      const dropm = line.match(RE_DROP);
      if (dropm) {
        const table = dropm[1];
        if (!pendingDecision) {
          issues.push(`${v.file}: DROP TABLE ${table} 上方缺少 @decision 删除决策`);
        } else {
          const doc = readDecision(root, pendingDecision);
          if (!doc.exists) issues.push(`${v.file}: DROP ${table} 的决策文件不存在: ${pendingDecision}`);
          else if (!doc.drops || !doc.drops.split(/[,\s]+/).includes(table)) {
            issues.push(`${v.file}: 决策文件 ${pendingDecision} 的 drops 未包含 ${table}`);
          }
        }
        pendingDecision = '';
        pendingSunset = '';
      }
    }
  }

  // 版本说明：每个 vN.sql 都要有一份 date 化的 versions/*-vN.md
  for (const v of versions) {
    let found = false;
    try {
      const names = readdirSync(join(DECISIONS, 'versions'));
      for (const name of names) {
        const m = name.match(/^(\d{4}-\d{2}-\d{2})-v(\d+)\.md$/);
        if (!m || Number(m[2]) !== v.version) continue;
        const text = readFileSync(join(DECISIONS, 'versions', name), 'utf8');
        const date = (text.match(/^[-*]?\s*date:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1] || '';
        if (date !== m[1]) {
          issues.push(`版本说明 ${name} 的 date(${date || '缺失'}) 与文件名日期(${m[1]}) 不一致`);
        }
        found = true;
      }
    } catch {
      /* 目录不存在 → 下面统一报缺失 */
    }
    if (!found) issues.push(`缺少版本 ${v.version} 的说明文档 docs/decisions/versions/*-v${v.version}.md`);
  }

  return { ok: issues.length === 0, issues, tables, latest, root };
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// CLI：人读列出现状，非零退出码让 CI 红。
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const r = checkSchemaDecisions();
  console.log(`schema 决策检查：${r.tables.length} 条建表记录（最新版本 v${r.latest}）`);
  const sunset = r.tables.filter((t) => t.sunset);
  if (sunset.length) {
    console.log('  带 sunset 的表:');
    for (const t of sunset) console.log(`    v${t.version} ${t.table} → ${t.sunset}`);
  }
  if (!r.ok) {
    console.error('发现不合规项:');
    for (const i of r.issues) console.error('  ✗ ' + i);
    process.exit(1);
  }
  console.log('  全部合规：每张表都有日期化决策，删除表有对应决策记录。');
}
