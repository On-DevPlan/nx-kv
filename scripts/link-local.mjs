#!/usr/bin/env node
// link-local —— 把全局 `nx-kv` 命令覆盖式 shim 到本仓库（改码即生效，无需发版）。
//
// 设计依据：server-cli-web-scaffold 的 B02-link-local-shim。要点：
//   - 不用 npm link（其 prefix 未必在真实 PATH）。按 PATH 顺序找敲 `nx-kv` 时真实
//     命中的目录，备份原件后原地替换为转发器；PATH 一字不动，已开终端立即生效。
//   - 覆盖前逐字节备份进 RECEIPT（~/.nx-kv/dev/install.json）；unlink 只信清单。
//   - 重装保护：目标已是本工具转发器时，原件以既有 v2 清单为准（且 targetDir 一致
//     才采信），绝不把转发器当“原件”。
//   - --auto（build 链路）：只覆盖现成落点，没有就静默跳过，绝不新建/改 PATH。
//
// 用法：
//   node scripts/link-local.mjs              安装（覆盖 + 必要时兜底）
//   node scripts/link-local.mjs --auto       仅覆盖现成落点，否则跳过（CI 安全）
//   node scripts/link-local.mjs --dry-run    只预览，不写
//   node scripts/link-local.mjs --unlink     按 RECEIPT 还原
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const NAME = 'nx-kv';
const MARK = 'nx-kv-local-shim';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_TARGET = join(REPO_ROOT, 'bin', 'cli.mjs');
const NODE = process.execPath;
const RECEIPT = join(homedir(), '.nx-kv', 'dev', 'install.json');
const DEV_BIN = join(homedir(), '.nx-kv', 'dev', 'bin');

const isWin = process.platform === 'win32';
const SEP = isWin ? ';' : ':';

const argv = process.argv.slice(2);
const flags = {
  unlink: argv.includes('--unlink'),
  auto: argv.includes('--auto'),
  dryRun: argv.includes('--dry-run'),
};

function log(msg) {
  console.log(msg);
}

// ─── PATH 落点探测 ─────────────────────────────────────────────────

function winVariants() {
  return [NAME + '.cmd', NAME + '.exe', NAME + '.bat', NAME + '.ps1', NAME];
}
function posixVariants() {
  return [NAME];
}
function variants() {
  return isWin ? winVariants() : posixVariants();
}

// 按 PATH 顺序返回第一个已含命令变体的目录（真实落点）
function findExistingTargetDir() {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const d of dirs) {
    let dir;
    try {
      dir = resolve(d);
    } catch {
      continue;
    }
    if (variants().some((v) => existsSync(join(dir, v)))) return dir;
  }
  return null;
}

// Windows：同目录存在 .exe 时 PATHEXT 通常优先 .exe，文本转发器接不到，判为受阻
function exeBlocks(dir) {
  if (!isWin) return false;
  const exe = join(dir, NAME + '.exe');
  if (!existsSync(exe)) return false;
  const text = [NAME + '.cmd', NAME + '.bat', NAME + '.ps1', NAME].some((v) => existsSync(join(dir, v)));
  return !text;
}

// 兜底：PATH 上既有的干净、非包管理器/系统受管目录
function findCleanDir() {
  const managed = /(\\windowsapps|\\windows\\|program files|\\volta\\|\\nodejs|\\npm|pnpm|\\scoop\\)/i;
  for (const d of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    let dir;
    try {
      dir = resolve(d);
    } catch {
      continue;
    }
    if (existsSync(dir) && !managed.test(dir)) return dir;
  }
  return null;
}

// ─── 转发器内容 ────────────────────────────────────────────────────

const posixNode = NODE.replace(/\\/g, '/');
const posixCli = CLI_TARGET.replace(/\\/g, '/');

function forwarder(file) {
  if (file.endsWith('.cmd') || file.endsWith('.bat')) {
    return (
      `@REM ${MARK} -> ${REPO_ROOT}\r\n` +
      `@echo off\r\n"${NODE}" "${CLI_TARGET}" %*\r\n`
    );
  }
  if (file.endsWith('.ps1')) {
    return (
      `# ${MARK} -> ${REPO_ROOT}\r\n` +
      `& "${NODE}" "${CLI_TARGET}" @args\r\n` +
      `exit $LASTEXITCODE\r\n`
    );
  }
  // 无扩展名（Git Bash / POSIX）
  return (
    `#!/bin/sh\n# ${MARK} -> ${REPO_ROOT}\n` +
    `exec "${posixNode}" "${posixCli}" "$@"\n`
  );
}

function forwarderFiles() {
  if (isWin) return [NAME + '.cmd', NAME + '.ps1', NAME];
  return [NAME];
}

// ─── RECEIPT ───────────────────────────────────────────────────────

function loadReceipt() {
  try {
    return JSON.parse(readFileSync(RECEIPT, 'utf8'));
  } catch {
    return null;
  }
}

