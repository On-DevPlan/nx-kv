// 契约的两道闸（设计文档 §7 的 T1/T2）：
//
//   T1 新鲜度：现场重建快照/Dart 包，与入库的逐字比对 —— 改了 output 忘了跑
//      `pnpm gen:dart` 当场红。**不写盘**：测试只报告差异。
//   T2 保真：用 output.safeParse(真实返回) 对账 —— 只保证「生成物跟上声明」是不够的，
//      声明本身也可能是错的（实测踩过：把 waiting 当成了 List<String>，实为 int）。
//
// T2 必须真跑 action，所以本文件把 NX_KV_HOME 指到临时目录、在 import 之前设好：
// 每个测试文件在独立进程里跑，不会影响别的用例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.NX_KV_HOME = mkdtempSync(join(tmpdir(), 'nxkv-contract-'));

const { registry } = await import(pathToFileURL(join(ROOT, 'src', 'runtime', 'registry.ts')).href);
const { buildContractSnapshot } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'contract.ts')).href
);
const { emitDartPackage } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'dartgen.ts')).href
);

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const zodActions = registry.actions.filter((a) => Array.isArray(a.fields));
const snapshot = buildContractSnapshot(zodActions, { app: 'nx-kv', version: pkg.version });

test('T1 · contract.json 与当前 output 声明一致（改了要跑 pnpm gen:dart）', async () => {
  const onDisk = await readFile(join(ROOT, 'contract', 'contract.json'), 'utf8');
  assert.equal(
    onDisk,
    JSON.stringify(snapshot, null, 2) + '\n',
    'contract/contract.json 已过期：跑 `pnpm gen:dart` 后提交',
  );
});

test('T1 · Dart 包与快照一致（逐文件比对，缺文件也算过期）', async () => {
  for (const [rel, content] of Object.entries(emitDartPackage(snapshot))) {
    const abs = join(ROOT, 'contract', 'dart', rel);
    assert.ok(existsSync(abs), `缺文件 contract/dart/${rel}：跑 \`pnpm gen:dart\``);
    assert.equal(await readFile(abs, 'utf8'), content, `contract/dart/${rel} 已过期：跑 \`pnpm gen:dart\``);
  }
});

test('T1 · 快照只收声明了 output 的 action（不对外就不在契约里）', () => {
  const withOutput = zodActions.filter((a) => a.output).map((a) => a.id).sort();
  assert.deepEqual(
    snapshot.actions.map((a) => a.id).sort(),
    withOutput,
  );
  for (const a of snapshot.actions) assert.equal(a.output.k, 'model', `${a.id} 的出参根必须是模型`);
});

test('T2 · 每条带 output 的 action，真实返回都能被自己的 schema 解析', async () => {
  // 依赖注入的 action 在临时 NX_KV_HOME 下也能跑：list 会给出空 topics + 真实 settings，
  // bootstrap 给出 100+ 条命令，contract 给出完整快照 —— 三种形状（数组/嵌套/动态）都覆盖到。
  for (const a of zodActions.filter((x) => x.output)) {
    const result = await a.run({}, { transport: 'http' });
    const parsed = a.output.safeParse(result);
    assert.ok(
      parsed.success,
      `${a.id} 的 output 与真实返回不符：${parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }
});

test('T2 · 声明太松也不行：类型写错必须被 schema 拒掉', () => {
  const list = zodActions.find((a) => a.id === 'localtask.list');
  const bad = {
    topics: [],
    // 真实类型是 int；写成字符串必须失败，否则「声明」等于没写
    waiting: '0',
    settings: { timeoutSec: 1, recommendedSec: 1, maxSec: 1, ackPromptList: [] },
  };
  assert.equal(list.output.safeParse(bad).success, false);
});

test('T1 · 同一份声明重复构建，指纹稳定（幂等的证据）', () => {
  const again = buildContractSnapshot(zodActions, { app: 'nx-kv', version: pkg.version });
  assert.equal(again.hash, snapshot.hash);
  assert.equal(again.hash.length, 16);
});
