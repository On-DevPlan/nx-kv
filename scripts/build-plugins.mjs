#!/usr/bin/env node
// 通用插件构建：扫 packages/*/package.json 的 nxkv 清单，逐个构建 server / client。
//
// 宿主与本脚本都不记插件包名：新增插件只需放好包、写 nxkv 字段，并按下述约定提供配置——
//   nxkv.server  → tsconfig.server.json（类型检查）+ Vite 打成**单文件**（SDK 内联，
//                  发布后不依赖 node_modules 里的 @nx-kv/plugin-sdk）
//   nxkv.client  → vite.config.ts（IIFE，React 走宿主注入的全局）
// 然后 `pnpm build:packages` 会自动把它带上（清单由 gen-plugins 生成给宿主）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build as viteBuild } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(ROOT, 'node_modules', '.bin');

/** 发现所有插件包（有 nxkv 清单的 packages/*；plugin-sdk 不算插件）。 */
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
      continue;
    }
    if (!pkg || !pkg.nxkv || !pkg.nxkv.api) continue;
    out.push({ name: String(pkg.name || entry.name), dir, nxkv: pkg.nxkv });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function run(bin, args, label) {
  const exe = join(BIN_DIR, process.platform === 'win32' ? `${bin}.cmd` : bin);
  if (!existsSync(exe)) {
    console.error(`缺少可执行文件：${exe}（先 pnpm install）`);
    process.exit(1);
  }
  console.log(`构建 ${label} …`);
  // Windows 的 .bin 是 .cmd，必须走 shell；路径统一加引号，避免工作区路径带空格。
  const line = [quote(exe), ...args.map(quote)].join(' ');
  const res = spawnSync(line, { shell: true, stdio: 'inherit', cwd: ROOT });
  if (res.status !== 0) process.exit(res.status || 1);
}

/** server 打成单文件 ESM：SDK 等依赖内联，node: 内置模块外置。 */
async function bundleServer(plugin) {
  console.log(`打包 ${plugin.name} server …`);
  await viteBuild({
    configFile: false,
    root: plugin.dir,
    logLevel: 'warn',
    build: {
      outDir: 'dist/server',
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      lib: {
        entry: 'src/server/index.ts',
        formats: ['es'],
        fileName: () => 'index.js',
      },
      rollupOptions: { external: [/^node:/] },
    },
  });
  const outFile = join(plugin.dir, 'dist/server/index.js');
  const code = readFileSync(outFile, 'utf8');
  if (/from\s+['"]@nx-kv\//.test(code) || /import\(\s*['"]@nx-kv\//.test(code)) {
    console.error(`${plugin.name}: server 产物仍引用 @nx-kv/*，发布后无法解析（检查 rollup external 配置）`);
    process.exit(1);
  }
  console.log(`已打包 ${plugin.name} → ${outFile}`);
}

const plugins = pluginPackages();
if (!plugins.length) {
  console.log('build:plugins — 没有发现插件包（packages/*/package.json 的 nxkv 字段）');
  process.exit(0);
}

for (const plugin of plugins) {
  const serverConfig = join(plugin.dir, 'tsconfig.server.json');
  const clientConfig = join(plugin.dir, 'vite.config.ts');
  if (plugin.nxkv.server) {
    if (!existsSync(serverConfig)) {
      console.error(`${plugin.name}: 声明了 nxkv.server，但缺 tsconfig.server.json`);
      process.exit(1);
    }
    run('tsc', ['-p', serverConfig], `${plugin.name} server（类型检查）`);
    await bundleServer(plugin);
  }
  if (plugin.nxkv.client) {
    if (!existsSync(clientConfig)) {
      console.error(`${plugin.name}: 声明了 nxkv.client，但缺 vite.config.ts`);
      process.exit(1);
    }
    run('vite', ['build', '--config', clientConfig], `${plugin.name} client`);
  }
}

console.log(`build:plugins — 已构建 ${plugins.length} 个内置插件包: ${plugins.map((p) => p.name).join(', ')}`);
