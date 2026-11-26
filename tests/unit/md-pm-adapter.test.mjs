// PM 内核 M1 适配层测试：块数组 ↔ PM 文档双向 + round-trip 字节保真（#274 M1 门禁）。
// 门禁口径：**同一份语料 split → blocksToPmDoc → pmDocToBlocks → join 逐字节相等**；
// 兜底语法（列表/引用/代码块/表格/公式/脚注/图片/分隔线）逐字保真，
// 结构断言钉住已解析语法（标题/段落/五标记/三类链接）的节点形态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocksToPmDoc, pmDocToBlocks } from '../../src/web/frontend/modules/md/pm/adapter.js';
import { parseInline, serializeInline } from '../../src/web/frontend/modules/md/pm/inline.js';
import { mdSchema } from '../../src/web/frontend/modules/md/pm/schema.js';
import { joinMdBlocks, liveBodyBlocks, splitMdBlocks } from '../../src/web/frontend/modules/md/md-parse.js';

const roundTrip = (src) => joinMdBlocks(pmDocToBlocks(blocksToPmDoc(splitMdBlocks(src))));
// 保真基准 = 块模型规范形（split→join 本尊；如 `## A\n## B` 无空行会被规范成 \n\n）。
// 本测试钉的是 **PM 层零漂移**：PM 往返 == 块模型往返。
const canonical = (src) => joinMdBlocks(splitMdBlocks(src));

test('round-trip 零漂移：核心语法语料（标题/标记/链接/转义）', () => {
  const corpus = [
    '# 一级标题',
    '## 二级标题\n### 三级标题',
    '#### 四级\n##### 五级\n###### 六级',
    '正文一段，**加粗** 与 *斜体*、~~删除~~、==高亮==、`代码` 混排。',
    'a * b * c 孤立星号原样保留',
    'x **y** z 真粗体不回退',
    '[外链](https://example.com/a?b=1) 与 [附件](3f2a1b2c3d4e5f60718293a4b5c6d7e8) 与 [任务](nxkv://task/12)',
    '转义：\\*literal\\* 与 \\`backtick\\` 与 \\\\ 反斜杠',
    '行内代码里的 *star* 与 **bold** 不解析',
    '第一行\n第二行（块内软换行）',
    '尾随空格 ',
    '正文[^1]。',
    '[[双链|显示名]] → [[另一篇]] 保持字面',
    '$$x + y$$ 行内公式字面',
  ];
  for (const src of corpus) {
    assert.equal(roundTrip(src), canonical(src), `PM 层漂移：${src}`);
    assert.equal(roundTrip(roundTrip(src)), canonical(src), '幂等性破坏：' + src);
  }
});

test('round-trip 零漂移：兜底语法（M2 起逐个升级，当下逐字保真）', () => {
  const corpus = [
    '- 甲\n  - 甲1\n  - 甲2\n- 乙',
    '1) 有序括号\n3. start 三',
    '> 引用第一行\n> 第二行\n> [!note] callout 提示',
    '```js\nconst a = 1;\nconst b = 2;\n```',
    '| a | b |\n| --- | :--: |\n| 1 | 2 |',
    '$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}\n$$',
    '---',
    '***',
    '![图片](3f2a1b2c3d4e5f60718293a4b5c6d7e8)',
    '[^1]: 脚注定义第一行',
    'abc\n- 同块混排列表行',
  ];
  for (const src of corpus) assert.equal(roundTrip(src), canonical(src), `兜底块漂移：${src}`);
});

test('round-trip 零漂移：混合文档 + 空块 ZWSP 往返 + 尾随空白', () => {
  // 语料用 joinMdBlocks 构造：空块按真实口径编码成 ZWSP 落盘
  const doc = joinMdBlocks([
    '# 任务标题',
    '目标：**单文档** 实时编辑。',
    '',
    '- 步骤一\n- 步骤二',
    '```text\n示例\n```',
    '收尾 [链接](https://k.pub/x)。 ',
  ]);
  assert.equal(roundTrip(doc), doc);

  // 空块经 join 编码成 ZWSP，split 还原为 ''：adapter 往返不吞空块
  const blocks = ['前块', '', '后块'];
  const body = joinMdBlocks(blocks);
  assert.ok(body.includes('​'), '空块应编码为 ZWSP');
  const back = pmDocToBlocks(blocksToPmDoc(blocks));
  assert.deepEqual(back, blocks, '空块往返应保持块数组一致');

  // 纯空白块（ZWSP+空格）同样保真
  const ws = ['  '];
  assert.deepEqual(pmDocToBlocks(blocksToPmDoc(ws)), ws);
});

test('round-trip：标题剥离契约（liveBodyBlocks 空间）', () => {
  const body = '# 文档标题\n\n正文内容';
  const blocks = liveBodyBlocks(body);
  assert.deepEqual(blocks, ['正文内容'], '首个 H1 块剥离给标题栏');
  const out = joinMdBlocks(pmDocToBlocks(blocksToPmDoc(blocks)));
  assert.equal(out, '正文内容');
});

