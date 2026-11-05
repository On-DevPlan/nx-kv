// scripts/migrate-remote-keys.mjs —— 把仓库的 key 从「本地 key」迁到「远程 key」（任务 #63）。
//
// 为什么：仓库登记的 key 标准是**远程派生**（github.com/<owner>/<repo>），
// local/<目录名> 只是没有 remote 时的兜底。很多仓库的 key 还停在本地形态——
// 跨机导入导出、参考仓库挂载、组内归属都按 key 对齐，key 不统一就没法跨机用。
//
// 本脚本做的事（幂等，可重跑）：
//   1. 读每个仓库本机 checkout 的 git origin（没登记 remote 的那些）；
//   2. 用**仓库模块同一套派生**算出新 key（src/modules/repos/service.js 的 deriveKey）；
//   3. 迁移所有引用：
//      - 看板成员表 repoKeys、组内描述 repoNotes、组绑定描述 repoDocs（都按 repo key 索引）
//      - 文档树：repo/local/<x>.md → repo/<新key>.md；目录形态 repo/local/<x>/** 同理
//      - 本机任务队列：frontmatter 的 project / projectIntro
//      - 文档正文与任务正文里出现的旧路径引用
//   4. 写盘前先备份（repos.json / localtasks.json / 文档树）。
//
// 用法：
//   node scripts/migrate-remote-keys.mjs --board nx          # 预演（只报告）
//   node scripts/migrate-remote-keys.mjs --board nx --apply   # 真改（先备份）
//   node scripts/migrate-remote-keys.mjs --all --apply        # 全部仓库
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { deriveKey } from '../src/modules/repos/service.js';
import { repoDocRel } from '../src/modules/docs/paths.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const boardArg = (() => {
  const i = args.indexOf('--board');
  return i >= 0 ? args[i + 1] : '';
})();

const APP_DIR = process.env.NX_KV_HOME || path.join(homedir(), '.nx-kv');
const REPOS_STORE = process.env.NX_KV_REPOS_STORE || path.join(APP_DIR, 'repos.json');
const TASKS_STORE = process.env.NX_KV_LOCALTASK_STORE || path.join(APP_DIR, 'localtasks.json');
const DOCS_DIR = process.env.NX_KV_DOCS_DIR || path.join(APP_DIR, 'docs');

const log = (...a) => console.log(...a);
const die = (m) => {
  console.error(m);
  process.exit(1);
};

/** 本机 checkout 的 git origin（取不到就空串） */
function gitOrigin(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').trim();
  } catch {
    return '';
  }
}

