// codegen 产物的新鲜度对账：改了 action 声明却忘了跑 `pnpm gen` → 当场红。
//
// 两条产物：
//   1. src/web/frontend/api/client.generated.ts —— 前端类型安全 apiclient
//   2. src/web/frontend/api/cli-tree.json       —— CLI 命令树快照
//
// 对账方式：现场重新生成一遍，与入库的文件逐字比对。**不写盘**——
// 测试只报告差异，避免测试过程污染工作区（真要写入由 pnpm gen 负责）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { registry } = await import(pathToFileURL(join(ROOT, 'src', 'runtime', 'registry.ts')).href);
const { generateClientSource, generateTreeJson } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'codegen.ts')).href
);

// 只对账 zod 通道（@action 装饰、带 fields）的 action；legacy 通道不在生成范围。
const zodActions = registry.actions.filter((a) => Array.isArray(a.fields));

test('client.generated.ts 与当前 action 声明一致（改了声明要跑 pnpm gen）', async () => {
  const file = join(ROOT, 'src', 'web', 'frontend', 'api', 'client.generated.ts');
  const onDisk = await readFile(file, 'utf8');
  const fresh = generateClientSource(zodActions);
  assert.equal(
    onDisk,
    fresh,
    'src/web/frontend/api/client.generated.ts 已过期：跑 `pnpm gen` 重新生成后提交',
  );
});

test('cli-tree.json 与当前 action 声明一致（改了声明要跑 pnpm gen）', async () => {
  const file = join(ROOT, 'src', 'web', 'frontend', 'api', 'cli-tree.json');
  const onDisk = await readFile(file, 'utf8');
  const fresh = generateTreeJson(zodActions);
  assert.equal(onDisk, fresh, 'src/web/frontend/api/cli-tree.json 已过期：跑 `pnpm gen` 重新生成后提交');
});

test('每个模块的 action 清单已生成（新增 action 文件后要跑 pnpm gen）', async () => {
  // 清单缺类 = 装配期根本收不到这条 action（模块少一条命令）。
  // 这里用「清单里的类数 vs 目录里的 action 文件数」对账：数量不等即未生成。
  const { readdir } = await import('node:fs/promises');
  const modulesDir = join(ROOT, 'src', 'modules');
  const dirs = (await readdir(modulesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const problems = [];
  for (const dir of dirs) {
    const actionsDir = join(modulesDir, dir, 'actions');
    let files;
    try {
      files = await readdir(actionsDir);
    } catch {
      continue; // 该模块还没迁移到模板形态
    }
    const actionFiles = files.filter((f) => f.endsWith('.ts') && !f.startsWith('_'));
    if (!actionFiles.length) continue;

    const manifest = join(actionsDir, '_manifest.generated.ts');
    let text;
    try {
      text = await readFile(manifest, 'utf8');
    } catch {
      problems.push(`${dir}: 有 ${actionFiles.length} 个 action 文件，但没有 _manifest.generated.ts（跑 pnpm gen）`);
      continue;
    }
    // 清单里的 import 行数 = action 类数（每个类一行 import）
    const imports = text.split('\n').filter((l) => /^import \{ \w+ \} from '\.\//.test(l.trim()));
    if (imports.length !== actionFiles.length) {
      problems.push(
        `${dir}: action 文件 ${actionFiles.length} 个，清单收录 ${imports.length} 个（跑 pnpm gen）`,
      );
    }
  }
  assert.deepEqual(problems, [], `action 清单未生成:\n${problems.join('\n')}`);
});