test('结构：标题层级与文本', () => {
  const doc = blocksToPmDoc(['### 三级标题']);
  const h = doc.firstChild;
  assert.equal(h.type.name, 'heading');
  assert.equal(h.attrs.level, 3);
  assert.equal(h.textContent, '三级标题');
});

test('结构：段落标记（粗体/斜体/删除/高亮/代码）', () => {
  const doc = blocksToPmDoc(['**粗** 与 *斜*、~~删~~、==亮==、`码`']);
  const p = doc.firstChild;
  assert.equal(p.type.name, 'paragraph');
  const texts = [];
  p.forEach((n) => texts.push(n));
  const strong = texts.find((n) => n.marks.some((m) => m.type.name === 'strong'));
  assert.ok(strong && strong.textContent === '粗', 'strong 标记');
  const em = texts.find((n) => n.marks.some((m) => m.type.name === 'em'));
  assert.ok(em && em.textContent === '斜', 'em 标记');
  const strike = texts.find((n) => n.marks.some((m) => m.type.name === 'strike'));
  assert.ok(strike && strike.textContent === '删', 'strike 标记');
  const hl = texts.find((n) => n.marks.some((m) => m.type.name === 'highlight'));
  assert.ok(hl && hl.textContent === '亮', 'highlight 标记');
  const code = texts.find((n) => n.marks.some((m) => m.type.name === 'code'));
  assert.ok(code && code.textContent === '码', 'code 标记');
});

test('结构：三类链接目标 → link mark 的 kind 属性', () => {
  const kinds = [
    ['[a](https://k.pub/x)', 'ext'],
    ['[b](3f2a1b2c3d4e5f60718293a4b5c6d7e8)', 'attach'],
    ['[c](nxkv://task/12)', 'nxkv'],
  ];
  for (const [src, want] of kinds) {
    const doc = blocksToPmDoc([src]);
    const p = doc.firstChild;
    const link = [];
    p.forEach((n) => {
      const m = n.marks.find((mk) => mk.type.name === 'link');
      if (m) link.push(m);
    });
    assert.equal(link.length, 1, src);
    assert.equal(link[0].attrs.kind, want, src);
    assert.equal(link[0].attrs.href, src.slice(src.indexOf('(') + 1, -1), src);
  }
  // 非三类目标不成链：保持字面文本
  const doc = blocksToPmDoc(['[x](weird-target)']);
  doc.firstChild.forEach((n) => {
    assert.ok(!n.marks.some((m) => m.type.name === 'link'), '非法目标不成链');
  });
});

test('结构：兜底块 syntax 分类', () => {
  const cases = [
    ['- 甲', 'list'],
    ['> 引用', 'quote'],
    ['```js\nx\n```', 'codeblock'],
    ['| a | b |\n| - | - |', 'table'],
    ['$$\nx\n$$', 'math'],
    ['---', 'divider'],
  ];
  for (const [src, want] of cases) {
    const doc = blocksToPmDoc([src]);
    const node = doc.firstChild;
    assert.equal(node.type.name, 'rawBlock', src);
    assert.equal(node.attrs.syntax, want, src);
    assert.equal(node.textContent, src, '兜底块原文逐字');
  }
});

test('行内：孤立语法字符最小转义（stable 快路 + escape 兜底）', () => {
  // 孤立 `*`：直排稳定 → 不加转义（字节保真）
  assert.equal(serializeInline(parseInline('a * b', mdSchema), mdSchema), 'a * b');
  // 真粗体：序列化 = 原语法串，且重解析仍带 strong 结构（幂等）
  const tricky = 'x **y** z';
  const out = serializeInline(parseInline(tricky, mdSchema), mdSchema);
  assert.equal(out, tricky, '真粗体序列化应还原原语法');
  const reparsed = parseInline(out, mdSchema);
  assert.ok(
    reparsed.some((n) => n.marks.some((m) => m.type.name === 'strong')),
    '序列化结果重解析应仍带 strong',
  );
  assert.equal(serializeInline(reparsed, mdSchema), out, '序列化结果幂等');
  // 字面量 '**' 文本节点（无标记）：必须转义，否则重解析会变成真粗体
  const plainStars = mdSchema.text('x **y** z');
  const esc = serializeInline([plainStars], mdSchema);
  assert.equal(esc.includes('\\*'), true, '字面星号应被转义');
  assert.equal(serializeInline(parseInline(esc, mdSchema), mdSchema), esc, '转义幂等');
});

test('空文档：块数组与 PM doc 的空口径', () => {
  assert.deepEqual(pmDocToBlocks(blocksToPmDoc([])), ['']);
  assert.deepEqual(pmDocToBlocks(blocksToPmDoc([''])), ['']);
  assert.deepEqual(splitMdBlocks(''), ['']);
});
