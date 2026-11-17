// 提示词模板体系的**检查点**：内置模板里引用的变量，必须都在插件的声明里出现过。
//
// 变量目录由插件 `dataSchema` 派生（`GET /api/prompt/registry` 的 `fields`），
// 检查点因此是 **模板 ⊆ 声明**——与写路径用的是同一个 `undeclaredTemplateVars`。
// #152 起模板正文也在插件类里（`templates`），于是「模板 ↔ 声明」这一对不再跨文件，
// 但检查仍然值得跑：模板正文改了而 fields 没补，设置页的变量目录就会漏项。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undeclaredTemplateVars } from '../../src/shared/prompt-plugin.js';
import {
  PLUGIN_IDS,
  fieldCatalogOf,
  globalTemplateVarScope,
} from '../../src/modules/promptplug/factory.js';
import { assertRegistry, groupIndex, templatesOf } from '../../src/modules/promptplug/registry.js';

test('#136 内置模板引用的变量都在声明范围内（漏声明 = 用户不知道能写什么）', () => {
  assertRegistry();
  const { allowedSegments, fieldKeys } = globalTemplateVarScope();
  const bad = [];
  for (const id of PLUGIN_IDS) {
    for (const item of templatesOf(id)) {
      const un = undeclaredTemplateVars(item.text, allowedSegments, fieldKeys);
      if (un.length) bad.push(`${id}/${item.name}: ${un.join(', ')}`);
    }
  }
  assert.deepEqual(bad, [], '内置模板里有未声明的变量（设置页「可使用参数」查不到它）');
});

test('#136 每个段落都声明了变量目录（fields 非空）', () => {
  const empty = PLUGIN_IDS.filter((id) => fieldCatalogOf(id).fields.length === 0);
  assert.deepEqual(empty, [], '这些段落没有 fields：设置页「可使用参数」会是空的');
});

test('#152 每个插件都有 group，且 get / check / done 三条链都不为空', () => {
  assertRegistry(); // 顺带跑 id 唯一 / 链内 order 唯一 / 模板非空 的全量校验
  const idx = groupIndex();
  for (const g of ['get', 'check', 'done']) {
    assert.ok(idx[g].length > 0, `${g} 链是空的：这个时机永远不输出任何段`);
  }
  assert.equal(Object.values(idx).flat().length, PLUGIN_IDS.length, '每条链恰好覆盖全部插件一次');
});

test('#136 fields 键是点号路径 / 裸键 / 数组元素（[]）形态，便于和模板对账', () => {
  // `attach.list[].file.localPath` = 目录里的写法；模板里在 each 内部写 `file.localPath`。
  const bad = [];
  for (const id of PLUGIN_IDS) {
    for (const key of fieldCatalogOf(id).fields) {
      if (!/^[A-Za-z_$][\w$]*(\[\])?(\.[A-Za-z_$][\w$]*(\[\])?)*$/.test(key)) bad.push(`${id}: ${key}`);
    }
  }
  assert.deepEqual(bad, [], '变量名不是点号路径 / 裸键 / 数组元素形态');
});
