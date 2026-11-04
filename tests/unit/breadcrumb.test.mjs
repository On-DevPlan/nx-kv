import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbsOf } from '../../src/web/frontend/components/layout/crumbs.js';

test('crumbsOf dir：组/项目/draft', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc', task: 'draft-3' }, { boardName: 'nx', dirName: 'nx-kv' }),
    ['nx', 'nx-kv', 'draft']
  );
});

test('crumbsOf dir：组/项目/#任务', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc', task: '28' }, { boardName: 'nx', dirName: 'nx-kv', pageTitle: '#28' }),
    ['nx', 'nx-kv', '#28']
  );
});

test('crumbsOf dir：仅目录（无任务）', () => {
  assert.deepEqual(
    crumbsOf({ view: 'dir', key: 'abc' }, { boardName: 'nx', dirName: 'nx-kv' }),
    ['nx', 'nx-kv']
  );
});

test('crumbsOf group / overview', () => {
  assert.deepEqual(crumbsOf({ view: 'group', key: 'b_1' }, { boardName: 'nx' }), ['nx']);
  assert.deepEqual(crumbsOf({ view: 'overview' }, {}), ['全部目录总览']);
});