/** 递归收集目录下所有文件（相对路径） */
function walk(dir, base = '', out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(abs, rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** 移动文件（目标已存在 → 覆盖；父目录自动建） */
function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.rmSync(to, { force: true });
  fs.renameSync(from, to);
}

/** 文本里替换若干组字面量 */
function replaceAll(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) {
    if (!from || from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

// ─── 1) 读数据 ────────────────────────────────────────────────────────
if (!fs.existsSync(REPOS_STORE)) die('找不到仓库登记: ' + REPOS_STORE);
const repos = JSON.parse(fs.readFileSync(REPOS_STORE, 'utf8'));
const tasksStore = fs.existsSync(TASKS_STORE) ? JSON.parse(fs.readFileSync(TASKS_STORE, 'utf8')) : { topics: {} };

// 目标仓库：--board <组> 的成员，或 --all 全部
let targets = repos.repos || [];
if (boardArg) {
  const b = (repos.boards || []).find(
    (x) => x.name === boardArg || x.id === boardArg || x.key === boardArg,
  );
  if (!b) die('找不到看板: ' + boardArg);
  const keys = new Set(b.repoKeys || []);
  targets = targets.filter((r) => keys.has(r.key));
  if (!targets.length) die('看板 ' + boardArg + ' 没有成员');
}

// ─── 2) 算迁移计划 ────────────────────────────────────────────────────
const plan = []; // { repo, oldKey, newKey, remote, docMoves: [{from,to}], textPairs: [[from,to]] }
for (const r of targets) {
  if (r.keyCustom) continue; // 自定义 key：用户的显式选择，不动
  const origin = gitOrigin(r.path || '');
  if (!origin) continue; // 没 git / 没 origin：保持现状
  const next = deriveKey({ remote: origin });
  if (!next || next === r.key) continue; // 已经是远程 key
  const oldDocRel = repoDocRel(r.key);
  const newDocRel = repoDocRel(next);
  plan.push({
    repo: r,
    oldKey: r.key,
    newKey: next,
    remote: origin,
    oldDocRel,
    newDocRel,
  });
}

if (!plan.length) {
  log('没有需要迁移的仓库（key 已是远程派生，或没有 git origin）。');
  process.exit(0);
}

log(`预演：${plan.length} 个仓库将改用远程 key`);
for (const p of plan) {
  log(`  ${p.repo.name}: ${p.oldKey} → ${p.newKey}   (${p.remote})`);
}
if (!APPLY) {
  log('\n加 --apply 才真改（会先备份）。');
  process.exit(0);
}

// ─── 3) 备份 ──────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(APP_DIR, 'backup', 'rekeys-' + stamp);
fs.mkdirSync(backupDir, { recursive: true });
for (const f of [REPOS_STORE, TASKS_STORE]) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(backupDir, path.basename(f)));
}
if (fs.existsSync(DOCS_DIR)) {
  fs.cpSync(DOCS_DIR, path.join(backupDir, 'docs'), { recursive: true });
}
log('备份已写入 ' + backupDir);

// ─── 4) 迁移引用 ──────────────────────────────────────────────────────
const textPairs = []; // 全局字面量替换（旧 key / 旧路径 → 新）
for (const p of plan) {
  textPairs.push([p.oldKey, p.newKey]);
  textPairs.push([p.oldDocRel, p.newDocRel]);
}

// 4a) 看板：成员表 / 组内描述 / 组绑定描述（都按 repo key 索引）
for (const b of repos.boards || []) {
  if (Array.isArray(b.repoKeys)) {
    b.repoKeys = b.repoKeys.map((k) => {
      const hit = plan.find((p) => p.oldKey === k);
      return hit ? hit.newKey : k;
    });
  }
  for (const field of ['repoNotes', 'repoDocs']) {
    if (!b[field] || typeof b[field] !== 'object') continue;
    const next = {};
    for (const [k, v] of Object.entries(b[field])) {
      const hit = plan.find((p) => p.oldKey === k);
      next[hit ? hit.newKey : k] = v;
    }
    b[field] = next;
  }
}

// 4b) 仓库登记：remote + key
for (const p of plan) {
  p.repo.remote = p.remote;
  p.repo.key = p.newKey;
  p.repo.keyUpdatedAt = new Date().toISOString();
}

// 4c) 文档树：路径搬家（文件 / 目录）
const docFiles = walk(DOCS_DIR);
const moved = [];
for (const p of plan) {
  const oldBase = p.oldDocRel.replace(/\.md$/, ''); // repo/local/nx-kv
  const newBase = p.newDocRel.replace(/\.md$/, '');
  for (const rel of docFiles) {
    if (rel === p.oldDocRel) {
      moveFile(path.join(DOCS_DIR, rel), path.join(DOCS_DIR, p.newDocRel));
      moved.push([rel, p.newDocRel]);
      continue;
    }
    if (rel.startsWith(oldBase + '/')) {
      const to = newBase + rel.slice(oldBase.length);
      moveFile(path.join(DOCS_DIR, rel), path.join(DOCS_DIR, to));
      moved.push([rel, to]);
    }
  }
}

// 4d) 文档正文里的旧路径 / 旧 key 引用
for (const rel of walk(DOCS_DIR)) {
  const abs = path.join(DOCS_DIR, rel);
  if (!/\.(md|json|txt)$/i.test(rel)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const out = replaceAll(text, textPairs);
  if (out !== text) fs.writeFileSync(abs, out);
}

// 4e) 本机任务队列：正文 frontmatter 的 project / projectIntro
let taskTouched = 0;
for (const topic of Object.values(tasksStore.topics || {})) {
  for (const t of topic.tasks || []) {
    if (typeof t.text !== 'string' || !t.text) continue;
    const out = replaceAll(t.text, textPairs);
    if (out !== t.text) {
      t.text = out;
      taskTouched += 1;
    }
  }
}

// ─── 5) 写盘 ──────────────────────────────────────────────────────────
fs.writeFileSync(REPOS_STORE, JSON.stringify(repos, null, 2));
if (fs.existsSync(TASKS_STORE)) fs.writeFileSync(TASKS_STORE, JSON.stringify(tasksStore, null, 2));

log(`\n已迁移 ${plan.length} 个仓库：`);
for (const p of plan) log(`  ${p.repo.name}: ${p.oldKey} → ${p.newKey}`);
log(`文档树搬家 ${moved.length} 个文件，任务正文改写 ${taskTouched} 条。`);
log('备份：' + backupDir);
