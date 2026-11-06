// transfer v4 的单元测试：zip round-trip（导出 → 拆包 → 导入还原文档树与绑定）、
// ours 不覆盖本地改动、pendingExternal 待初始化、v3 老布局兼容。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as store from '../../src/modules/docs/store.js';
import * as paths from '../../src/modules/docs/paths.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { readZip } from '../../src/core/zip.js';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-doctransfer-'));
  process.env.NX_KV_REPOS_STORE = join(dir, 'repos.json');
  process.env.NX_KV_DOCS_DIR = join(dir, 'docs');
});

test.after?.(() => {
  try { closeDb(); } catch { /* 尚未打开 */ }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
});

async function buildSource() {
  const a = await repos.addRepo({ path: join(dir, 'alpha'), name: 'alpha', desc: '管清单的', remote: 'https://github.com/me/alpha' });
  const b = await boards.createBoard({ name: 'nx系列', desc: 'nx 工具链' });
  await boards.assignRepo({ key: a.key, board: b.id });
  await boards.setBoardRepoNote({ key: a.key, board: b.id, note: '组里的任务出入口' });
  await store.writeOwnDoc(paths.repoDocRel(a.key), '# alpha\n\n项目介绍');
  await store.writeOwnDoc(paths.boardDocRel('nx系列'), '# nx系列\n\n组介绍');
  await store.writeOwnDoc(paths.groupNoteRel('nx系列', a.key), '# nx系列 · alpha\n\n组内描述');
  await store.writeOwnDoc('notes/free.md', '# 自由文档');
  return { a, b };
}

// 模拟 CLI 读 zip：拆包 → layout.json + docs/**（repos/index.js readLayout 的同构逻辑）
async function unzipExport(buf) {
  let json = '';
  const docsFiles = [];
  for (const e of readZip(buf)) {
    if (e.name === 'layout.json') json = e.data.toString('utf8');
    else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) docsFiles.push({ rel: e.name.slice(5), data: e.data });
  }
  assert.ok(json, 'zip 里必须有 layout.json');
  return { json, docsFiles };
}

test('导出 zip：layout v4 + docs/** 齐备；layout.docs.files 是 zip 内清单', async () => {
  const { a, b } = await buildSource();
  const buf = await transfer.repoExportZip({});
  const { json, docsFiles } = await unzipExport(buf);
  const layout = JSON.parse(json);
  assert.equal(layout.version, 4);
  assert.ok(Array.isArray(layout.docs.files));
  // 自有树四份全部进包
  assert.deepEqual(
    layout.docs.files.slice().sort(),
    ['notes/free.md', paths.repoDocRel(a.key), paths.boardDocRel('nx系列'), paths.groupNoteRel('nx系列', a.key)].sort()
  );
  assert.ok(docsFiles.some((f) => f.rel === 'notes/free.md'));
  // 本用例没有设置任何绑定覆盖 → 布局里无 doc 字段（约定路径不需要导出绑定）
  const bd = layout.boards[0];
  assert.equal(bd.doc, undefined);
  assert.deepEqual(bd.repos, [{ key: a.key, note: '组里的任务出入口' }]);
  void b;
});

test('导入 round-trip：换一个空环境，文档树与绑定全部还原', async () => {
  const { json, docsFiles } = await (async () => {
    await buildSource();
    return unzipExport(await transfer.repoExportZip({}));
  })();
  // 换新环境：清空 store 与文档树
  await repos.mutateStore((s) => {
    s.repos = [];
    s.boards = [];
  });
  for (const rel of (await store.listOwnDocs()).map((x) => x.rel)) await store.removeOwnDoc(rel);

  const result = await transfer.repoImport({ json, docsFiles, clone: 'none' });
  assert.equal(result.docs.written.length, 4);
  assert.equal(await store.readOwnDoc('notes/free.md'), '# 自由文档');
  assert.equal(
    await store.readOwnDoc(paths.groupNoteRel('nx系列', 'github.com/me/alpha')),
    '# nx系列 · alpha\n\n组内描述'
  );
  // 成员与组内摘要也还原了（layout.repos[].note → repoNotes）
  const bd = await boards.getBoard('nx系列');
  assert.equal(bd.repos.length, 1);
  assert.equal(bd.repos[0].note, '组里的任务出入口');
  // diff 汇总里文档计数
  const diff = await transfer.diffImport(json, docsFiles);
  assert.equal(diff.summary.docsSame, 4);
  assert.equal(diff.summary.docsNew, 0);
});

