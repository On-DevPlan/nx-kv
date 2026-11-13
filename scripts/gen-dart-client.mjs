// 生成契约快照与 Dart 客户端：node --import tsx scripts/gen-dart-client.mjs
//
//   pnpm gen:dart           写入 contract/contract.json + contract/dart/**
//   pnpm gen:dart --check   只比对不写；不一致就 exit 1（CI / guard 用）
//
// 产物入库：契约与实现同 PR 可见，端侧靠 git sha 锁版本，不需要发布流程。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]scripts$/, '');
const CHECK = process.argv.includes('--check');

const { registry } = await import(pathToFileURL(join(ROOT, 'src', 'runtime', 'registry.ts')).href);
const { buildContractSnapshot } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'contract.ts')).href
);
const { emitDartPackage } = await import(
  pathToFileURL(join(ROOT, 'src', 'runtime', 'dartgen.ts')).href
);

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// 只有声明了 output 的 zod action 进契约——不对外就不在契约里
const zodActions = registry.actions.filter((a) => Array.isArray(a.fields));
const snapshot = buildContractSnapshot(zodActions, { app: 'nx-kv', version });

if (!snapshot.actions.length) {
  console.error('gen:dart — 没有任何 action 声明 output，拒绝生成空契约');
  process.exit(1);
}

/** 相对仓库根的路径 → 期望内容 */
const files = {
  'contract/contract.json': JSON.stringify(snapshot, null, 2) + '\n',
};
for (const [rel, content] of Object.entries(emitDartPackage(snapshot))) {
  files['contract/dart/' + rel] = content;
}

const stale = [];
for (const [rel, content] of Object.entries(files)) {
  const abs = join(ROOT, rel);
  const prev = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  if (prev === content) continue;
  stale.push(rel);
  if (!CHECK) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

const summary =
  `${snapshot.actions.length} 个 action · 契约 ${snapshot.hash} · nx-kv ${snapshot.version}`;

if (CHECK) {
  if (stale.length) {
    console.error(`gen:dart --check 失败：以下生成物与声明不一致（先跑 pnpm gen:dart）`);
    for (const rel of stale) console.error('  - ' + rel);
    process.exit(1);
  }
  console.log(`gen:dart --check 通过 — ${summary}`);
} else {
  console.log(
    stale.length
      ? `gen:dart — ${summary}；写入 ${stale.length} 个文件`
      : `gen:dart — ${summary}；无变化`,
  );
}
