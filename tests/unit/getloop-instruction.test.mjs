// 持续 get（waitgoal）交付段的取值口径。
//
// #182 起仓库侧配置只有 { enabled, waitMinutes }（template 字段下线，老数据忽略）；
// #230 清理后交付里那段「继续 get」的文案**唯一真相**是 getloop 插件类的内置模板
// （原「waitgoal-config 常量 → 宿主预渲染 → data.getloop.text」残留链路已删——
// 预渲染上下文缺 getloop 键，产出的 text 是残缺副本，内置模板也从不消费它）。
//
// 所以这里钉三件事：
//   1. 内置模板的槽位（{{task.id}} / {{getloop.waitMinutes}}）与开关门控（enabled）；
//   2. 窗口 0 时分钟句不出现、>0 才报分钟数；
//   3. 仓库就算还留着历史 template 字段，也**不再影响**任何行为（读入即忽略）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlugins, templatesOf } from '../../src/modules/promptplug/index.js';
import { renderInstruction } from '../../src/core/instruction-template.js';
import { sanitizeGetLoop } from '../../src/modules/tasktool/plugins/waitgoal-config.js';

const TPL = templatesOf('getloop')[0].text;

async function dataOf({ enabled, waitMinutes }) {
  const [plugin] = buildPlugins('get', { enabled, waitMinutes }).filter((p) => p.id === 'getloop');
  return (await plugin.get('data')).getloop;
}

test('内置模板带模板槽位：任务号与阻塞分钟数都是变量，不是写死的', () => {
  assert.match(TPL, /\{\{getloop\.waitMinutes\}\}/, '阻塞分钟数是模板槽位');
  assert.match(TPL, /\{\{task\.id\}\}/, '任务编号同理');
});

test('门控：未开启 → getloop 为 null（整段不输出）；开启 → { waitMinutes }', async () => {
  assert.equal(await dataOf({ enabled: false, waitMinutes: 30 }), null);
  assert.deepEqual(await dataOf({ enabled: true, waitMinutes: 30 }), { waitMinutes: 30 });
  assert.deepEqual(await dataOf({ enabled: true, waitMinutes: 0 }), { waitMinutes: 0 });
});

test('窗口 0 时分钟句不出现；>0 才报分钟数', async () => {
  const zero = renderInstruction(TPL, { task: { id: 7 }, getloop: { waitMinutes: 0 } });
  assert.doesNotMatch(zero, /最多阻塞/);
  const five = renderInstruction(TPL, { task: { id: 7 }, getloop: { waitMinutes: 5 } });
  assert.match(five, /每次最多阻塞 5 分钟/);
});

test('仓库级 template 已下线：老数据里带着也忽略（sanitizeGetLoop 剥掉）', () => {
  assert.deepEqual(sanitizeGetLoop({ enabled: true, waitMinutes: 1, template: '老的一条' }), { enabled: true, waitMinutes: 1 });
  assert.deepEqual(sanitizeGetLoop({ enabled: true, template: ['第一条', '第二条'] }), { enabled: true });
});
