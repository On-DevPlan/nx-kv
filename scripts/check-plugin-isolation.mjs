#!/usr/bin/env node
// 插件边界门禁（CI）：自注册 + 内部闭合。
//
// 规则（静态检查，不执行插件代码）：
//   1. 自注册：packages/*/package.json 的 nxkv 字段是唯一清单；
//      src/modules/plugin/plugins.generated.ts 必须与它一致（不一致 → 跑 pnpm gen:plugins）。
//   2. 内部闭合：插件 src 只允许 import 相对路径（不出包）/ node: / @nx-kv/plugin-sdk /
//      react(-dom)；插件不允许 import 宿主 src 或任何其它第三方包。
//   3. 宿主只用清单：src 不得 import 插件包（@nx-kv/plugin-sdk 除外），
//      也不得在代码里硬编码插件包名（生成清单除外）。
//   4. 清单路径必须留在包内；nxkv.server / nxkv.client 声明了就要有对应构建配置。
//   5. 发布面：内置插件必须 private；根 dependencies 不含 @nx-kv/*（SDK 只在
//      devDependencies）；files 必须带 packages/（插件产物随宿主包分发）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = join(ROOT, 'src', 'modules', 'plugin', 'plugins.generated.ts');
const SDK = '@nx-kv/plugin-sdk';
const errors = [];

/** 相对仓库根的展示路径。 */
function relOf(file) {
  return relative(ROOT, file).replace(/\\/g, '/');
}

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, exts, out);
      continue;
    }
    if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** 抽静态 / 动态 import 与 require 的模块说明符。 */
function importsOf(text) {
  const out = [];
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function pluginPackages() {
  const out = [];
  const base = join(ROOT, 'packages');
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      errors.push(`${relOf(pkgPath)}: JSON 解析失败`);
      continue;
    }
    if (!pkg || !pkg.nxkv || !pkg.nxkv.api) continue;
    out.push({ name: String(pkg.name || entry.name), dir, pkg, nxkv: pkg.nxkv });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const plugins = pluginPackages();
const names = plugins.map((p) => p.name);

// ── 1 / 4：清单自洽（路径不出包、声明的产物有构建配置） ─────────────────
for (const plugin of plugins) {
  const nxkv = plugin.nxkv;
  if (!/^\^1(\.|$)/.test(String(nxkv.api || ''))) {
    errors.push(`${plugin.name}: nxkv.api 必须是 ^1（当前 ${String(nxkv.api)}）`);
  }
  if (plugin.pkg.private !== true) {
    errors.push(`${plugin.name}: 内置插件必须 private:true（不单独发布，随宿主包一起分发）`);
  }
  if (!nxkv.server) errors.push(`${plugin.name}: nxkv.server 必填`);
  for (const field of ['server', 'client', 'style']) {
    const value = nxkv[field];
    if (!value) continue;
    const abs = resolve(plugin.dir, String(value));
    if (relative(plugin.dir, abs).startsWith('..')) {
      errors.push(`${plugin.name}: nxkv.${field} 越出插件包：${String(value)}`);
    }
  }
  if (nxkv.server && !existsSync(join(plugin.dir, 'tsconfig.server.json'))) {
    errors.push(`${plugin.name}: 声明了 nxkv.server，但缺 tsconfig.server.json`);
  }
  if (nxkv.client && !existsSync(join(plugin.dir, 'vite.config.ts'))) {
    errors.push(`${plugin.name}: 声明了 nxkv.client，但缺 vite.config.ts`);
  }
  // 依赖闭合：插件只允许依赖 SDK 与 React（peer）。
  for (const dep of Object.keys(plugin.pkg.dependencies || {})) {
    if (dep !== SDK) errors.push(`${plugin.name}: 插件 dependencies 只允许 ${SDK}，遇到 ${dep}`);
  }
  for (const dep of Object.keys(plugin.pkg.peerDependencies || {})) {
    if (dep !== 'react' && dep !== 'react-dom') {
      errors.push(`${plugin.name}: 插件 peerDependencies 只允许 react / react-dom，遇到 ${dep}`);
    }
  }
}

// ── 2：插件内部闭合（只能依赖 SDK / React / node / 包内相对路径） ────────
const PLUGIN_ALLOW = /^(node:|react(?:\/|$)|react-dom(?:\/|$)|@nx-kv\/plugin-sdk(?:\/|$))/;
for (const plugin of plugins) {
  for (const file of walk(join(plugin.dir, 'src'), ['.ts', '.tsx', '.mts', '.cts'])) {
    for (const spec of importsOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const abs = resolve(dirname(file), spec);
        if (relative(plugin.dir, abs).startsWith('..')) {
          errors.push(`${relOf(file)}: 相对 import 越出插件包：${spec}`);
        }
        continue;
      }
      if (!PLUGIN_ALLOW.test(spec)) {
        errors.push(`${relOf(file)}: 插件不得 import ${spec}（只允许 ${SDK} / react / node: / 包内相对路径）`);
      }
    }
  }
}

