// #128 · 交付里的类 XML 区块 vs --json 转义。
//
// 结论：--json 不丢数据（标签不会被转成 &lt;），但整个 instruction 会变成一个
// JSON 字符串，换行写成 \n 转义——按文本/严格 XML 解析 stdout 的下游会失效。
// --xml 提供逐字原样输出，两者互斥。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitGlobals, xmlInstructionOf } from '../../src/runtime/cli.js';

test('#128 splitGlobals：--xml 是全局 flag，任意位置都能摘出来', () => {
  const a = splitGlobals(['localtask', 'get', '--xml', '--cwd', 'D:/work']);
  assert.equal(a.xml, true);
  assert.equal(a.json, false);
  assert.deepEqual(a.rest, ['localtask', 'get', '--cwd', 'D:/work']);

  const b = splitGlobals(['--json', 'localtask', 'get']);
  assert.equal(b.json, true);
  assert.equal(b.xml, false);
});

test('#128 xmlInstructionOf：只取字符串 instruction，原样保留真实换行与标签', () => {
  const raw = '<nx-kv>\n<nx-kv.ack>\n完成后 done\n</nx-kv.ack>\n</nx-kv>';
  assert.equal(xmlInstructionOf({ instruction: raw }), raw);
  assert.equal(xmlInstructionOf({ instruction: '  ' }), null);
  assert.equal(xmlInstructionOf({ task: { text: 'x' } }), null);
  assert.equal(xmlInstructionOf(null), null);
});

test('#128 JSON 序列化会转义换行，而 --xml 走的是未转义的那一份', () => {
  const raw = '<nx-kv>\n<nx-kv.ack>\n完成后 done\n</nx-kv.ack>\n</nx-kv>';
  const asJson = JSON.stringify({ instruction: raw }, null, 2);
  assert.ok(asJson.includes('\\n'), 'JSON 里换行确实被转义');
  assert.ok(!asJson.includes('<nx-kv>\n<'), 'JSON 输出不再是逐行 XML');
  assert.equal(xmlInstructionOf({ instruction: raw }), raw, '--xml 分支拿到的仍是原文');
});
