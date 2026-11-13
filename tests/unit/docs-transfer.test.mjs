// transfer v5 的单元测试：zip round-trip（导出 → 拆包 → 导入还原文档正文与 ref 绑定）、
// ours 不覆盖本地改动、pendingExternal 待初始化、v3 老布局兼容。
//
// v8 口径：文档地址只有 refId（`refs.id`），zip 内是 `docs/<refId>.md`，
// 绑定与元数据在 layout.refs；不再有 rel / 约定路径。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as repos from '../../src/modules/repos/service.js';
import * as boards from '../../src/modules/repos/boards.js';
import * as store from '../../src/modules/docs/store.js';
import * as transfer from '../../src/modules/repos/transfer.js';
import { readZip } from '../../src/core/zip.js';
import { ensureDocRef } from '../../src/core/attachmentdb.js';
import { getDb, closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

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

  // 项目介绍主篇（v8：显式 ref；不再有约定路径播种）
  const projectId = await repos.writeRepoDocContent({ key: a.key, name: a.name }, '项目介绍');
  const s = await repos.loadStore();
  const board = s.boards.find((x) => x.id === b.id);
  const boardId = String(board.doc.ref);
  const noteId = String(board.repoDocs[a.key].ref);

  // 孤儿自有文档（不属于任何宿主，导出时也要进包）
  const freeId = 'ref_' + 'f'.repeat(16);
  ensureDocRef(getDb(), { ref: freeId });
  await store.writeOwnDoc(freeId, '# 自由文档');
  return { a, b, ids: { projectId, boardId, noteId, freeId } };
}

const EXPECTED = {
  project: '# alpha\n\n项目介绍\n',
  board: '# nx系列\n\nnx 工具链\n',
  note: '# nx系列 · alpha\n\n组里的任务出入口\n',
  free: '# 自由文档',
};

// 模拟 CLI 读 zip：拆包 → layout.json + docs/<refId>.md
async function unzipExport(buf) {
  let json = '';
  const docsFiles = [];
  for (const e of readZip(buf)) {
    if (e.name === 'layout.json') json = e.data.toString('utf8');
    else if (e.name.startsWith('docs/') && /\.md$/i.test(e.name)) {
      docsFiles.push({ refId: e.name.slice('docs/'.length).replace(/\.md$/i, ''), data: e.data });
    }
  }
  assert.ok(json, 'zip 里必须有 layout.json');
  return { json, docsFiles };
}

test('导出 zip：layout v5 + docs/<refId>.md；layout.docs.files 是 zip 内清单', async () => {
  const { ids } = await buildSource();
  const buf = await transfer.repoExportZip({});
  const { json, docsFiles } = await unzipExport(buf);
  const layout = JSON.parse(json);
  assert.equal(layout.version, 5);
  assert.ok(Array.isArray(layout.docs.files));
  // 四篇正文全部进包，文件名 = refId（没有路径）
  assert.deepEqual(
    layout.docs.files.slice().sort(),
    [ids.projectId, ids.boardId, ids.noteId, ids.freeId].sort()
  );
  assert.deepEqual(docsFiles.map((f) => f.refId).sort(), layout.docs.files.slice().sort());
  // layout.refs 记录每篇的 id / origin / locator / desc（没有 rel）
  const refIds = (layout.refs || []).map((x) => x.refId).sort();
  assert.deepEqual(refIds, layout.docs.files.slice().sort());
  assert.ok((layout.refs || []).every((x) => !('rel' in x)), 'v5 layout 不再有 rel');

  // 绑定只写 refId
  const bd = layout.boards.find((x) => x.name === 'nx系列');
  assert.deepEqual(bd.doc, { ref: ids.boardId });
  assert.deepEqual(bd.repoDocs, { 'github.com/me/alpha': { ref: ids.noteId } });
  assert.deepEqual(bd.repos, [{ key: 'github.com/me/alpha', note: '组里的任务出入口' }]);
  const rp = layout.repos.find((x) => x.name === 'alpha');
  assert.deepEqual(rp.doc, { ref: ids.projectId });
});

