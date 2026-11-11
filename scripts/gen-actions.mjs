// 生成各模块的 action 清单（IoC 自动注册的一环）：
//   node --import tsx scripts/gen-actions.mjs
//
// 做什么：扫 src/modules/<域>/actions/*.ts，把其中**继承 ActionBase 的类**收进
// src/modules/<域>/actions/_manifest.generated.ts。模块装配只读这份清单——
// 于是「加一条 action」= 新建一个文件 + 跑一次生成，模块 index.ts 一行都不用改。
//
// 为什么是生成而不是运行时扫目录：
//   - 运行时扫描要动态 import 每个文件，而模块的装配是**同步**的（注册表在 import
//     期建好），动态 import 是异步的 → 只能上 TLA（顶层 await），那会让整个
//     注册表变成异步初始化，牵动 CLI/HTTP/server 三条链；
//   - 生成物有**新鲜度对账测试**兜底（改了声明忘了生成 → 当场红），
//     而运行时扫描没有这个「可被钉住」的边界；
//   - 生成的清单是**静态 import**，打包与类型检查都能看见（运行时扫描看不见）。
//
// 收集规则：导出类且原型链上有 ActionBase → 收；其余导出（类型、常量）忽略。
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const MODULES_DIR = join(ROOT, 'src', 'modules');
const { ActionBase } = await import(pathToFileURL(join(ROOT, 'src', 'runtime', 'action-base.ts')).href);

const HEADER = `// AUTO-GENERATED —— 由 scripts/gen-actions.mjs 生成，勿手改。
//
// 收录本目录下所有继承 ActionBase 的类。**加一条 action = 新建一个文件 +
// 跑 \`pnpm gen\`**；模块的 index.ts 不需要改。
// 新鲜度由 tests/unit/action-registry.test.mjs 对账。

`;

function collectClasses(mod) {
  const out = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== 'function' || !value.prototype) continue;
    if (value === ActionBase) continue;
    if (value.prototype instanceof ActionBase) out.push(name);
  }
  return out.sort();
}

let total = 0;
for (const moduleDir of readdirSync(MODULES_DIR, { withFileTypes: true })) {
  if (!moduleDir.isDirectory()) continue;
  const actionsDir = join(MODULES_DIR, moduleDir.name, 'actions');
  if (!existsSync(actionsDir)) continue;

  const files = readdirSync(actionsDir)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
    .sort();

  const classes = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(actionsDir, file)).href);
    for (const name of collectClasses(mod)) {
      classes.push({ name, file: file.replace(/\.ts$/, '') });
    }
  }

  const imports = classes.map((c) => `import { ${c.name} } from './${c.file}.js';`).join('\n');
  const reexports = classes.map((c) => `export { ${c.name} };`).join('\n');
  const list = classes.map((c) => `  ${c.name},`).join('\n');
  const body = `${HEADER}import type { ActionBase } from '../../../runtime/action-base.js';
import type { Container } from '../../../runtime/container.js';
${imports}

/** 本模块的全部 action 类（容器按这个顺序建实例）。 */
export const ACTIONS: readonly (new (deps: Container) => ActionBase)[] = [
${list}
];

// 再导出类本身：前端 apiclient 的返回类型从这里 type-only 引用（实现即契约）。
${reexports}
`;
  writeFileSync(join(actionsDir, '_manifest.generated.ts'), body, 'utf8');
  total += classes.length;
  console.log(`gen:actions — ${moduleDir.name}: ${classes.length} 个 action 类`);
}

if (!total) {
  console.log('gen:actions — 没有 actions/ 目录需要生成（尚未有模块迁移到模板形态）');
}
