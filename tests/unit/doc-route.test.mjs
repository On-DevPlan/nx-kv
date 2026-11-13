import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeOfPanel,
  panelSpecOfRoute,
  encodeDocRef,
  decodeDocRef,
} from '../../src/web/frontend/route-map.js';

// #88 修正：文档编辑页是 **maincontent** 里的 DocPanel，不再是弹窗里的第二态。
// 这一组钉死 doc 面板的「路由 ↔ 面板」恒等式：config 与地址必须逐字互逆
// （openPanel 按 component+config 去重，多一个字段/换一种编码都会裂出重复面板）。

const nodeOf = (component, config) => ({
  getComponent: () => component,
  getConfig: () => config,
});

/** 按 App.jsx 的 routeFromHash 同一套规则拆 hash（含 doc 分支） */
function parseDocHash(hash) {
  const raw = String(hash).replace(/^#\//, '');
  const [path, query] = raw.split('?');
  assert.equal(path, 'doc');
  const qs = new URLSearchParams(query || '');
  return {
    view: 'doc',
    key: decodeDocRef(qs.get('ref') || ''),
    task: '',
    repoKey: qs.get('repo') || '',
    boardKey: qs.get('board') || '',
    boardName: qs.get('name') || '',
  };
}

test('routeOfPanel: 项目文档 -> #/doc?ref=…&repo=…（前缀冒号不编码）', () => {
  // 前缀 `ref:` 原样保留、只编码冒号后的地址段；其余参数用 encodeURIComponent，
  // 全程绕开 URLSearchParams（否则 `/` 会二次编码成 %252F）。
  assert.equal(
    routeOfPanel(nodeOf('doc', { docId: 'ref:ref_0123456789abcdef', repoKey: 'nx-kv/nx-kv' })),
    '#/doc?ref=ref:ref_0123456789abcdef&repo=nx-kv%2Fnx-kv'
  );
});

test('routeOfPanel: 项目组文档 -> #/doc?ref=…&board=…&name=…', () => {
  const hash = routeOfPanel(
    nodeOf('doc', { docId: 'ref:ref_fedcba9876543210', boardKey: 'b_1', boardName: 'nx' })
  );
  assert.match(hash, /^#\/doc\?/);
  assert.match(hash, /board=b_1/);
  assert.match(hash, /name=nx/);
});

test('routeOfPanel: 没有 docId 的 doc 面板不改地址（避免空深链）', () => {
  assert.equal(routeOfPanel(nodeOf('doc', {})), null);
});

test('encodeDocRef / decodeDocRef: 前缀冒号保留、路径段编码，往返恒等', () => {
  const cases = [
    'ref:ref_0123456789abcdef',
    'ref:ref_abcdef0123456789',
    'path:D:\\Vault\\某个 库\\index.md',
    'path:/home/u/vault/a b.md',
  ];
  for (const id of cases) {
    const enc = encodeDocRef(id);
    // 前缀原样保留（整串编码会把 `:` 变 %3A，与 config 对不上）
    assert.match(enc, /^(ref|path):/, `前缀丢失: ${enc}`);
    assert.equal(decodeDocRef(enc), id, `往返不一致: ${id}`);
  }
});

test('路由 <-> 面板往返恒等: routeOfPanel(panelSpecOfRoute(doc)) 复现同一条路由', () => {
  const cases = [
    { view: 'doc', key: 'ref:ref_0123456789abcdef', repoKey: 'nx-kv/nx-kv' },
    { view: 'doc', key: 'path:D:\\Vault\\index.md', repoKey: '' },
    { view: 'doc', key: 'ref:ref_fedcba9876543210', boardKey: 'b_1', boardName: 'nx 组' },
  ];
  for (const route of cases) {
    const r1 = { ...route, task: '', boardKey: route.boardKey || '', boardName: route.boardName || '' };
    const spec = panelSpecOfRoute(r1, {});
    assert.equal(spec.component, 'doc');
    const hash = routeOfPanel(nodeOf(spec.component, spec.config));
    const back = parseDocHash(hash);
    // 首程 config 必须能从回程路由逐字复现（去重不裂）
    const spec2 = panelSpecOfRoute(back, {});
    assert.deepEqual(spec2.config, spec.config, `config 往返不一致: ${hash}`);
    assert.equal(back.key, r1.key, `docId 往返不一致: ${hash}`);
  }
});

test('panelSpecOfRoute: doc 路由的面板名取地址（refId / 路径末段）', () => {
  const spec = panelSpecOfRoute({ view: 'doc', key: 'ref:ref_0123456789abcdef' }, {});
  assert.equal(spec.name, 'ref_0123456789abcdef', 'refId 没有路径，直接用 id 作默认名');
  // ctx.pageTitle 优先（App.jsx 的 specCtx 用它）
  const spec2 = panelSpecOfRoute(
    { view: 'doc', key: 'path:D:\\Vault\\a.md' },
    { pageTitle: 'custom' }
  );
  assert.equal(spec2.name, 'custom');
});

test('panelSpecOfRoute: doc 路由缺 docId -> null（不凭空开面板）', () => {
  assert.equal(panelSpecOfRoute({ view: 'doc', key: '' }, {}), null);
});

test('panelSpecOfRoute: 自由文档（无归属）config 不得出现 repoKey/boardKey 空值', () => {
  // 多出 `repoKey: undefined` 这类字段会让 configSig 与首程不一致 -> 裂面板
  const spec = panelSpecOfRoute({ view: 'doc', key: 'ref:ref_aaaaaaaaaaaaaaaa' }, {});
  assert.deepEqual(spec.config, { docId: 'ref:ref_aaaaaaaaaaaaaaaa' });
});