function saveReceipt(r) {
  if (flags.dryRun) return;
  mkdirSync(dirname(RECEIPT), { recursive: true });
  writeFileSync(RECEIPT, JSON.stringify(r, null, 2), 'utf8');
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

// ─── Windows 用户 PATH 前置（仅兜底新建目录时） ───────────────────

function getUserPath() {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"],
    { encoding: 'utf8' }
  ).trim();
}

function setUserPath(value) {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "[Environment]::SetEnvironmentVariable('Path', $env.NXKV_NEWPATH, 'User')"],
    { encoding: 'utf8', env: { ...process.env, NXKV_NEWPATH: value } }
  );
}

function prependUserPath(dir) {
  const cur = getUserPath();
  if (cur.split(SEP).some((x) => resolve(x.trim() || '.') === resolve(dir))) return false;
  const next = cur ? dir + SEP + cur : dir;
  setUserPath(next);
  const back = getUserPath();
  if (!back.split(SEP).some((x) => resolve(x.trim() || '.') === resolve(dir))) {
    throw new Error('PATH 写后回读不一致，已中止');
  }
  return true;
}

// ─── 安装 ─────────────────────────────────────────────────────────

function install() {
  if (!existsSync(CLI_TARGET)) throw new Error('找不到入口 ' + CLI_TARGET + '（先确认仓库完整）');

  let targetDir = findExistingTargetDir();
  const blocked = targetDir && exeBlocks(targetDir) ? targetDir : null;
  if (blocked) targetDir = null;

  let pathEdit = null;

  if (!targetDir) {
    if (flags.auto) {
      log('link-local --auto：PATH 上无现成落点，静默跳过。');
      return;
    }
    targetDir = findCleanDir();
    if (!targetDir) {
      targetDir = DEV_BIN;
      if (!flags.dryRun) mkdirSync(targetDir, { recursive: true });
      if (isWin) {
        if (!flags.dryRun && prependUserPath(targetDir)) pathEdit = { scope: 'User', dir: targetDir };
      } else {
        log(`已建兜底目录 ${targetDir}（请自行加入 PATH，脚本不改 shell 配置）。`);
      }
    }
  }

  if (blocked) log(`注意：${blocked} 存在 ${NAME}.exe，文本转发无法接管，已改用 ${targetDir}。`);

  // 重装保护：复用既有 v2 清单原件（targetDir 一致才采信）
  const prior = loadReceipt();
  const originals = {};
  if (prior && prior.version === 2 && prior.targetDir === targetDir && prior.originals) {
    Object.assign(originals, prior.originals);
  }

  const files = forwarderFiles();
  for (const f of files) {
    const abs = join(targetDir, f);
    if (!(abs in originals)) originals[abs] = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (flags.dryRun) continue;
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(abs, forwarder(f), 'utf8');
    if (!f.includes('.')) chmodSync(abs, 0o755); // 无扩展名需要可执行位
  }

  const receipt = {
    version: 2,
    mode: 'shim',
    name: NAME,
    platform: process.platform,
    targetDir,
    originals,
    pathEdit: prior && prior.targetDir === targetDir ? prior.pathEdit : pathEdit,
    node: NODE,
    cli: CLI_TARGET,
    installedAt: stamp(),
  };
  saveReceipt(receipt);

  log(`已把全局 ${NAME} shim 到: ${targetDir}`);
  log(`  入口 → ${CLI_TARGET}`);
  if (flags.dryRun) log('（dry-run，未实际写入）');
  if (receipt.pathEdit) log(`  已把目录前置到用户 PATH（新开终端生效）: ${targetDir}`);
}

// ─── 还原 ─────────────────────────────────────────────────────────

function isOurs(abs) {
  try {
    return readFileSync(abs, 'utf8').includes(MARK);
  } catch {
    return false;
  }
}

function unlink() {
  const r = loadReceipt();
  if (!r || !r.originals) {
    log('未找到 RECEIPT（' + RECEIPT + '），无法自动还原；请手动检查 PATH 残留。');
    if (flags.auto) return;
    process.exitCode = 1;
    return;
  }

  for (const [abs, original] of Object.entries(r.originals)) {
    if (existsSync(abs) && !isOurs(abs)) {
      log(`跳过（文件已被他人改动、不带 shim 标记）: ${abs}`);
      continue;
    }
    if (flags.dryRun) continue;
    if (original == null) {
      try {
        unlinkSync(abs);
      } catch {
        /* 已不存在 */
      }
    } else {
      writeFileSync(abs, original, 'utf8');
      if (!abs.includes('.')) chmodSync(abs, 0o755);
    }
  }

  if (!flags.dryRun) {
    try {
      unlinkSync(RECEIPT);
    } catch {
      /* 忽略 */
    }
  }
  log(`已还原 ${NAME}（RECEIPT: ${RECEIPT}）。`);
  if (r.pathEdit) log(`PATH 曾前置 ${r.pathEdit.dir}，如需移除请手动编辑用户 PATH。`);
}

try {
  if (flags.unlink) unlink();
  else install();
} catch (err) {
  console.error('link-local 失败:', err && err.message ? err.message : err);
  process.exit(1);
}
