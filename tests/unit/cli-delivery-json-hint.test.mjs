// #130 · 交付内容不要用 JSON 解析器读。
//
// 用户反馈原话：「别用json解释器读 或者json返回的结果 就是经过引擎封装的context内容
// 不然我封装这么多提示词 上下文 ai一点都get不到」。
//
// 口径（本仓把它钉死）：
//   · 交付类命令（localtask get / preview）的 stdout **就是引擎封装的 context 原文**
//     （提示词块 + 类 XML 区块 + 回执位）——默认输出直接当上下文喂模型；
//   · `--json` 是给「需要结构化字段」的查询命令用的；加在交付命令上时，instruction
//     会被转义成一行，再套 JSON 解析器读 = 上下文丢失 → 所以 CLI 往 stderr 提醒一句；
//   · `--xml` 保留：脚本要单独取那段逐字原文时用（与 --json 互斥）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliveryJsonHint, xmlInstructionOf } from '../../src/runtime/cli.js';

const ASSETS = join(process.cwd(), 'assets', 'nx-kv');
const read = (p) => readFileSync(p, 'utf8');

test('#130 deliveryJsonHint：只有带 instruction 的交付数据才提醒', () => {
  const hint = deliveryJsonHint({ instruction: '<nx-kv>\n…\n</nx-kv>' });
  assert.ok(hint && hint.length > 0, '交付数据必须给提醒');
  assert.match(hint, /context/, '提醒里要说清这是引擎封装的 context');
  assert.match(hint, /不要用 JSON 解析器/, '提醒里要明确「别用 JSON 解析器读」');

  // 普通查询命令不该多嘴
  assert.equal(deliveryJsonHint({ tasks: [], pending: 0 }), null);
  assert.equal(deliveryJsonHint(null), null);
  assert.equal(deliveryJsonHint({ instruction: '   ' }), null);
});

test('#130 交付的 instruction 在 JSON 里确实是转义的一行（所以不能拿解析器读）', () => {
  const raw = '<nx-kv>\n<nx-kv.ack>\n完成后 done\n</nx-kv.ack>\n</nx-kv>';
  const asJson = JSON.stringify({ instruction: raw }, null, 2);
  assert.ok(asJson.includes('\\n'), 'JSON 里换行被转义');
  assert.ok(!asJson.includes('<nx-kv>\n<'), '不再是逐行区块');
  assert.equal(xmlInstructionOf({ instruction: raw }), raw, '默认输出那份仍是原文');
});

test('#130 skill 不得教「用 --json 读交付」——标准动作是默认输出', () => {
  const files = {
    'SKILL.md': join(ASSETS, 'SKILL.md'),
    'A01': join(ASSETS, 'references', 'A01-领取任务.md'),
    'A04': join(ASSETS, 'references', 'A04-阻塞等待与时间目标.md'),
    'B02': join(ASSETS, 'references', 'B02-CLI速查.md'),
  };
  for (const [name, path] of Object.entries(files)) {
    const body = read(path);
    // 标准动作行里不允许出现 get ... --json；
    // 例外只有「明确说这是给结构化字段用的备选」那类行（带 例外标记）。
    const EXCEPTION = /仅当|结构化字段|查询类|备选|不要用/;
    const bad = body
      .split('\n')
      .filter((l) => /localtask\s+(get|preview)\b/.test(l) && /--json/.test(l) && !EXCEPTION.test(l));
    assert.deepEqual(bad, [], `${name}: 交付命令的标准动作不能带 --json`);
  }

  // A01 必须把「读交付用默认输出 / 别用 JSON 解析器」写清楚
  const a01 = read(files.A01);
  assert.match(a01, /默认输出/, 'A01: 要说明默认输出就是 context 原文');
  assert.match(a01, /JSON 解析器/, 'A01: 要明确别用 JSON 解析器读交付');
  const b02 = read(files.B02);
  assert.match(b02, /默认输出/, 'B02: 交付类命令用默认输出');
});
