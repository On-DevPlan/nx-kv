#!/usr/bin/env node
// 单文件行数门禁（CI 验收工具）：
//
//   ≤ 500    干净
//   501-600  宽松区：放过，仅列出提示
//   601-1000 警告：必须登记在 line-lint-registry.json，登记值即上限——
//            只许降不许升；涨到登记值之上按错误处理
//   > 1000   严禁：登记也不放行，必须拆分/精简
//
// 登记项随文件瘦身而失效：文件 ≤600 后登记变成「过期」，必须移除——
// 这逼 registry 单调收紧，最终空表 = 验收完全成功。
//
// 用法：
//   node scripts/check-lines.mjs          扫全部受控源码文件
//   node scripts/check-lines.mjs --init   把当前 601-1000 文件按现状写进 registry（仅建基线用）
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGISTRY = join(ROOT, 'scripts', 'line-lint-registry.json');

const LIMIT_OK = 500;      // ≤500 干净
const LIMIT_WARN = 600;    // 501-600 宽松；>600 警告
const LIMIT_HARD = 1000;   // >1000 严禁

// 与 eslint.config.js 的 ignores 对齐：构建产物与工具目录不参与。
// 注意走文件系统而不是 git ls-files——新建未跟踪的文件不能漏检，
// 已删未提交的文件也不该读到。
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'plan', 'temp', '.tool', '.claude', '.workbuddy']);
const IGNORED_PREFIX = ['src/web/public/', 'src/web/frontend/dist/'];
// 受控源码后缀：全仓毕业成 TypeScript 后 .ts/.tsx 才是主体，正则必须跟上——
// 否则门禁会「扫不到任何文件、全绿放行」而没人发现（毕业那轮就是先漏了这一步）。
const SCAN_RE = /\.(ts|tsx|js|jsx|mjs|css)$/;
// codegen 产物不参与行数门禁：形状由生成器决定（client.generated.ts 是 154 条
// action 的契约全集），瘦身只能靠改生成策略，靠「拆文件」没有意义。
const GENERATED_RE = /\.generated\.ts$/;

function sourceFiles(dir = ROOT, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) out.push(...sourceFiles(join(dir, e.name), rel));
    } else if (
      SCAN_RE.test(e.name)
      && !GENERATED_RE.test(e.name)
      && !IGNORED_PREFIX.some((p) => rel.startsWith(p))
    ) {
      out.push(rel);
    }
  }
  return out;
}

export function countLines(text) {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function loadRegistry() {
  if (!existsSync(REGISTRY)) return {};
  const data = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  return data.files || {};
}

export function checkLines() {
  const registry = loadRegistry();
  const errors = [];
  const warnings = [];
  const relaxed = [];
  const seen = new Set();

  for (const file of sourceFiles()) {
    const lines = countLines(readFileSync(join(ROOT, file), 'utf8'));
    seen.add(file);
    if (lines > LIMIT_HARD) {
      errors.push(`${file}: ${lines} 行 > ${LIMIT_HARD}（严禁）——必须拆分/精简，登记不放行`);
    } else if (lines > LIMIT_WARN) {
      const cap = registry[file];
      if (cap === undefined) {
        errors.push(`${file}: ${lines} 行 > ${LIMIT_WARN}（警告）且未登记——请登记或精简`);
      } else if (lines > cap) {
        errors.push(`${file}: ${lines} 行超过登记上限 ${cap}——只许降不许升`);
      } else {
        warnings.push(`${file}: ${lines} 行（已登记，上限 ${cap}）`);
      }
    } else if (lines > LIMIT_OK) {
      relaxed.push(`${file}: ${lines} 行（宽松区 ${LIMIT_OK + 1}-${LIMIT_WARN}）`);
    }
  }

  // 过期登记：文件没了、或已经瘦到 ≤600 —— registry 必须跟着收紧
  for (const [file, cap] of Object.entries(registry)) {
    if (!seen.has(file)) {
      errors.push(`registry: ${file} 已不存在，请移除登记（上限 ${cap}）`);
    } else {
      const lines = countLines(readFileSync(join(ROOT, file), 'utf8'));
      if (lines <= LIMIT_WARN) {
        errors.push(`registry: ${file} 已降至 ${lines} 行（≤${LIMIT_WARN}），请移除过期登记`);
      } else if (lines < cap) {
        warnings.push(`registry: ${file} ${lines} 行，登记上限 ${cap} 可收紧`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, relaxed, registrySize: Object.keys(registry).length };
}

function initRegistry() {
  const files = {};
  for (const file of sourceFiles()) {
    const lines = countLines(readFileSync(join(ROOT, file), 'utf8'));
    if (lines > LIMIT_WARN && lines <= LIMIT_HARD) files[file] = lines;
  }
  writeFileSync(REGISTRY, JSON.stringify({ files }, null, 2) + '\n');
  console.log(`已登记 ${Object.keys(files).length} 个警告文件（601-${LIMIT_HARD}）到 scripts/line-lint-registry.json`);
  for (const [f, n] of Object.entries(files)) console.log(`  ${n} ${f}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === '--init') {
    initRegistry();
    process.exit(0);
  }
  const r = checkLines();
  console.log(`行数门禁：≤${LIMIT_OK} 干净 / ${LIMIT_OK + 1}-${LIMIT_WARN} 宽松 / >${LIMIT_WARN} 警告需登记 / >${LIMIT_HARD} 严禁（当前登记 ${r.registrySize} 项）`);
  if (r.warnings.length) {
    console.log('警告:');
    for (const w of r.warnings) console.log('  ! ' + w);
  }
  if (r.relaxed.length) {
    console.log('宽松区（放过）:');
    for (const w of r.relaxed) console.log('  ~ ' + w);
  }
  if (!r.ok) {
    console.error('发现不合规项:');
    for (const e of r.errors) console.error('  ✗ ' + e);
    process.exit(1);
  }
  console.log('  全部合规：无严禁文件，警告文件均已登记。');
}
