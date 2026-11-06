// 任务 #82：附件段提示词模板化 + goal 时间运算字段。
//
//   - attachInstructionOf：配置了模板按模板渲染（{{attach.*}} + {{#attachSync}} 闸门），
//     空/未配置 = 内置默认逐字节不变；渲染失败回退内置默认。
//   - clampAttachTemplate：空 = ''（用内置默认，不是关掉——附件段带本地路径）。
//   - enrichGoalTiming：goal ctx 缺的时间运算字段（remainingSec/remainingMin/
//     overtimeSec/reached）从 deadline 戳补算；已有的不覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentInstruction, attachInstructionOf } from '../../src/modules/tasktool/attach.js';
import { clampAttachTemplate } from '../../src/modules/localtask/task-templates.js';
import { enrichGoalTiming } from '../../src/modules/tasktool/wait.js';

const ATT = [
  { id: 'att-1', kind: 'image', name: '截图.png', localPath: 'D:/att/截图.png', synced: true, storage: 'local' },
  { id: 'att-2', kind: 'file', name: '报表.docx', localPath: '', synced: false, storage: 'cloud' },
];
const SYNC = { dir: 'D:/mirror', downloaded: 1, skipped: 0, failures: [] };

test('内置默认：空模板 = 历史输出逐字节不变（含同步行）', () => {
  assert.equal(attachInstructionOf('', ATT, SYNC, { id: 9 }), attachmentInstruction(ATT, SYNC));
  assert.equal(attachInstructionOf(undefined, ATT, null, { id: 9 }), attachmentInstruction(ATT, null));
  assert.equal(attachInstructionOf('  ', [], SYNC, { id: 9 }), '', '无附件 → 空串（整段消失）');
  assert.match(attachInstructionOf('', ATT, SYNC, { id: 9 }), /同步: 目录 D:\/mirror · 下载 1/);
});

test('自定义模板：清单 / 个数 / 同步详情如实渲染', () => {
  const out = attachInstructionOf(
    '共 {{attach.count}} 个附件，逐个处理：\n{{attach.list}}\n{{#attachSync}}同步情况：{{attach.sync}}{{/attachSync}}',
    ATT,
    SYNC,
    { id: 9, text: '# 正文' }
  );
  assert.match(out, /共 2 个附件/);
  assert.match(out, /- 图片 截图\.png: D:\/att\/截图\.png/);
  assert.match(out, /- 附件 报表\.docx: 未同步到本地（图床 id att-2/);
  assert.match(out, /同步情况：目录 D:\/mirror/);
});

test('自定义模板：{{#attachSync}} 闸门——没跑同步整段消失', () => {
  const tpl = '清单：\n{{attach.list}}{{#attachSync}}\n同步：{{attach.sync}}{{/attachSync}}';
  const out = attachInstructionOf(tpl, ATT, null, { id: 9 });
  assert.match(out, /清单：/);
  assert.doesNotMatch(out, /同步：/);
});

test('clampAttachTemplate：缺省/空 = 用内置默认（不可关掉附件段）', () => {
  assert.equal(clampAttachTemplate(undefined), '');
  assert.equal(clampAttachTemplate(null), '');
  assert.equal(clampAttachTemplate('   '), '');
  assert.equal(clampAttachTemplate('{{attach.list}}'), '{{attach.list}}');
  assert.equal(clampAttachTemplate('x'.repeat(5000)).length, 4000, '超长截断');
});

test('enrichGoalTiming：只有 deadline 戳 → 补算剩余/超时/到点', () => {
  const inMin = 30;
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date(Date.now() + inMin * 60_000);
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const g = enrichGoalTiming({ name: '冲', deadline: stamp, prompt: 'check 指令' });
  assert.ok(g.remainingSec > inMin * 60 - 65 && g.remainingSec <= inMin * 60, '剩余秒数在窗口内');
  assert.equal(g.remainingMin, Math.ceil(g.remainingSec / 60));
  assert.equal(g.overtimeSec, 0);
  assert.equal(g.reached, false);

  const past = new Date(Date.now() - 5 * 60_000);
  const pastStamp = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(past.getHours())}:${pad(past.getMinutes())}:${pad(past.getSeconds())}`;
  const g2 = enrichGoalTiming({ deadline: pastStamp });
  assert.equal(g2.remainingSec, 0);
  assert.ok(g2.overtimeSec >= 295 && g2.overtimeSec <= 305, '超时秒数在窗口内');
  assert.equal(g2.reached, true);
});

test('enrichGoalTiming：已有字段不覆盖；deadline 解析不了就不动', () => {
  const g = enrichGoalTiming({ remainingSec: 42, overtimeSec: 0, reached: true, deadline: '垃圾' });
  assert.equal(g.remainingSec, 42);
  assert.equal(g.remainingMin, 1);
  assert.equal(g.reached, true);
  assert.equal(g.overtimeSec, 0);
  const bare = enrichGoalTiming({ name: 'x', deadline: '' });
  assert.equal(bare.remainingSec, undefined, '没有可算的来源就什么都不加');
  assert.equal(enrichGoalTiming(null), null);
});
