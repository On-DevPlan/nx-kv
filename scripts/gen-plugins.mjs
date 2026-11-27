// 生成宿主可加载的插件包清单：扫 packages/*/package.json 的 nxkv 字段。
//
// 只输出 `{ name, dir }`：dir 是**相对包根**的插件目录。宿主按相对目录解析
// package.json 与 dist 产物（不依赖 node_modules 里的包链接）——这样发布包
// 把 packages/ 一起打进 tarball 后，npx nx-kv 也能直接加载内置插件。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const PACKAGES_DIR = join(ROOT, 'packages');
const OUT = join(ROOT, 'src', 'modules', 'plugin', 'plugins.generated.ts');

function writeIfChanged(abs, body) {
  if (existsSync(abs) && readFileSync(abs, 'utf8') === body) return false;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, 'utf8');
  return true;
}

const plugins = [];
if (existsSync(PACKAGES_DIR)) {
  for (const entry of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(PACKAGES_DIR, entry.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    const nxkv = pkg && pkg.nxkv;
    if (!nxkv || !nxkv.api) continue;
    if (!pkg.name) continue;
    plugins.push({ name: String(pkg.name), dir: `packages/${entry.name}` });
  }
}

plugins.sort((a, b) => a.name.localeCompare(b.name));
const body = `// AUTO-GENERATED —— 由 scripts/gen-plugins.mjs 生成，勿手改。
//
// 内置插件：只列包名与**相对包根**的目录；宿主按目录解析 package.json 的 nxkv 产物。
export interface PluginPackageRef {
  /** 包名（展示 / 门禁校验用；运行时不走 node_modules 解析） */
  name: string;
  /** 相对包根的插件目录（dev 与发布包同一布局：packages/<目录>） */
  dir: string;
}

export const PLUGIN_PACKAGES: readonly PluginPackageRef[] = [
${plugins.map((p) => `  { name: ${JSON.stringify(p.name)}, dir: ${JSON.stringify(p.dir)} },`).join('\n')}
];
`;
const changed = writeIfChanged(OUT, body);
console.log(
  `gen:plugins — ${plugins.length} 个内置插件包${changed ? '' : '（无变化）'}: ` +
    `${plugins.map((p) => `${p.name} → ${p.dir}`).join(', ') || '无'}`,
);
