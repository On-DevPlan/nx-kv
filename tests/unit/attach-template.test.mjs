// 任务 #82：附件段提示词模板化 + goal 时间运算字段。
//
//   - attachInstructionOf：配置了模板按模板渲染（{{attach.*}} + {{#each attach.list}}），
//     空/未配置 = 内置默认三段模板；渲染失败回退内置默认。
//   - 附件 ctx 按类型分组：file / url / task / ref 各自有子对象与取用命令。
//   - clampAttachTemplate：空 = ''（用内置默认，不是关掉——附件段带本地路径）。
//   - enrichGoalTiming：goal ctx 缺的时间运算字段（remainingSec/remainingMin/
//     overtimeSec/reached）从 deadline 戳补算；已有的不覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentInstruction, attachInstructionOf, attachTemplateCtx } from '../../src/modules/tasktool/attach.js';
import { validateTemplate } from '../../src/core/instruction-template.js';
import { clampAttachTemplate } from '../../src/modules/localtask/task-templates.js';
import { enrichGoalTiming } from '../../src/modules/tasktool/wait.js';

const ATT = [
  { id: 'att-1', kind: 'image', name: '截图.png', localPath: 'D:/att/截图.png', synced: true, storage: 'local' },
  { id: 'att-2', kind: 'file', name: '报表.docx', localPath: '', synced: false, storage: 'local' },
];

test('内置默认：空模板 = 内置三段模板（数量 / 清单 / 取用方式）', () => {
  assert.equal(attachInstructionOf('', ATT, { id: 9 }), attachmentInstruction(ATT));
  assert.equal(attachInstructionOf(undefined, ATT, { id: 9 }), attachmentInstruction(ATT));
  assert.equal(attachInstructionOf('  ', [], { id: 9 }), '', '无附件 → 空串（整段消失）');
  const out = attachInstructionOf('', ATT, { id: 9 });
  assert.match(out, /本任务包含 2 个附件（正文内嵌 2 · 附件区 0）/);
  assert.match(out, /附件清单：/);
  assert.match(out, /取用方式：/);
  assert.match(out, /已在本机：直接读取 D:\/att\/截图\.png/);
  assert.match(out, /本机附件仓没有这个文件/);
});

test('自定义模板：清单 / 个数如实渲染', () => {
  const out = attachInstructionOf(
    [
      '共 {{attach.count}} 个附件，逐个处理：',
      '{{#each attach.list}}',
      '  - {{kindLabel}} {{name}}: {{#if file.localPath}}{{file.localPath}}{{else}}本机缺失（fileId {{file.fileId}}）{{/if}}',
      '{{/each}}',
    ].join('\n'),
    ATT,
    { id: 9, text: '# 正文' }
  );
  assert.match(out, /共 2 个附件/);
  assert.match(out, /- 图片 截图\.png: D:\/att\/截图\.png/);
  assert.match(out, /- 附件 报表\.docx: 本机缺失（fileId att-2/);
});

test('自定义模板：旧同步占位符已被保存校验拒绝', () => {
  for (const tpl of ['同步：{{attach.syncSummary.text}}', '{{attach.syncText}}']) {
    const v = validateTemplate(tpl);
    assert.equal(v.ok, false, `旧语法 ${tpl} 必须被拒绝`);
    assert.match(v.error, /本机附件仓|已废弃/, `报错应指出去哪看：${v.error}`);
  }
  // 运行期遇到坏模板：回退内置默认（不静默吞掉附件）
  assert.equal(attachInstructionOf('同步：{{attach.syncText}}', ATT, { id: 9 }), attachmentInstruction(ATT));
});

test('ctx 按类型分组：file / url / task / ref 各带专属子对象与取用方式', () => {
  const four = [
    { id: 'f1', kind: 'file', name: '报告.pdf', localPath: 'D:/att/报告.pdf', exists: true, size: 1024, mime: 'application/pdf', role: 'attach' },
    { id: 'u1', kind: 'url', name: '设计稿', url: 'https://example.com/a', role: 'attach' },
    {
      id: 't1', kind: 'task', name: '#82 修复附件命名', role: 'attach',
      taskId: 82, topicKey: 'nx-kv', seq: 82, title: '修复附件命名', status: 'done',
      address: 'nx-kv:82', showCmd: 'nx-kv localtask show --id 82 --key nx-kv',
    },
    {
      id: 'r1', kind: 'ref', name: '附件规范', role: 'attach',
      refId: 'ref_1', title: '附件规范', desc: '附件与文档的约定',
      readCmd: 'nx-kv docs get --ref ref_1',
    },
  ];
  const { attach } = attachTemplateCtx(four);
  assert.equal(attach.count, 4);
  assert.equal(attach.areaCount, 4);
  assert.equal(attach.inlineCount, 0);
  assert.equal(attach.list[0].kind, 'file');
  assert.equal(attach.list[0].file.localPath, 'D:/att/报告.pdf');
  assert.equal(attach.list[0].file.exists, true);
  assert.equal(attach.list[0].file.syncCmd, '');
  assert.equal(attach.list[1].kind, 'url');
  assert.equal(attach.list[1].url.href, 'https://example.com/a');
  assert.equal(attach.list[1].url.host, 'example.com');
  assert.equal(attach.list[2].kind, 'task');
  assert.equal(attach.list[2].task.address, 'nx-kv:82');
  assert.match(attach.list[2].task.showCmd, /localtask show --id 82 --key nx-kv/);
  assert.match(attach.list[2].usage, /引用而不是副本/);
  assert.equal(attach.list[3].kind, 'ref');
  assert.equal(attach.list[3].ref.refId, 'ref_1');
  assert.equal(attach.list[3].ref.desc, '附件与文档的约定');
  assert.equal('relPath' in attach.list[3].ref, false, 'ref 没有物理路径');
  assert.match(attach.list[3].ref.readCmd, /docs get --ref ref_1/);
  assert.equal(attach.list[3].usage.includes('文档库里的文档'), true);
});

test('旧数据没有 kind → 按 file 处理；image 也归并为 file', () => {
  const { attach } = attachTemplateCtx([
    { id: 'old-1', name: '老附件.docx', localPath: '' },
    { id: 'img-1', kind: 'image', name: '图.png', localPath: '/tmp/图.png' },
  ]);
  assert.equal(attach.list[0].kind, 'file');
  assert.equal(attach.list[1].kind, 'file');
  assert.equal(attach.list[1].isImage, true);
  assert.equal(attach.list[1].kindLabel, '图片');
});

test('旧语法不再兼容：{{attach.list}} / {{#attachSync}} 回落内置默认', () => {
  for (const tpl of ['清单：{{attach.list}}', '{{#attachSync}}同步：{{attach.sync}}{{/attachSync}}']) {
    assert.equal(attachInstructionOf(tpl, ATT, { id: 9 }), attachmentInstruction(ATT));
  }
});

test('clampAttachTemplate：缺省/空 = 用内置默认（不可关掉附件段）', () => {
  assert.equal(clampAttachTemplate(undefined), '');
  assert.equal(clampAttachTemplate(null), '');
  assert.equal(clampAttachTemplate('   '), '');
  assert.equal(clampAttachTemplate('{{#each attach.list}}x{{/each}}'), '{{#each attach.list}}x{{/each}}');
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
