// 生成前端 apiclient 与 CLI 命令树快照：node --import tsx scripts/gen-api-client.mjs
// （pnpm gen:api）。产物入库，由 tests/unit/api-client.test.mjs 对账新鲜度。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');

const { registry } = await import(pathToFileURL(join(ROOT, 'src', 'runtime', 'registry.ts')).href);
const { generateClientSource, generateTreeJson } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'codegen.ts')).href
);

// 只生成 zod 通道（@action 装饰、带 fields）的 action；
// legacy flags 通道的 action 继续由前端手写 client.js 调用（迁移完成后删除）。
const zodActions = registry.actions.filter((a) => Array.isArray(a.fields));

const OUT = join(ROOT, 'src', 'web', 'frontend', 'api');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'client.generated.ts'), generateClientSource(zodActions), 'utf8');
writeFileSync(join(OUT, 'cli-tree.json'), generateTreeJson(zodActions), 'utf8');
console.log(`gen:api — ${zodActions.length} 个 zod action → client.generated.ts + cli-tree.json`);
