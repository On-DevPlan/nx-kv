import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BUILTIN_GOALS,
  NODE_STATES,
  edgesFromTasks,
  taskToNode,
} from '../../src/core/workflow/types.js';

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