test('导入 round-trip：换一个空环境，文档正文与 ref 绑定全部还原', async () => {
  const { ids } = await buildSource();
  const { json, docsFiles } = await unzipExport(await transfer.repoExportZip({}));

  // 换新环境：清空 store 与全部文档正文
  await repos.mutateStore((s) => {
    s.repos = [];
    s.boards = [];
  });
  for (const f of await store.listOwnDocs()) await store.removeOwnDoc(f.id);

  const result = await transfer.repoImport({ json, docsFiles, clone: 'none' });
  assert.equal(result.docs.written.length, 4);
  assert.equal(await store.readOwnDoc(ids.projectId), EXPECTED.project);
  assert.equal(await store.readOwnDoc(ids.boardId), EXPECTED.board);
  assert.equal(await store.readOwnDoc(ids.noteId), EXPECTED.note);
  assert.equal(await store.readOwnDoc(ids.freeId), EXPECTED.free);

  // 成员与组内摘要也还原了（layout.repos[].note → repoNotes）
  const bd = await boards.getBoard('nx系列');
  assert.equal(bd.repos.length, 1);
  assert.equal(bd.repos[0].note, '组里的任务出入口');
  assert.equal(bd.introMain.refId, ids.boardId, '组介绍主篇按 refId 还原');
  assert.equal(bd.introMain.docId, 'ref:' + ids.boardId);

  // 项目主篇绑定也还原
  const repo = await repos.getRepo('github.com/me/alpha');
  assert.deepEqual(repo.doc, { ref: ids.projectId });

  // diff 汇总里文档计数
  const diff = await transfer.diffImport(json, docsFiles);
  assert.equal(diff.summary.docsSame, 4);
  assert.equal(diff.summary.docsNew, 0);
});

test('ours 策略：本地已有（一致跳过 / 不同保本地）；overwrite → 全部覆盖', async () => {
  const { ids } = await buildSource();
  const { json, docsFiles } = await unzipExport(await transfer.repoExportZip({}));

  // 本地改一篇（其余三篇与 zip 一致）
  await store.writeOwnDoc(ids.freeId, '# 本地改动');
  const ours = await transfer.repoImport({ json, docsFiles });
  assert.equal(ours.docs.written.length, 0);
  assert.equal(ours.docs.skipped.length, 4);
  assert.ok(ours.docs.skipped.some((x) => x.refId === ids.freeId && /保留本地/.test(x.why)));
  assert.equal(await store.readOwnDoc(ids.freeId), '# 本地改动');

  const over = await transfer.repoImport({ json, docsFiles, strategy: 'overwrite' });
  assert.equal(over.docs.written.length, 4);
  assert.equal(await store.readOwnDoc(ids.freeId), EXPECTED.free);
});

test('外部绑定导入：路径缺失标 pendingExternal + 待初始化 warning，不阻塞', async () => {
  const extRef = 'ref_0123456789abcdef';
  const vault = join(dir, '不存在的vault');
  const layout = {
    version: 5,
    repos: [{ key: 'github.com/me/x', keyCustom: true, name: 'x', desc: '', type: 'dev' }],
    boards: [
      {
        key: 'board/nx系列',
        name: 'nx系列',
        desc: '',
        repos: [{ key: 'github.com/me/x' }],
        docLinks: [{ ref: extRef, note: 'Obsidian' }],
      },
    ],
    links: [],
    refs: [{ refId: extRef, origin: 'external', locator: vault, desc: '' }],
  };
  const result = await transfer.repoImport({ json: JSON.stringify(layout) });
  // locator 入库时统一正斜杠（外部路径的唯一口径）
  const expectedPath = vault.replace(/\\/g, '/');
  assert.ok(result.pendingExternal.some((p) => p.path === expectedPath));
  assert.ok(result.warnings.some((w) => /待初始化/.test(w)));

  // 外部路径不打包字节，只保留 refId + note
  const bd = (await repos.loadStore()).boards.find((x) => x.name === 'nx系列');
  assert.deepEqual(bd.docLinks, [{ ref: extRef, note: 'Obsidian' }]);
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
  const buf = readFileSync(target);
  let json = '';
  for (const e of readZip(buf)) if (e.name === 'layout.json') json = e.data.toString('utf8');
  assert.equal(JSON.parse(json).version, 5);
});
