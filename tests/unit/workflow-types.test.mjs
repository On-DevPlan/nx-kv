import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BUILTIN_GOALS,
  NODE_STATES,
  edgesFromTasks,
  taskToNode,
} from '../../src/core/workflow/types.js';
import {
  FORBIDDEN_TOP_LEVEL,
  GOAL_HOMES,
  REQUIRED_SEMANTIC_DIRS,
  TARGET_PATHS,
} from '../../src/core/workflow/layout.js';

const here = dirname(fileURLToPath(import.meta.url));

test('snapshot.example.json 形状可解析且含核心字段', () => {
  const raw = readFileSync(join(here, '../../src/core/workflow/snapshot.example.json'), 'utf8');
  const snap = JSON.parse(raw);
  assert.equal(typeof snap.workflowId, 'string');
  assert.equal(typeof snap.revision, 'number');
  assert.ok(Array.isArray(snap.nodes));
  assert.ok(Array.isArray(snap.edges));
  assert.ok(snap.nodes.some((n) => n.kind === 'control'));
  assert.ok(snap.edges.some((e) => e.from === 11 && e.to === 12));
});

test('taskToNode：闸门 → control + blockgoal', () => {
  const n = taskToNode({
    id: 7,
    status: 'pending',
    blocksFollowing: true,
    ready: false,
  });
  assert.equal(n.kind, 'control');
  assert.equal(n.plugins[0]?.name, BUILTIN_GOALS.blockgoal);
  assert.ok(NODE_STATES.includes(n.state));
});

test('edgesFromTasks：blockBy + blocksFollowing 推边', () => {
  const tasks = [
    { id: 1, status: 'pending', blocksFollowing: true },
    { id: 2, status: 'pending', blockBy: [1] },
    { id: 3, status: 'pending' },
  ];
  const edges = edgesFromTasks(tasks);
  assert.ok(edges.some((e) => e.from === 1 && e.to === 2));
  assert.ok(edges.some((e) => e.from === 1 && e.to === 3)); // 闸门挡后续
  assert.ok(edges.some((e) => e.from === 1 && e.to === 2)); // 显式 blockBy
});

test('layout：目标落点落在 core/workflow 或 localtask|tasktool', () => {
  for (const p of Object.values(TARGET_PATHS)) {
    assert.ok(
      p.startsWith('src/core/workflow/') ||
        p.startsWith('src/modules/localtask/') ||
        p.startsWith('src/modules/tasktool/'),
      `unexpected path: ${p}`,
    );
  }
  assert.ok(FORBIDDEN_TOP_LEVEL.includes('src/facade'));
  assert.ok(FORBIDDEN_TOP_LEVEL.includes('src/plugins'));
});

test('layout：语义子目录已建且带 index 桶', () => {
  const root = join(here, '../..');
  for (const dir of REQUIRED_SEMANTIC_DIRS) {
    const abs = join(root, dir);
    assert.ok(existsSync(abs), `missing dir ${dir}`);
    assert.ok(existsSync(join(abs, 'index.js')), `missing barrel ${dir}/index.js`);
  }
  assert.ok(TARGET_PATHS['store/'].endsWith('/'));
  assert.ok(TARGET_PATHS['mutator/'].endsWith('/'));
  assert.ok(TARGET_PATHS['scheduler/'].endsWith('/'));
  assert.ok(TARGET_PATHS['facade/'].endsWith('/'));
  assert.ok(TARGET_PATHS['plugins/'].endsWith('/'));
});

test('layout：全部 goal 同目录、各一份', () => {
  const homes = Object.values(GOAL_HOMES);
  assert.equal(new Set(homes).size, homes.length);
  for (const p of homes) {
    assert.ok(p.startsWith('src/modules/tasktool/plugins/'), p);
  }
  assert.equal(GOAL_HOMES.blockgoal, 'src/modules/tasktool/plugins/blockgoal.js');
  assert.ok(!REQUIRED_SEMANTIC_DIRS.includes('src/core/workflow/plugins'));
});