// ── 3：宿主只认清单（不 import 插件包、不硬编码包名） ─────────────────────
for (const file of walk(join(ROOT, 'src'), ['.ts', '.tsx', '.mts', '.cts'])) {
  const rel = relOf(file);
  const text = readFileSync(file, 'utf8');
  for (const spec of importsOf(text)) {
    if (spec === SDK || spec.startsWith(`${SDK}/`)) continue;
    if (spec.startsWith('@nx-kv/plugin-')) {
      errors.push(`${rel}: 宿主不得 import 插件包（${spec}）`);
    }
  }
  if (rel === 'src/modules/plugin/plugins.generated.ts') continue;
  for (const name of names) {
    if (text.includes(name)) errors.push(`${rel}: 宿主源码硬编码了插件包名 ${name}`);
  }
}

// ── 1（续）：生成清单与磁盘清单一致 ──────────────────────────────────────
const generatedText = existsSync(GENERATED) ? readFileSync(GENERATED, 'utf8') : '';
const generatedRefs = [...generatedText.matchAll(/\{\s*name:\s*"([^"]+)",\s*dir:\s*"([^"]+)"\s*\}/g)]
  .map((m) => ({ name: m[1], dir: m[2] }))
  .filter((r) => r.name !== SDK)
  .sort((a, b) => a.name.localeCompare(b.name));
const diskRefs = plugins
  .map((p) => ({ name: p.name, dir: relOf(p.dir) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const shape = (list) => list.map((r) => `${r.name}@${r.dir}`).join('|');
if (shape(generatedRefs) !== shape(diskRefs)) {
  errors.push(
    `plugins.generated.ts 与 packages/*/package.json 的 nxkv 清单不一致（跑 pnpm gen:plugins）：` +
      `生成=${shape(generatedRefs) || '无'} 磁盘=${shape(diskRefs) || '无'}`,
  );
}

// ── 5：发布面（内置插件随宿主包分发，不安装、不单独发布） ────────────────
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const dep of Object.keys(rootPkg.dependencies || {})) {
  if (dep.startsWith('@nx-kv/')) {
    errors.push(`根 package.json 的 dependencies 不应包含 ${dep}（内置插件/SDK 不能成为运行时依赖）`);
  }
}
const sdkDevDep = rootPkg.devDependencies && rootPkg.devDependencies[SDK];
if (!sdkDevDep) errors.push(`根 package.json 的 devDependencies 缺少 ${SDK}: workspace:*（类型与前端构建用）`);
else if (String(sdkDevDep) !== 'workspace:*') {
  errors.push(`根 devDependencies 的 ${SDK} 必须是 workspace:*（发版不随包安装）`);
}
const files = Array.isArray(rootPkg.files) ? rootPkg.files : [];
if (!files.includes('packages/')) {
  errors.push('根 package.json 的 files 缺少 "packages/"（内置插件产物要随包分发）');
}

if (errors.length) {
  console.error('[check-plugin-isolation] 插件边界不合规：');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('约定：插件包只依赖 @nx-kv/plugin-sdk + React；宿主只按 nxkv 清单加载与调用。');
  process.exit(1);
}
console.log(`[check-plugin-isolation] OK：${plugins.length} 个插件包自注册且与宿主闭合（${names.join(', ')}）`);
