// 提示词模板体系的**检查点**：出厂模板里引用的变量，必须都在插件的声明里出现过。
//
// 旧实现（#136）是「BLOCK_DEFS ↔ 前端手写 BLOCK_PARAMS 表」对账；S3 起变量目录
// 由插件 `dataSchema` 派生（`GET /api/prompt/registry` 的 `fields`），手写表已删除，
// 检查点因此改为 **模板 ⊆ 声明**——与写路径 `setLtSettings` 用的是同一个
// `undeclaredTemplateVars`（方案 §4.2 第 3 道），落库与出厂快照同一把尺子。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undeclaredTemplateVars } from '../../src/shared/prompt-plugin.js';
import {
  PLUGIN_IDS,
  fieldCatalogOf,
  globalTemplateVarScope,
} from '../../src/modules/promptplug/factory.js';
import { templateBundle } from '../../src/modules/promptplug/template-bundle.js';

test('#136 出厂模板引用的变量都在声明范围内（漏声明 = 用户不知道能写什么）', () => {
  const { allowedSegments, fieldKeys } = globalTemplateVarScope();
  const bundle = templateBundle();
  const bad = [];
  for (const id of PLUGIN_IDS) {
    for (const item of bundle[id].list) {
      const un = undeclaredTemplateVars(item.template, allowedSegments, fieldKeys);
      if (un.length) bad.push(`${id}/${item.name}: ${un.join(', ')}`);
    }
  }
  assert.deepEqual(bad, [], '出厂模板里有未声明的变量（设置页「可使用参数」查不到它）');
});

test('#136 每个段落都声明了变量目录（8 段 fields 非空）', () => {
  const empty = PLUGIN_IDS.filter((id) => fieldCatalogOf(id).fields.length === 0);
  assert.deepEqual(empty, [], '这些段落没有 fields：设置页「可使用参数」会是空的');
});

test('#136 声明面与渲染面同序：registry 段落 id 序列 = PROMPT_BLOCK_IDS', async () => {
  // 双份清单只要不同序，顺序数组的下标语义就会错位（这是 S1 遗留缺口的形状）
  const { PROMPT_BLOCK_IDS } = await import('../../src/shared/prompt-blocks.js');
  assert.deepEqual([...PLUGIN_IDS], [...PROMPT_BLOCK_IDS]);
});

test('#136 fields 键是点号路径或裸键形态，便于和模板对账', () => {
  const bad = [];
  for (const id of PLUGIN_IDS) {
    for (const key of fieldCatalogOf(id).fields) {
      if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(key)) bad.push(`${id}: ${key}`);
    }
  }
  assert.deepEqual(bad, [], '变量名不是点号路径 / 裸键');
});