test('ours 策略：本地已有（一致跳过 / 不同保本地）；overwrite → 全部覆盖', async () => {
  const { json, docsFiles } = await (async () => {
    await buildSource();
    return unzipExport(await transfer.repoExportZip({}));
  })();
  // 本地造一份同 rel 不同内容（其余三份本地与 zip 一致）
  await store.writeOwnDoc('notes/free.md', '# 本地改动');
  const ours = await transfer.repoImport({ json, docsFiles });
  assert.equal(ours.docs.written.length, 0);
  assert.equal(ours.docs.skipped.length, 4);
  assert.ok(ours.docs.skipped.some((x) => x.rel === 'notes/free.md' && /保留本地/.test(x.why)));
  assert.equal(await store.readOwnDoc('notes/free.md'), '# 本地改动');

  const over = await transfer.repoImport({ json, docsFiles, strategy: 'overwrite' });
  assert.equal(over.docs.written.length, 4);
  assert.equal(await store.readOwnDoc('notes/free.md'), '# 自由文档');
});

test('外部绑定导入：路径缺失标 pendingExternal + 待初始化 warning，不阻塞', async () => {
  const layout = {
    version: 4,
    repos: [{ key: 'github.com/me/x', keyCustom: true, name: 'x', desc: '', type: 'dev' }],
    boards: [
      {
        key: 'board/nx系列',
        name: 'nx系列',
        desc: '',
        repos: [{ key: 'github.com/me/x' }],
        docLinks: [{ path: join(dir, '不存在的vault'), note: 'Obsidian' }],
      },
    ],
    links: [],
  };
  const result = await transfer.repoImport({ json: JSON.stringify(layout) });
  assert.ok(result.pendingExternal.some((p) => p.path === join(dir, '不存在的vault')));
  assert.ok(result.warnings.some((w) => /待初始化/.test(w)));
  const bd = await boards.getBoard('nx系列');
  assert.deepEqual(bd.docLinks, [{ path: join(dir, '不存在的vault'), note: 'Obsidian' }]);
});

test('v3 老布局（无 docs 段）照常导入', async () => {
  const layout = {
    version: 3,
    repos: [{ key: 'github.com/me/old', keyCustom: true, name: 'old', desc: '老仓库', type: 'dev' }],
    boards: [{ key: 'board/旧组', name: '旧组', desc: '', repos: [{ key: 'github.com/me/old', note: '老描述' }] }],
    links: [],
  };
  const result = await transfer.repoImport({ json: JSON.stringify(layout) });
  assert.equal(result.created.length, 1);
  assert.equal(result.docs.written.length, 0);
  const bd = await boards.getBoard('旧组');
  assert.equal(bd.repos[0].note, '老描述');
});

test('writeExportZip 落盘后文件可再拆（CLI --zip 链路）', async () => {
  await buildSource();
  const target = join(dir, 'out', 'export.zip');
  const d = await transfer.writeExportZip(target, {});
  assert.ok(existsSync(d.file));
  const { json } = await (async () => {
    const buf = readFileSync(target);
    let out = '';
    for (const e of readZip(buf)) if (e.name === 'layout.json') out = e.data.toString('utf8');
    return { json: out };
  })();
  assert.equal(JSON.parse(json).version, 4);
});
