// 全仓 service.* 调用错配检查（2026-11-20「ref 生成」模板消失事故的防复发闸）。
//
// 背景：action 文件头部惯例 `const service: any = serviceNs` 把类型检查打瞎，
// 迁移/改名时函数名写错（如 listTemplate vs listTemplates）typecheck/lint/单测
// 全拦不住——单测走 service 直调、不经 action 层。03ad8e1 就这样漏进了 3 处
// 单复数错配，GET /api/templates 直接 500。
//
// 本脚本静态比对：每个 `import * as X from '...service...'` 的调用点
// `X.fn(` 是否存在于目标模块的导出面（含 export * / export {} 转出）。
// 发现错配 → 非零退出。lint script 已挂载；新 action 落地后跑 pnpm run lint 即覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src'];
const EXTS = new Set(['.ts', '.tsx', '.mjs']);

const cache = new Map(); // absPath -> Set(导出名)（含不存在文件的空集）

/** 解析 import spec：支持 tsx 的 .js→.ts 别名与目录 index。 */
function resolveImport(spec, fromDir) {
  const base = path.resolve(fromDir, spec);
  const cands = [base];
  if (base.endsWith('.js')) {
    cands.push(base.slice(0, -3) + '.ts');
    cands.push(base.slice(0, -3) + '.tsx');
    cands.push(path.join(base.slice(0, -3), 'index.ts'));
  } else {
    cands.push(path.join(base, 'index.ts'));
  }
  return cands.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

function collectExports(abs) {
  if (cache.has(abs)) return cache.get(abs);
  const set = new Set();
  cache.set(abs, set);
  if (!abs || !fs.existsSync(abs)) return set;
  const src = fs.readFileSync(abs, 'utf8');
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|let|var|enum|type|interface)\s+(\w+)/g)) set.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}(?:\s*from\s*'([^']+)')?/g)) {
    for (const piece of m[1].split(',')) {
      const n = piece.trim().split(/\s+as\s+/).pop().trim();
      if (n) set.add(n);
    }
    if (m[2]) for (const n of collectExports(resolveImport(m[2], path.dirname(abs)))) set.add(n);
  }
  for (const m of src.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) {
    for (const n of collectExports(resolveImport(m[1], path.dirname(abs)))) set.add(n);
  }
  return set;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)'/g)) {
    const [, ns, spec] = m;
    if (!spec.startsWith('.')) continue;
    // 只盯服务层命名空间（service.js / service/ 目录）——其余命名空间有类型，盲区仅在 any 化的 service
    if (!/(^|[\\/])service(\.(js|ts))?$/.test(spec.replace(/\?$/, '')) && !spec.includes('/service/')) continue;
    const abs = resolveImport(spec, path.dirname(f));
    if (!abs) { bad++; console.error(`MISS-FILE ${rel(f)}  ← ${spec}（目标文件不存在）`); continue; }
    const names = collectExports(abs);
    lines.forEach((line, i) => {
      for (const c of line.matchAll(new RegExp(`\\b${ns}\\.(\\w+)\\s*\\(`, 'g'))) {
        if (!names.has(c[1])) {
          bad++;
          console.error(`MISS ${rel(f)}:${i + 1}  ${ns}.${c[1]}() 不存在于 ${spec}`);
        }
      }
    });
  }
}

function rel(f) {
  return path.relative(ROOT, f).replace(/\\/g, '/');
}

if (bad) {
  console.error(`\ncheck-service-calls: ${bad} 处错配，拒绝通过`);
  process.exit(1);
}
console.log(`check-service-calls: OK（${files.length} 个文件，service.* 调用全部命中导出）`);
