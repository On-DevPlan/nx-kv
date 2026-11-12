// **介绍文档集**（任务 #58）：仓库 / 项目组的描述不是一篇 md，而是一个 md 列表。
//
// 这里验的是「文档集读出来是什么样」与「交付文本怎么呈现这份列表」；
// 面板侧靠 smoke 里的 HTTP 断言兜底。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '../../src/core/db/index.js';  // T05：库化后测试清理要先关连接（Windows rmSync 否则 EBUSY）

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nx-kv-introset-'));
  process.env.NX_KV_LOCALTASK_STORE = join(dir, 'localtasks.json');
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

async function setup() {
  const repos = await import('../../src/modules/repos/service.js');
  const store = await import('../../src/modules/docs/store.js');
  const paths = await import('../../src/modules/docs/paths.js');
  const cwd = join(dir, 'alpha');
  mkdirSync(cwd, { recursive: true });
  const alpha = await repos.addRepo({ path: cwd, name: 'alpha', key: 'local/alpha', desc: '管清单的' });
  return { repos, store, paths, alpha, cwd };
}

test('readIntroSet：目录主篇优先，旧单文件回落', async () => {
  const { store, paths, alpha } = await setup();
  const { readIntroSet } = await import('../../src/modules/docs/knowledge.js');

  // 只有旧单文件 → 回落它
  await store.writeOwnDoc(paths.repoDocRel(alpha.key), '# 旧单文件\n\n旧正文');
  let set = await readIntroSet({
    dirRel: paths.repoDocDirRel(alpha.key),
    legacyRel: paths.repoDocRel(alpha.key),
    warnings: [],
  });
  assert.equal(set.main.title, '旧单文件');
  assert.equal(set.count, 1);
  assert.equal(set.extras.length, 0);

  // 目录主篇出现后，主篇换成它，旧单文件不再是主篇
  await store.writeOwnDoc(paths.docMainRel(paths.repoDocDirRel(alpha.key)), '# 目录主篇\n\n新正文');
  set = await readIntroSet({
    dirRel: paths.repoDocDirRel(alpha.key),
    legacyRel: paths.repoDocRel(alpha.key),
    warnings: [],
  });
  assert.equal(set.main.title, '目录主篇');
  assert.equal(set.main.docId, 'rel:' + paths.docMainRel(paths.repoDocDirRel(alpha.key)));
  assert.ok(String(set.main.docId).endsWith('index.md'), '主篇带 docId');
  assert.equal(set.main.abs, undefined, '自有文档正文在 DB，没有磁盘路径');
});

test('readIntroSet：目录里的其余 md 进列表（reference 单独标记）', async () => {
  const { store, paths, alpha } = await setup();
  const { readIntroSet } = await import('../../src/modules/docs/knowledge.js');
  const dirRel = paths.repoDocDirRel(alpha.key);

  await store.writeOwnDoc(paths.docMainRel(dirRel), '# 主篇\n\n正文');
  await store.writeOwnDoc(dirRel + '/arch.md', '# 架构\n\n结构说明');
  await store.writeOwnDoc(dirRel + '/reference/qa.md', '# 问答\n\n常见问题');

  const set = await readIntroSet({ dirRel, legacyRel: paths.repoDocRel(alpha.key), warnings: [] });
  assert.equal(set.count, 3);
  assert.equal(set.extras.length, 2);
  const arch = set.extras.find((d) => d.rel.endsWith('arch.md'));
  const qa = set.extras.find((d) => d.rel.endsWith('qa.md'));
  assert.ok(arch && !arch.isReference, 'arch 是普通补充');
  assert.ok(qa && qa.isReference, 'reference/ 下的标 isReference');
  assert.ok(arch.rel && arch.docId, '每篇都带 rel 与 docId');
});

test('readIntroSet：绑定的外部文件覆盖约定路径', async () => {
  const { alpha } = await setup();
  const { readIntroSet } = await import('../../src/modules/docs/knowledge.js');
  const paths = await import('../../src/modules/docs/paths.js');
  const ext = join(dir, 'vault.md');
  const fsp = await import('node:fs/promises');
  await fsp.writeFile(ext, '# 外部介绍\n\n外部正文', 'utf8');

  const set = await readIntroSet({
    dirRel: paths.repoDocDirRel(alpha.key),
    legacyRel: paths.repoDocRel(alpha.key),
    ref: { path: ext },
    warnings: [],
  });
  assert.equal(set.main.title, '外部介绍');
  assert.equal(set.main.abs, ext);
  assert.equal(set.count, 1);
});

test('listRepoDocs：主篇 + 目录其余 + 登记的补充，一起给出去', async () => {
  const { store, paths, alpha, repos } = await setup();
  const { listRepoDocs } = await import('../../src/modules/docs/refs.js');
  const dirRel = paths.repoDocDirRel(alpha.key);

  await store.writeOwnDoc(paths.docMainRel(dirRel), '# 主篇\n\n正文');
  await store.writeOwnDoc(dirRel + '/reference/qa.md', '# 问答\n\n常见问题');
  await repos.mutateStore((s) => {
    const r = s.repos.find((x) => x.key === alpha.key);
    r.docLinks = [{ rel: 'notes/外部说明.md', note: '外部' }];
  });

  const d = await listRepoDocs(alpha.key);
  assert.equal(d.main.rel, paths.docMainRel(dirRel), '主篇 = 目录 index.md');
  assert.equal(d.extras.length, 1, '目录其余进了 extras');
  assert.equal(d.extras[0].name, 'reference/qa.md');
  assert.equal(d.links.length, 1, '登记的补充仍在 links');
  assert.equal(d.count, 3);
});

test('交付文本：介绍按「列表」呈现——主篇 + 其余各篇', async () => {
  const { renderGroupContext } = await import('../../src/modules/tasktool/groupctx.js');
  const out = renderGroupContext({
    repo: {
      name: 'alpha',
      key: 'local/alpha',
      intro: { body: '项目主篇正文', path: 'C:/docs/repo/alpha/index.md' },
      introSet: {
        count: 2,
        main: { body: '项目主篇正文', abs: 'C:/docs/repo/alpha/index.md' },
        extras: [{ docId: 'rel:repo/alpha/reference/qa.md', abs: 'C:/docs/repo/alpha/reference/qa.md' }],
      },
    },
    groups: [],
  });
  assert.match(out, /项目介绍 · alpha/);
  assert.match(out, /2 篇/, '标出这是列表');
  assert.match(out, /项目主篇正文/);
  assert.match(out, /其余介绍文档（可直接读取）/);
  assert.match(out, /reference\/qa\.md/);
});

test('交付文本：项目登记的补充文档按 desc + refId 给出取用指令', async () => {
  const { renderGroupContext } = await import('../../src/modules/tasktool/groupctx.js');
  const out = renderGroupContext({
    repo: {
      name: 'alpha',
      key: 'local/alpha',
      intro: { body: '正文', path: 'C:/docs/repo/alpha.md' },
      introSet: { count: 1, main: { body: '正文', abs: 'C:/docs/repo/alpha.md' }, extras: [] },
      docLinks: [{ refId: 'ref_qa', desc: '问答集', hasBody: true, note: '问答集' }],
    },
    groups: [],
  });
  assert.match(out, /项目文档（按需取用）/);
  assert.match(out, /问答集/);
  assert.match(out, /nx-kv docs get --ref ref_qa/);
});
