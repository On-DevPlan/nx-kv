// 提示词模板体系的**检查点**：区块与「可使用参数」表必须对得上。
//
// #136：扩展模板体系时最容易漏的一步是「加了新块 / 新变量，却没同步变量表」
// ——设置页会照旧显示，但用户不知道能写什么；反之多了一张表却没对应区块，
// 说明删过块没清表。两边都必须齐，且不多不少。
//
// 做法：拿共享层的区块清单（BLOCK_DEFS）对前端的变量速查表（BLOCK_PARAMS）逐项核对。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_DEFS } from '../../src/shared/prompt-blocks.js';
import { TEMPLATE_HELPERS } from '../../src/core/instruction-template.js';
import { BLOCK_PARAMS } from '../../src/web/frontend/page/settings/prompt-template-params.js';

test('#136 每个区块都有「可使用参数」表（扩展时漏同步会被这条拦住）', () => {
  const missing = BLOCK_DEFS.map((d) => d.id).filter((id) => !BLOCK_PARAMS[id] || !BLOCK_PARAMS[id].length);
  assert.deepEqual(missing, [], '这些区块没有变量表：设置页会显示卡片，但用户不知道能写什么');
});

test('#136 变量表里没有已不存在的区块（删过块要清表）', () => {
  const ids = new Set(BLOCK_DEFS.map((d) => d.id));
  const orphan = Object.keys(BLOCK_PARAMS).filter((id) => !ids.has(id));
  assert.deepEqual(orphan, [], '变量表里有已不存在的区块');
});

test('#136 每条变量都是点号路径形态（x.y / x.y.z），便于和 ctx 契约对账', () => {
  const helpers = new Set(TEMPLATE_HELPERS);
  const bad = [];
  for (const groups of Object.values(BLOCK_PARAMS)) {
    for (const g of groups) {
      for (const [name] of g.items) {
        // helper 调用（如 `percent a b`）不是变量路径，跳过
        if (helpers.has(String(name).split(/\s+/)[0])) continue;
        if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(name)) bad.push(name);
      }
    }
  }
  assert.deepEqual(bad, [], '变量名不是点号路径');
});
