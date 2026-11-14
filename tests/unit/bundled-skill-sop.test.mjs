// 内置 skill 的结构守卫（#123 起只有一个 nx-kv skill）。
//
// 口径：assets/nx-kv 是**唯一**的 skill，且必须是「A 序列 = 常见 case 的 SOP、
// B 序列 = 概念 / CLI 知识」这套形状。改文案随便改，但下面这些一破就等于
// 把「照着做」变成了「自己猜」：
//   ① frontmatter name 与目录同名，description 足够长（检索命中靠它）；
//   ② 主文档必须有 A / B 两个序列的路由表；
//   ③ 每个 A ref 都要有编号步骤（SOP）与「偏差/陷阱」小节；
//   ④ 每个 B ref 要是知识表（至少一张表格或清单），不许写成散文化；
//   ⑤ 主文档里 [[x]] 引用的 ref 必须真实存在（断链 = 照着做时卡住）；
//   ⑥ 只有一个 skill：不再有 kv-get / kv-submit / kv-repo 这些分身。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'assets';
const SKILL = 'nx-kv';

const read = (p) => readFileSync(p, 'utf8');

function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].trim();
  }
  return out;
}

const refDir = join(ASSETS, SKILL, 'references');
const refFiles = () => readdirSync(refDir).filter((f) => f.endsWith('.md')).sort();

test('#123 只有一个内置 skill，且不再是三个分身', () => {
  const dirs = readdirSync(ASSETS).filter((n) => statSync(join(ASSETS, n)).isDirectory());
  assert.deepEqual(dirs, [SKILL], 'assets 下只应有 nx-kv：' + dirs.join(', '));
  assert.ok(!existsSync(join(ASSETS, 'kv-get')), 'kv-get 已并入');
  assert.ok(!existsSync(join(ASSETS, 'kv-submit')), 'kv-submit 已并入');
  assert.ok(!existsSync(join(ASSETS, 'kv-repo')), 'kv-repo 已并入');
});

test('#123 主文档：frontmatter + A/B 双序列路由', () => {
  const raw = read(join(ASSETS, SKILL, 'SKILL.md'));
  const fm = frontmatter(raw);
  assert.equal(fm.name, SKILL);
  assert.ok((fm.description || '').length >= 120, 'description 太短，检索会漏触发');
  assert.match(raw, /##\s*A 序列/, '缺少 A 序列（常见 case 的 SOP 路由）');
  assert.match(raw, /##\s*B 序列/, '缺少 B 序列（概念 / CLI 知识）');
  assert.match(raw, /localtask get/, 'A 序列必须点明领活的标准动作是 get');
  assert.match(raw, /```bash|`nx-kv /, '至少要给出可直接照抄的命令');
});

test('#123 A 序列的每个 ref 都是可执行 SOP（步骤 + 偏差/陷阱）', () => {
  const a = refFiles().filter((f) => f.startsWith('A'));
  // #132：A 序列重排为 5 个专项场景（领取 / 提交 / 文档 / 仓库组 / 任务链回写）
  assert.deepEqual(
    a,
    ['A01-领取任务.md', 'A02-提交任务.md', 'A03-文档与归属.md', 'A04-仓库与项目组.md', 'A05-任务链与反馈汇总.md'],
    'A 序列应是这 5 篇专项场景（顺序即路由顺序）',
  );
  for (const f of a) {
    const body = read(join(refDir, f));
    assert.match(body, /^\s*\d+[.、)]\s+\S/m, `${f}: 缺少编号步骤`);
    assert.match(body, /偏差|陷阱/, `${f}: 缺少「偏差/陷阱」小节`);
    assert.match(body, /```bash/, `${f}: 缺少命令块`);
  }
});

test('#123 B 序列的每个 ref 都是知识表（不是散文）', () => {
  const b = refFiles().filter((f) => f.startsWith('B'));
  assert.ok(b.length >= 1, 'B 序列至少 1 篇（概念 / CLI）');
  for (const f of b) {
    const body = read(join(refDir, f));
    assert.match(body, /^\|.*\|/m, `${f}: 缺少表格（知识表应是可查的，不是散文）`);
  }
});

test('#123 主文档引用的 ref 必须存在（断链会让 agent 照着做时卡住）', () => {
  const body = read(join(ASSETS, SKILL, 'SKILL.md'));
  const have = refFiles().map((f) => f.replace(/\.md$/, ''));
  const refs = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
  assert.ok(refs.length > 0, '主文档没有 [[ref]] 路由');
  for (const r of new Set(refs)) {
    assert.ok(have.includes(r), `[[${r}]] 在 references/ 里不存在（现有：${have.join(', ')}）`);
  }
});

// reopen 的名实之辨（T04 派生模型）：名字叫「重开」，源码里其实是**派生一条新编号任务**，
// 旧 done 保持 done。文档和 CLI 帮助都曾写成「就地回写 / 已完成→pending」，属于误导。
test('#123 reopen 文案必须与源码的派生模型一致（旧任务定格，不复活）', async () => {
  // #132：A 序列重排为 5 个专项场景，「完成与重开」并进 A01（领取闭环）
  const a03 = read(join(refDir, 'A01-领取任务.md'));
  const b02 = read(join(refDir, 'B02-CLI速查.md'));
  const main = read(join(ASSETS, SKILL, 'SKILL.md'));
  for (const [name, body] of [['A01', a03], ['B02', b02], ['主文档', main]]) {
    assert.match(body, /派生/, `${name}: 必须讲清是派生新任务`);
    assert.doesNotMatch(body, /就地重开|同号回写|已完成→pending|回到 pending 待再领/, `${name}: 还在说旧模型`);
  }
  assert.match(a03, /done.*保持 done/, 'A01: 必须写明旧 done 保持终态');

  const { ACTIONS } = await import('../../src/runtime/registry.js');
  const reopen = ACTIONS.find((a) => a.id === 'localtask.reopen');
  assert.match(reopen.summary, /派生/, 'CLI 帮助也必须与源码一致');
  assert.doesNotMatch(reopen.summary, /history|回到 pending/, 'CLI 帮助不应再提 history / 复活');
});
