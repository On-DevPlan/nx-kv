// 任务状态展示映射（#121）：全应用唯一的口径——
// 蓝(doing)=进行中（已领取在干）、绿(done)=已完成、浅灰(pending)=待领取、
// 收口灰(gone)=取消/软删/迁出。映射在 components/status-tag/model.js（纯函数）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusTone,
  statusLabel,
  statusShort,
} from '../../src/web/frontend/components/status-tag/model.js';

const row = (over = {}) => ({ status: 'pending', ...over });

test('#121 口径：pending=灰、claimed=进行中(doing)、done=绿、cancelled=收口灰', () => {
  assert.equal(statusTone(row({ status: 'pending' })), 'pending');
  assert.equal(statusTone(row({ status: 'claimed' })), 'doing');
  assert.equal(statusTone(row({ status: 'done' })), 'done');
  assert.equal(statusTone(row({ status: 'cancelled' })), 'gone');
});

test('软删 / 迁出归收口灰，文案有专属词', () => {
  assert.equal(statusTone(row({ status: 'pending', deletedAt: 'x' })), 'gone');
  assert.equal(statusTone(row({ status: 'claimed', migratedTo: 'topic:z' })), 'gone');
  assert.equal(statusLabel(row({ status: 'claimed', deletedAt: 'x' })), '已删除');
  assert.equal(statusLabel(row({ status: 'pending', migratedTo: 'topic:z' })), '已迁移');
});

test('云端来源不是状态：from=cloud 的 pending 仍是待领取（旧侧栏会显示成在跑）', () => {
  assert.equal(statusTone(row({ status: 'pending', from: 'cloud' })), 'pending');
  assert.equal(statusShort(row({ status: 'pending', from: 'cloud' })), '等');
});

test('单字徽标：等 / 跑 / 完 / 档', () => {
  assert.equal(statusShort(row({ status: 'pending' })), '等');
  assert.equal(statusShort(row({ status: 'claimed' })), '跑');
  assert.equal(statusShort(row({ status: 'done' })), '完');
  assert.equal(statusShort(row({ status: 'cancelled' })), '档');
});

test('文案走同构词表（shared/task-status）；不认识的词原样显示', () => {
  assert.equal(statusLabel(row({ status: 'pending' })), '待领取');
  assert.equal(statusLabel(row({ status: 'claimed' })), '已领取');
  assert.equal(statusLabel(row({ status: 'done' })), '已交付');
  assert.equal(statusLabel(row({ status: 'cancelled' })), '已取消');
  assert.equal(statusLabel(row({ status: 'weird' })), 'weird');
});
